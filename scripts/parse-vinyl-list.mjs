const flagCountries = new Map([
  ["US", "USA"], ["GB", "UK"], ["AR", "Argentina"], ["BR", "Brasil"],
  ["JP", "Japón"], ["DE", "Alemania"], ["FR", "Francia"], ["IT", "Italia"],
  ["ES", "España"], ["MX", "México"], ["CA", "Canadá"], ["AU", "Australia"],
  ["NL", "Países Bajos"], ["SE", "Suecia"], ["PT", "Portugal"], ["IE", "Irlanda"],
  ["CH", "Suiza"], ["BE", "Bélgica"], ["AT", "Austria"], ["NZ", "Nueva Zelanda"]
]);

const countryAliases = [
  [/\b(?:u\.?s\.?a?\.?|united states|estados unidos|estadounidense)\b/i, "USA"],
  [/\b(?:u\.?k\.?|united kingdom|great britain|reino unido|inglaterra|ingles[ae]?|brit[aá]nic[oa]s?)\b/i, "UK"],
  [/\b(?:argentina|argentino|argentina)\b/i, "Argentina"],
  [/\b(?:brasil|brazil|brasile[ñn]os?)\b/i, "Brasil"],
  [/\b(?:jap[oó]n|japan|japon[eé]s[ae]?)\b/i, "Japón"],
  [/\b(?:alemania|germany|alem[aá]n[ae]?)\b/i, "Alemania"],
  [/\b(?:francia|france|franc[eé]s[ae]?)\b/i, "Francia"],
  [/\b(?:italia|italy|italian[oa]?)\b/i, "Italia"],
  [/\b(?:espa[ñn]a|spain|espa[ñn]ol[ae]?)\b/i, "España"],
  [/\b(?:m[eé]xico|mexico|mexican[oa]?)\b/i, "México"],
  [/\b(?:canad[aá]|canadian[oa]?)\b/i, "Canadá"],
  [/\b(?:australia|australian[oa]?)\b/i, "Australia"],
  [/\b(?:pa[ií]ses bajos|netherlands|holand[ae]s[ae]?)\b/i, "Países Bajos"],
  [/\b(?:suecia|sweden|suec[oa])\b/i, "Suecia"],
  [/\b(?:portugal|portugu[eé]s[ae]?)\b/i, "Portugal"]
];

function clean(value) {
  return String(value ?? "").trim().replace(/^[•·\s]+|[•·\s]+$/gu, "");
}

