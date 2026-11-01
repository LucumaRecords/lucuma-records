const ARGENTINE_ROCK_ARTISTS = new Set([
  "charly garcia", "luis alberto spinetta", "spinetta", "soda stereo", "sumo",
  "los abuelos de la nada", "seru giran", "fito paez", "los redondos",
  "indio solari", "virus", "divididos", "los piojos", "attaque 77"
]);

const fold = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("es").replace(/[^a-z0-9]+/gu, " ").trim();

function familyFor(label, artist) {
  const tag = fold(label);
  if (/\b(brazilian|brasil|brazil|mpb|samba|bossa nova)\b/u.test(tag)) return "otros";
  if (/\b(jazz|bebop|hard bop|modal jazz|jazz fusion|free jazz)\b/u.test(tag)) return "jazz";
  if (/\b(heavy metal|metal|hard rock|thrash|doom metal|death metal|speed metal|progressive metal)\b/u.test(tag)) return "hard-rock-metal";
  if (/\b(rock argentino|argentine rock|rock nacional)\b/u.test(tag)) return "rock-nacional";
  if (/\b(rock|folk rock|soft rock|pop rock|progressive rock|art rock|rock and roll)\b/u.test(tag)) {
    return ARGENTINE_ROCK_ARTISTS.has(fold(artist)) ? "rock-nacional" : "rock-internacional";
  }
  if (/\b(soul|funk|country|folk|pop|blues|reggae|disco|brazilian|brasil|mpb|samba|bossa nova|latin|world music|classical|electronic|new wave|r b|rhythm and blues)\b/u.test(tag)) return "otros";
  return null;
}

function genreLabelFor(family) {
  return ({
    "rock-nacional": "Rock",
    "rock-internacional": "Rock",
    "hard-rock-metal": "Hard Rock / Metal",
    jazz: "Jazz"
  })[family];
}

/**
 * Classifies only from an explicitly supplied genre or album-level MusicBrainz
 * tags attached to an exact artist/title release-group match. Weak/ambiguous
 * evidence is routed to Otros and flagged for review.
 */
export function classifyVinyl(record, lookup = {}) {
  if (record.collection && record.genre) return {
    genre: record.genre,
    collection: record.collection,
    pending: false,
    confidence: "Dato indicado en la nota",
    sources: [],
    warning: ""
  };

  const candidates = record.genre
    ? [{ label: record.genre, count: 99, url: "Dato indicado en la nota" }]
    : (lookup.suggestions ?? []);
  const evidence = candidates
    .map(item => ({ ...item, family: familyFor(item.label, record.artist) }))
    .filter(item => item.family && (record.genre || Number(item.count) >= 5 || (Number(item.count) >= 3 && Number(item.releaseGroups) >= 2)));
  const families = [...new Set(evidence.map(item => item.family))];

  if (families.length === 1) {
    const family = families[0];
    const genre = record.genre || evidence
      .filter(item => item.family === family)
      .sort((a, b) => Number(b.count) - Number(a.count))[0]?.label || genreLabelFor(family);
    if (record.collection && record.collection !== family) return {
      genre,
      collection: record.collection,
      pending: true,
      confidence: "Media · las etiquetas del álbum no coinciden con la colección indicada",
      sources: evidence.filter(item => item.family === family).map(item => item.url).filter(Boolean),
      warning: `La colección indicada (${record.collection}) difiere de las etiquetas del álbum (${family}); conservé la elección indicada y la dejé para revisión.`
    };
    return {
      genre,
      collection: record.collection || family,
      pending: false,
      confidence: record.genre ? "Alta · género explícito en la nota" : evidence.some(item => Number(item.count) >= 5) ? "Alta · etiqueta de álbum con al menos 5 votos" : "Alta · etiqueta de álbum en al menos 2 grupos de publicación",
      sources: evidence.filter(item => item.family === family).map(item => item.url).filter(Boolean),
      warning: ""
    };
  }

  const suggestions = (lookup.suggestions ?? []).map(item => item.label).filter(Boolean);
  const ambiguity = families.length > 1
    ? `Las etiquetas fuertes sugieren colecciones distintas (${families.join(", ")}).`
    : "No hay etiquetas de álbum suficientemente consistentes para confirmar el género.";
  return {
    genre: record.genre || undefined,
    collection: record.collection || "otros",
    pending: !record.collection || !record.genre,
    confidence: "Baja · asignación provisional",
    sources: (lookup.suggestions ?? []).map(item => item.url).filter(Boolean),
    warning: `${ambiguity}${suggestions.length ? ` Sugerencias para revisar: ${suggestions.join(", ")}.` : ""} Se deja en Otros; corregible desde Pages CMS.`
  };
}
