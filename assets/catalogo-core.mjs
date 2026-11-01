export const COLLECTIONS = Object.freeze({
  "rock-nacional": "Rock Nacional",
  "rock-internacional": "Rock Internacional",
  "hard-rock-metal": "Hard Rock / Metal",
  jazz: "Jazz",
  brasil: "Brasil"
});
// Backward-compatible export: older code and the five homepage links use these IDs.
export const GENRES = COLLECTIONS;

export const AVAILABILITY = Object.freeze({
  available: "Disponible",
  reserved: "Reservado",
  sold: "Vendido"
});

export const EXTRAS = Object.freeze({
  insert: "C/ insert",
  gatefold: "Gatefold",
  "doble-lp": "Doble LP"
});

export function capitalizeExtraDescriptions(value) {
  return String(value ?? "").split(/([,;\r\n]+)/u).map(part => {
    if (/^[,;\r\n]+$/u.test(part)) return part;
    const characters = Array.from(part);
    const firstLetter = characters.findIndex(character => /\p{L}/u.test(character));
    if (firstLetter >= 0) characters[firstLetter] = characters[firstLetter].toLocaleUpperCase("es");
    return characters.join("");
  }).join("");
}

export const WHATSAPP_NUMBER = "5491165437000";

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });
const slugIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const optionalTextFields = ["artist", "album", "genre", "collection", "country", "editionType", "coverCondition", "vinylCondition", "otherExtras", "notes"];

function isBlank(value) {
  return value === undefined || value === null || (typeof value === "string" && (!value.trim() || /^[.\-–—_\s]+$/u.test(value)));
}

function normalizeTextField(source, target, name) {
  const value = source[name];
  if (isBlank(value)) return;
  if (typeof value !== "string") throw new Error(`El campo «${name}» debe ser texto.`);
  const cleaned = value.trim();
  if (cleaned) target[name] = cleaned;
}

function normalizePublished(value) {
  if (isBlank(value)) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLocaleLowerCase("es");
    if (["true", "1", "sí", "si", "publicado", "visible"].includes(normalized)) return true;
    if (["false", "0", "no", "oculto", "borrador"].includes(normalized)) return false;
  }
  throw new Error("El campo «published» debe ser verdadero o falso.");
}

export function normalizeCatalogProduct(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Cada vinilo debe estar representado por un objeto.");
  }

  const id = typeof source.id === "string" ? source.id.trim() : "";
  if (!id || (!slugIdPattern.test(id) && !uuidV4Pattern.test(id))) {
    throw new Error("Cada vinilo necesita un identificador técnico válido.");
  }

  const product = { id, published: normalizePublished(source.published), photos: [] };

  for (const field of optionalTextFields) normalizeTextField(source, product, field);

  if (!isBlank(source.collection)) {
    if (typeof source.collection !== "string" || !Object.hasOwn(COLLECTIONS, source.collection.trim())) {
      throw new Error("La colección debe ser una de las cinco colecciones principales.");
    }
    product.collection = source.collection.trim();
  }

  if (!isBlank(source.year)) {
    const year = typeof source.year === "number" ? source.year : Number(source.year);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      throw new Error("El año debe ser un número entero entre 1900 y 2100.");
    }
    product.year = year;
  }

  if (!isBlank(source.priceARS) && source.priceARS !== 0 && source.priceARS !== "0") {
    const price = typeof source.priceARS === "number" ? source.priceARS : Number(source.priceARS);
    if (!Number.isInteger(price) || price < 0) throw new Error("El precio debe ser un importe entero en pesos.");
    if (price > 0) product.priceARS = price;
  }

  if (!isBlank(source.availability)) {
    if (typeof source.availability !== "string" || !Object.hasOwn(AVAILABILITY, source.availability.trim())) {
      throw new Error("La disponibilidad indicada no es válida.");
    }
    product.availability = source.availability.trim();
  }

  if (source.extras !== undefined && source.extras !== null && source.extras !== "") {
    if (!Array.isArray(source.extras)) throw new Error("Los extras deben ser una lista.");
    const extras = [...new Set(source.extras.filter(value => typeof value === "string").map(value => value.trim()).filter(Boolean))];
    if (extras.length) product.extras = extras;
  }

  const rawPhotos = source.photos === undefined || source.photos === null
    ? []
    : Array.isArray(source.photos) ? source.photos : [source.photos];
  for (const photo of rawPhotos) {
    if (isBlank(photo)) continue;
    if (typeof photo !== "string") throw new Error("Las rutas de fotografías deben ser texto.");
    const normalizedPhoto = photo.trim().replaceAll("\\", "/");
    if (!product.photos.includes(normalizedPhoto)) product.photos.push(normalizedPhoto);
  }

  return product;
}