function normalized(value) {
  return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function readFlags(value) {
  const codepoints = Array.from(value, character => character.codePointAt(0));
  const pairs = [];
  for (let index = 0; index < codepoints.length - 1; index += 1) {
    const first = codepoints[index];
    const second = codepoints[index + 1];
    if (first >= 0x1f1e6 && first <= 0x1f1ff && second >= 0x1f1e6 && second <= 0x1f1ff) {
      pairs.push(String.fromCharCode(65 + first - 0x1f1e6, 65 + second - 0x1f1e6));
      index += 1;
    }
  }
  return pairs;
}

function countryFromText(value) {
  for (const [pattern, country] of countryAliases) {
    const match = value.match(pattern);
    if (match) return { country, token: match[0] };
  }
  return null;
}

function titleParts(line) {
  const text = clean(line).replace(/^[-–—•·\s]+/u, "");
  const separator = text.match(/\s+-\s+/u);
  if (!separator || /^(?:edici[oó]n|tapa|discos?|vinilos?|precio|pa[ií]s|a[ñn]o|g[eé]nero|extras?|observaciones|notas|carpeta\s+(?:de\s+)?fotos|fotos\s+de\s+carpeta|(?:importar\s+como\s+)?(?:ejemplar\s+independiente|nuevo\s+ejemplar|otro\s+ejemplar|ejemplar\s+distinto)|ya\s+est[aá]\s+cargad[oa]|ya\s+existe\s+en\s+cat[aá]logo|vincular\s+existente)\b/i.test(text)) return null;
  const index = separator.index;
  const artist = clean(text.slice(0, index));
  let album = clean(text.slice(index + separator[0].length));
  const flags = readFlags(album);
  const issues = [];
  if (flags.length > 1) issues.push(`Hay más de una bandera en el título (${flags.join(", ")}).`);
  const flagCountryCodes = [...new Set(flags)];
  const countries = flagCountryCodes.map(code => flagCountries.get(code)).filter(Boolean);
  if (flags.some(code => !flagCountries.has(code))) issues.push(`No se pudo interpretar la bandera ${flags.find(code => !flagCountries.has(code))}.`);
  album = clean(album.replace(/\p{Regional_Indicator}{2}/gu, "").replace(/\s+/gu, " "));
  return {
    artist: artist || undefined,
    album: album || undefined,
    flagCountry: countries.length === 1 ? countries[0] : undefined,
    issues
  };
}

function splitBlocks(text) {
  const blocks = [];
  let current = [];
  const flush = () => {
    const lines = current.map(clean).filter(Boolean);
    if (lines.length) blocks.push(lines);
    current = [];
  };

  for (const originalLine of String(text ?? "").replace(/^\uFEFF/u, "").split(/\r?\n/u)) {
    if (/^\s*(?:#|\/\/)/u.test(originalLine)) continue;
    if (/^\s*[-–—]{1,}\s*$/u.test(originalLine)) {
      flush();
      continue;
    }
    const lineParts = originalLine.split(/\s*[•·]\s*/u).map(clean).filter(Boolean);
    for (const line of lineParts) {
      if (titleParts(line) && current.some(existing => titleParts(existing))) flush();
      current.push(line);
    }
  }
  flush();
  return blocks;
}

function parsePrice(line) {
  const amounts = [...line.matchAll(/(?:\$\s*)?(\d{1,3}(?:[.,]\d{3})+|\d+)/gu)]
    .map(match => Number(match[1].replace(/[.,]/gu, "")))
    .filter(Number.isSafeInteger);
  if (amounts.length !== 1 || amounts[0] <= 0) return { value: undefined, ambiguous: amounts.length > 1 };
  return { value: amounts[0], ambiguous: false };
}

function parseCondition(line, kind) {
  const prefix = kind === "cover"
    ? /^(?:(?:estado\s+(?:de|del)\s+)?(?:la\s+)?)?tapa\s*[:\-]?\s*/i
    : /^(?:(?:estado\s+(?:de|del)\s+)?(?:el\s+)?)?(?:discos?|vinilos?)\s*[:\-]?\s*/i;
  const match = line.match(prefix);
  if (!match) return null;
  const remainder = clean(line.slice(match[0].length));
  return { value: remainder || undefined };
}

function parseExtras(line) {
  const prefixes = /^(c\/|con|incluye|incluyen|incluido|incluida|incluidos|incluidas)\s*/i;
  const labeled = line.match(/^extras?\s*[:\-]\s*(.*)$/i);
  const initialPrefix = line.match(prefixes);
  const bareKnown = /^(?:insert|gatefold|doble\s+lp|2\s*lp|double\s+lp)$/i.test(clean(line));
  if (!labeled && !initialPrefix && !bareKnown) return null;
  const detail = clean(labeled ? labeled[1] : initialPrefix ? line.slice(initialPrefix[0].length) : line);
  if (!detail) return null;
  const extras = [];
  const otherExtras = [];

  for (const rawPart of detail.split(/\s*[,;\n]+\s*/u).map(clean).filter(Boolean)) {
    const partPrefix = rawPart.match(prefixes);
    const prefix = partPrefix?.[1] ?? (labeled ? undefined : initialPrefix?.[1]);
    const value = clean(partPrefix ? rawPart.slice(partPrefix[0].length) : rawPart);
    const normalizedValue = value.toLocaleLowerCase("es").replace(/\s+/gu, " ");

    if (normalizedValue === "insert" && (!prefix || /^(?:c\/|con)$/i.test(prefix))) {
      extras.push("insert");
    } else if (normalizedValue === "gatefold") {
      extras.push("gatefold");
    } else if (/^(?:doble lp|2 lp|double lp)$/i.test(normalizedValue)) {
      extras.push("doble-lp");
    } else {
      otherExtras.push([prefix, value].filter(Boolean).join(" "));
    }
  }

  return { extras: [...new Set(extras)], otherExtras: otherExtras.join(", ") || undefined };
}

function parseGenreLine(line) {
  const match = line.match(/^(?:g[eé]nero)\s*[:\-]?\s*(.+)$/i);
  if (!match) return null;
  const key = normalized(match[1]).replace(/[\s/]+/gu, "-").replace(/-{2,}/gu, "-");
  const genres = new Map([
    ["rock nacional", "rock-nacional"], ["rock-nacional", "rock-nacional"],
    ["rock internacional", "rock-internacional"], ["rock-internacional", "rock-internacional"],
    ["hard rock metal", "hard-rock-metal"], ["hard-rock-metal", "hard-rock-metal"], ["metal", "hard-rock-metal"],
    ["jazz", "jazz"], ["brasil", "brasil"]
  ]);
  return { value: genres.get(key), raw: clean(match[1]) };
}

function parseEdition(line) {
  const match = line.match(/^edici[oó]n\s*[:\-]?\s*(.*)$/i);
  if (!match) return null;
  const raw = clean(match[1]);
  const yearMatches = [...raw.matchAll(/\b(?:19|20)\d{2}\b/gu)].map(item => Number(item[0]));
  const country = countryFromText(raw);
  let remainder = raw.replace(/\b(?:19|20)\d{2}\b/gu, " ");
  if (country) remainder = remainder.replace(country.token, " ");
  const isDouble = /\b(?:doble|2\s*lp|double\s*lp)\b/i.test(remainder);
  if (isDouble) remainder = remainder.replace(/\b(?:doble|2\s*lp|double\s*lp)\b/gi, " ");
  const editionType = clean(remainder.replace(/[()[\],.;:]+/gu, " ").replace(/\s+/gu, " "));
  return {
    raw,
    country: country?.country,
    year: yearMatches.length === 1 ? yearMatches[0] : undefined,
    yearAmbiguous: yearMatches.length > 1,
    extras: isDouble ? ["doble-lp"] : [],
    editionType: editionType || undefined
  };
}

function parseRecord(lines, index) {
  const record = { published: false, photos: [], sourceBlock: lines };
  const issues = [];
  const titleCandidates = lines.map(line => ({ line, title: titleParts(line) })).filter(item => item.title);
  if (titleCandidates.length) {
    record.artist = titleCandidates[0].title.artist;
    record.album = titleCandidates[0].title.album;
    record.countryFromFlag = titleCandidates[0].title.flagCountry;
    issues.push(...titleCandidates[0].title.issues);
  } else {
    record.identityWarning = "No se pudo reconocer una línea «Artista - Álbum»; revisá la identidad. Los campos descriptivos siguen siendo opcionales.";
  }
  if (titleCandidates.length > 1) issues.push("Se reconocieron varios posibles encabezados en el mismo bloque.");

  let edition = null;
  let explicitCountry;
  let priceSeen = false;
  const extras = [];
  const otherExtras = [];
  const notes = [];
  for (const line of lines) {
    if (titleCandidates.some(item => item.line === line)) continue;
    const editionMatch = parseEdition(line);
    if (editionMatch) {
      if (edition) issues.push("Hay más de una línea de edición.");
      else edition = editionMatch;
      if (editionMatch.country) explicitCountry = editionMatch.country;
      if (editionMatch.yearAmbiguous) issues.push(`Hay varios años posibles en «${line}».`);
      if (editionMatch.year && record.year && editionMatch.year !== record.year) issues.push(`Hay años contradictorios en «${line}».`);
      extras.push(...editionMatch.extras);
      continue;
    }

    const countryLine = line.match(/^(?:pa[ií]s|procedencia)\s*[:\-]?\s*(.+)$/i);
    if (countryLine) {
      const country = countryFromText(countryLine[1]);
      if (country) explicitCountry = country.country;
      else explicitCountry = clean(countryLine[1]);
      continue;
    }

    const yearLine = line.match(/^(?:a[nñ]o)\s*[:\-]?\s*((?:19|20)\d{2})$/i);
    if (yearLine) {
      if (record.year && record.year !== Number(yearLine[1])) issues.push("Hay años contradictorios.");
      else record.year = Number(yearLine[1]);
      continue;
    }

    const cover = parseCondition(line, "cover");
    if (cover) {
      if (cover.value) record.coverCondition = cover.value;
      if (cover.issue) issues.push(cover.issue);
      continue;
    }
    const vinyl = parseCondition(line, "vinyl");
    if (vinyl) {
      if (vinyl.value) record.vinylCondition = vinyl.value;
      if (vinyl.issue) issues.push(vinyl.issue);
      continue;
    }

    const extrasLine = parseExtras(line);
    if (extrasLine) {
      extras.push(...extrasLine.extras);
      if (extrasLine.otherExtras) otherExtras.push(extrasLine.otherExtras);
      continue;
    }

    const genreLine = parseGenreLine(line);
    if (genreLine) {
      if (genreLine.value) record.genre = genreLine.value;
      else issues.push(`No se reconoce el género «${genreLine.raw}».`);
      continue;
    }

    const photoFolderLine = line.match(/^(?:carpeta\s+(?:de\s+)?fotos|fotos\s+de\s+carpeta)\s*[:=\-]\s*(.+)$/i);
    if (photoFolderLine) {
      if (record.photoFolder) issues.push("Hay más de una carpeta de fotos indicada para el mismo vinilo.");
      else record.photoFolder = clean(photoFolderLine[1]);
      continue;
    }

    if (/^(?:publicad[oa]|publicar|visible)(?:\s+en\s+(?:el\s+)?cat[aá]logo)?\s*[:\-]?\s*(s[ií]|yes|true|1)$/i.test(line)) {
      record.published = true;
      continue;
    }
    if (/^(?:publicad[oa]|publicar|visible)(?:\s+en\s+(?:el\s+)?cat[aá]logo)?\s*[:\-]?\s*(no|false|0)$/i.test(line)) {
      record.published = false;
      continue;
    }

    if (/^(?:importar\s+como\s+)?(?:ejemplar\s+independiente|nuevo\s+ejemplar|otro\s+ejemplar|ejemplar\s+distinto)\s*[:\-]?\s*(s[ií]|yes|true|1)$/i.test(line)) {
      record.confirmSeparateCopy = true;
      continue;
    }
    if (/^(?:ya\s+est[aá]\s+cargad[oa]|ya\s+existe\s+en\s+cat[aá]logo|vincular\s+existente)\s*[:\-]?\s*(s[ií]|yes|true|1)$/i.test(line)) {
      record.adoptExisting = true;
      continue;
    }
    if (/^(?:importar\s+como\s+)?(?:ejemplar\s+independiente|nuevo\s+ejemplar|otro\s+ejemplar|ejemplar\s+distinto|ya\s+est[aá]\s+cargad[oa]|ya\s+existe\s+en\s+cat[aá]logo|vincular\s+existente)\s*[:\-]?\s*(no|false|0)$/i.test(line)) {
      record.confirmSeparateCopy = false;
      record.adoptExisting = false;
      continue;
    }

    const availabilityLine = line.match(/^(?:disponibilidad\s*[:\-]?\s*)?(vendido|reservado|disponible)$/i);
    if (availabilityLine) {
      record.availability = availabilityLine[1].toLowerCase();
      if (record.availability === "vendido") record.availability = "sold";
      if (record.availability === "reservado") record.availability = "reserved";
      if (record.availability === "disponible") record.availability = "available";
      continue;
    }

    if (/^\$/.test(line) || /^(?:precio|price)\s*[:\-]/i.test(line)) {
      if (priceSeen) {
        issues.push("Hay más de una línea de precio.");
        continue;
      }
      priceSeen = true;
      const parsed = parsePrice(line);
      if (parsed.ambiguous) issues.push(`Hay varios importes posibles en «${line}».`);
      else if (parsed.value) record.priceARS = parsed.value;
      else issues.push(`No se pudo interpretar el precio «${line}».`);
      continue;
    }

    notes.push(line);
  }

  if (edition?.year) record.year = edition.year;
  if (record.confirmSeparateCopy && record.adoptExisting) {
    issues.push("La nota no puede indicar a la vez que el disco ya está cargado y que es un ejemplar nuevo.");
  }
  const editionCountry = explicitCountry ?? edition?.country;
  if (record.countryFromFlag && editionCountry && normalized(record.countryFromFlag) !== normalized(editionCountry)) {
    issues.push(`La bandera indica ${record.countryFromFlag}, pero la edición indica ${editionCountry}.`);
  } else {
    record.country = editionCountry || record.countryFromFlag;
  }
  if (edition?.editionType) record.editionType = edition.editionType;
  record.editionDescription = edition?.raw;
  if (extras.length) record.extras = [...new Set(extras)];
  if (otherExtras.length) record.otherExtras = [...new Set(otherExtras)].join("; ");
  if (notes.length) record.notes = notes.join(" · ");
  if (record.priceARS === 0) delete record.priceARS;

  record.sourceIndex = index + 1;
  record.issues = [...new Set(issues)];
  record.missing = [
    ["artista", record.artist], ["álbum", record.album], ["género", record.genre],
    ["país", record.country], ["año", record.year], ["edición", record.editionDescription || record.editionType],
    ["estado de tapa", record.coverCondition], ["estado del disco", record.vinylCondition],
    ["precio", record.priceARS]
  ].filter(([, value]) => value === undefined || value === null || value === "").map(([label]) => label);
  return record;
}

export function parseVinylList(text) {
  return splitBlocks(text).map(parseRecord);
}

export function normalizeMatchName(value) {
  return normalized(value);
}

export function similarNameCandidates(record, folders) {
  const names = [record.album, record.artist && record.album ? `${record.artist} ${record.album}` : undefined]
    .filter(Boolean).map(normalized).filter(Boolean);
  if (!names.length) return [];
  return folders.filter(folder => {
    const candidate = normalized(folder);
    return names.some(name => {
      if (candidate === name) return false;
      const left = new Set(name.split(" "));
      const right = new Set(candidate.split(" "));
      const overlap = [...left].filter(token => right.has(token)).length / Math.max(1, Math.min(left.size, right.size));
      return overlap >= 0.6;
    });
  });
}
