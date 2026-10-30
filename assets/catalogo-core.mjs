export const GENRES = Object.freeze({
  "rock-nacional": "Rock Nacional",
  "rock-internacional": "Rock Internacional",
  "hard-rock-metal": "Hard Rock / Metal",
  jazz: "Jazz",
  brasil: "Brasil"
});

export const AVAILABILITY = Object.freeze({
  available: "Disponible",
  reserved: "Reservado",
  sold: "Vendido"
});

export const EXTRAS = Object.freeze({
  insert: "Insert",
  gatefold: "Gatefold",
  "doble-lp": "Doble LP"
});

export const WHATSAPP_NUMBER = "5491165437000";

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });
const slugIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function searchable(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
}

export function validateCatalog(data) {
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.products)) {
    throw new Error("El archivo del catálogo no tiene la estructura esperada.");
  }

  const ids = new Set();
  for (const product of data.products) {
    const valid = product
      && typeof product.id === "string" && (slugIdPattern.test(product.id) || uuidV4Pattern.test(product.id))
      && typeof product.artist === "string" && product.artist.trim()
      && typeof product.album === "string" && product.album.trim()
      && Object.hasOwn(GENRES, product.genre)
      && typeof product.country === "string" && product.country.trim()
      && Number.isInteger(product.year) && product.year >= 1900 && product.year <= 2100
      && typeof product.editionType === "string" && product.editionType.trim()
      && typeof product.coverCondition === "string" && product.coverCondition.trim()
      && typeof product.vinylCondition === "string" && product.vinylCondition.trim()
      && (product.extras === undefined || (Array.isArray(product.extras) && product.extras.every(extra => typeof extra === "string")))
      && (product.otherExtras === undefined || typeof product.otherExtras === "string")
      && (product.notes === undefined || typeof product.notes === "string")
      && (product.priceARS === null || (Number.isInteger(product.priceARS) && product.priceARS >= 0))
      && Object.hasOwn(AVAILABILITY, product.availability)
      && (product.published === undefined || typeof product.published === "boolean")
      && Array.isArray(product.photos) && product.photos.length > 0
      && product.photos.every(photo => typeof photo === "string" && photo.trim());

    if (!valid) throw new Error("Hay un vinilo con campos incompletos o inválidos en el archivo del catálogo.");
    if (ids.has(product.id)) throw new Error(`El identificador «${product.id}» está repetido.`);
    ids.add(product.id);
  }
  return data.products;
}

export function filterAndSortProducts(products, { query = "", genre = "todos", sort = "artist-asc" } = {}) {
  const normalizedQuery = searchable(query.trim());
  const filtered = products.filter(product => {
    const matchesGenre = genre === "todos" || product.genre === genre;
    const haystack = searchable([
      product.artist,
      product.album,
      product.country,
      product.year,
      GENRES[product.genre]
    ].join(" "));
    return matchesGenre && (!normalizedQuery || haystack.includes(normalizedQuery));
  });

  return filtered.sort((a, b) => {
    if (sort === "price-asc" || sort === "price-desc") {
      const direction = sort === "price-asc" ? 1 : -1;
      if (a.priceARS === null && b.priceARS !== null) return 1;
      if (b.priceARS === null && a.priceARS !== null) return -1;
      return (a.priceARS - b.priceARS) * direction;
    }
    const field = sort === "album-asc" ? "album" : "artist";
    return collator.compare(a[field], b[field]);
  });
}

export function formatPrice(priceARS) {
  if (priceARS === null) return "Consultar precio";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0
  }).format(priceARS);
}

export function buildWhatsAppUrl(product) {
  if (product.availability === "sold") return null;

  const price = product.priceARS === null
    ? "precio a consultar"
    : formatPrice(product.priceARS).replace(/\s/gu, "");
  const status = product.availability === "reserved"
    ? "Veo que figura como reservado. ¿Podrían confirmarme si sigue disponible?"
    : "¿Sigue disponible?";
  const message = `Hola, ¿cómo están? Me interesa el vinilo ${product.artist} - ${product.album}, edición ${product.country} ${product.year}, publicado a ${price}. ${status}`;

  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