export function validateCatalog(data) {
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.products)) {
    throw new Error("El archivo del catálogo no tiene la estructura esperada.");
  }

  const ids = new Set();
  const products = data.products.map(source => normalizeCatalogProduct(source));
  for (const product of products) {
    if (ids.has(product.id)) throw new Error(`El identificador «${product.id}» está repetido.`);
    ids.add(product.id);
  }
  return products;
}

function searchable(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
}

function normalizedGenre(value) {
  return searchable(value).replace(/[-_]+/gu, " ").replace(/\s+/gu, " ").trim();
}

export function filterAndSortProducts(products, { query = "", genre = "todos", collection = "todos", sort = "artist-asc" } = {}) {
  const normalizedQuery = searchable(query.trim());
  const filtered = products.filter(product => {
    const matchesGenre = (genre === "todos" || normalizedGenre(product.genre) === normalizedGenre(genre))
      && (collection === "todos" || matchesCollection(product, collection));
    const haystack = searchable([
      product.artist,
      product.album,
      product.country,
      product.year,
      product.genre,
      COLLECTIONS[product.collection] || COLLECTIONS[product.genre]
    ].filter(value => value !== undefined && value !== null && value !== "").join(" "));
    return matchesGenre && (!normalizedQuery || haystack.includes(normalizedQuery));
  });

  return filtered.sort((a, b) => {
    if (sort === "price-asc" || sort === "price-desc") {
      const direction = sort === "price-asc" ? 1 : -1;
      const aPrice = a.priceARS > 0 ? a.priceARS : null;
      const bPrice = b.priceARS > 0 ? b.priceARS : null;
      if (aPrice === null && bPrice !== null) return 1;
      if (bPrice === null && aPrice !== null) return -1;
      return aPrice === null ? 0 : (aPrice - bPrice) * direction;
    }
    const field = sort === "album-asc" ? "album" : "artist";
    return collator.compare(a[field] ?? "", b[field] ?? "");
  });
}

export function matchesCollection(product, collection) {
  if (!Object.hasOwn(COLLECTIONS, collection)) return false;
  // Legacy records stored the homepage collection slug in `genre`.
  return product.collection === collection || (!product.collection && product.genre === collection);
}

export function listCatalogGenres(products) {
  const values = new Map();
  for (const product of products) {
    if (typeof product.genre !== "string" || !product.genre.trim()) continue;
    const label = (COLLECTIONS[product.genre] || product.genre).trim().replace(/\s+/gu, " ");
    const key = normalizedGenre(label);
    if (!values.has(key)) values.set(key, { label, value: product.genre });
  }
  return [...values.values()].sort((a, b) => collator.compare(a.label, b.label));
}

export function formatPrice(priceARS) {
  if (!Number.isFinite(priceARS) || priceARS <= 0) return "";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0
  }).format(priceARS);
}

export function productTitle(product) {
  return [product.artist, product.album].filter(value => typeof value === "string" && value.trim()).join(" - ") || "este vinilo";
}

export function buildWhatsAppUrl(product) {
  if (product.availability === "sold") return null;

  const identity = productTitle(product);
  const edition = [product.country, product.year].filter(value => !isBlank(value)).join(" ");
  const editionText = edition ? `, edición ${edition}` : "";
  const priceText = product.priceARS > 0 ? `, publicado a ${formatPrice(product.priceARS).replace(/\s/gu, "")}` : "";
  const status = product.availability === "reserved"
    ? "Veo que figura como reservado. ¿Podrían confirmarme si sigue disponible?"
    : "¿Sigue disponible?";
  const message = `Hola, ¿cómo están? Me interesa el vinilo ${identity}${editionText}${priceText}. ${status}`;

  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
