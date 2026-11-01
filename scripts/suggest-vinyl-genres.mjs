const SEARCH_URL = "https://musicbrainz.org/ws/2/release-group/";
const USER_AGENT = "LucumaRecordsCatalog/1.0 (https://lucumarecords.github.io/lucuma-records/)";
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let nextRequestAt = 0;

function normalize(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("es").replace(/[^a-z0-9]+/gu, " ").trim();
}

async function requestJson(url, fetchImpl) {
  const delay = Math.max(0, nextRequestAt - Date.now());
  if (delay) await pause(delay);
  nextRequestAt = Date.now() + 1100;
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`MusicBrainz respondió HTTP ${response.status}`);
  return response.json();
}

function creditedArtist(item) {
  return (item["artist-credit"] ?? []).map(part => {
    if (typeof part === "string") return part;
    return part.name ?? part.artist?.name ?? "";
  }).join("");
}

/** Returns review-only suggestions from exact artist/title matches; never writes a genre. */
export async function suggestGenres(record, fetchImpl = globalThis.fetch) {
  if (!record?.artist?.trim() || !record?.album?.trim()) {
    return { status: "Falta artista o álbum para buscar una coincidencia exacta." };
  }
  try {
    const query = `artist:"${record.artist.replaceAll('"', '\\"')}" AND release:"${record.album.replaceAll('"', '\\"')}"`;
    const searchUrl = new URL(SEARCH_URL);
    searchUrl.search = new URLSearchParams({ query, fmt: "json", limit: "10" });
    const results = await requestJson(searchUrl, fetchImpl);
    const exact = (results["release-groups"] ?? []).filter(item =>
      normalize(creditedArtist(item)) === normalize(record.artist) && normalize(item.title) === normalize(record.album)
    );
    if (!exact.length) return { status: "Sin coincidencia exacta en MusicBrainz; no se sugiere un género." };

    const tagTotals = new Map();
    for (const item of exact.slice(0, 3)) {
      const detailUrl = new URL(`${SEARCH_URL}${encodeURIComponent(item.id)}`);
      detailUrl.search = new URLSearchParams({ inc: "genres", fmt: "json" });
      const detail = await requestJson(detailUrl, fetchImpl);
      for (const tag of detail.genres ?? []) {
        const label = String(tag.name ?? "").trim();
        const count = Number(tag.count ?? 0);
        if (!label || !Number.isFinite(count)) continue;
        const key = normalize(label);
        const current = tagTotals.get(key) ?? { label, count: 0, ids: new Set() };
        current.count += count;
        current.ids.add(item.id);
        tagTotals.set(key, current);
      }
    }
    const suggestions = [...tagTotals.values()]
      .filter(tag => tag.count > 0)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es"))
      .slice(0, 5)
      .map(tag => ({ label: tag.label, count: tag.count, url: `https://musicbrainz.org/release-group/${[...tag.ids][0]}` }));
    return suggestions.length
      ? { suggestions, status: "Sugerencias orientativas; confirmar antes de asignar." }
      : { status: "Coincidencia exacta sin etiquetas de género en MusicBrainz." };
  } catch (error) {
    return { status: `No se pudo consultar MusicBrainz (${error.message}); el género queda sin completar.` };
  }
}
