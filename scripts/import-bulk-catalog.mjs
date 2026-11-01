import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = process.cwd();
const recordRoot = path.join(repositoryRoot, "data", "vinilos");
const mediaRoot = path.join(repositoryRoot, "assets", "catalogo");
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const reviewList = args.includes("--review-list");
const importReviewedList = args.includes("--import-reviewed-list");
const skipGenreLookup = args.includes("--skip-genre-lookup");
const help = args.includes("--help") || args.includes("-h");
const inputArgument = args.find(value => !value.startsWith("--"));
const reservedIds = new Set();

if (help || (!inputArgument && !reviewList && !importReviewedList)) {
  console.log(`Uso:
  node scripts/import-bulk-catalog.mjs "VINILOS PARA PUBLICAR" --review-list
  node scripts/import-bulk-catalog.mjs "VINILOS PARA PUBLICAR" --review-list --skip-genre-lookup
  node scripts/import-bulk-catalog.mjs "VINILOS PARA PUBLICAR" --import-reviewed-list
  node scripts/import-bulk-catalog.mjs <carpeta-de-un-vinilo-o-lote> [--dry-run]

El modo principal revisa un solo LISTADO DE VINILOS.txt y las carpetas de
FOTOS DE VINILOS sin crear productos. La importación requiere la revisión aprobada.
El modo secundario conserva la importación por carpetas individuales y datos.txt.`);
  process.exit(help ? 0 : 1);
}

if (reviewList && importReviewedList) throw new Error("Elegí solo --review-list o --import-reviewed-list.");

const inputRoot = path.resolve(inputArgument || path.join(repositoryRoot, "VINILOS PARA PUBLICAR"));
const rootInfo = await stat(inputRoot).catch(() => null);
if (!rootInfo?.isDirectory()) throw new Error(`No se encontró una carpeta de entrada: ${inputRoot}`);

if (reviewList || importReviewedList) {
  const listWorkflow = await import("./import-vinyl-list.mjs");
  if (reviewList) await listWorkflow.createListReview({ repositoryRoot, preparationRoot: inputRoot, genreLookup: !skipGenreLookup });
  else await listWorkflow.importReviewedList({ repositoryRoot, preparationRoot: inputRoot });
  process.exit(0);
}

const rootEntries = await readdir(inputRoot, { withFileTypes: true });
const directFiles = rootEntries.filter(entry => entry.isFile());
const directCandidates = directFiles.filter(entry => entry.name.toLowerCase() === "datos.txt" || imageExtensions.has(path.extname(entry.name).toLowerCase()));
const childDirectories = rootEntries.filter(entry => entry.isDirectory() && !entry.name.startsWith("."));
if (directCandidates.length && childDirectories.length) {
  throw new Error("La carpeta combina archivos de un vinilo con subcarpetas. Usá una carpeta por vinilo o pasá directamente la carpeta de cada disco.");
}

const productFolders = directCandidates.length
  ? [inputRoot]
  : childDirectories.map(entry => path.join(inputRoot, entry.name));
if (!productFolders.length) throw new Error("No encontré datos.txt, fotografías ni subcarpetas de vinilos.");

function normalizeKey(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const aliases = new Map([
  ["artista", "artist"], ["artist", "artist"],
  ["album", "album"],
  ["genero", "genre"], ["genre", "genre"], ["coleccion", "collection"], ["coleccionprincipal", "collection"], ["collection", "collection"],
  ["pais", "country"], ["country", "country"],
  ["ano", "year"], ["year", "year"],
  ["edicion", "editionType"], ["tipodeedicion", "editionType"], ["edition", "editionType"], ["editiontype", "editionType"],
  ["estadotapa", "coverCondition"], ["estadodetapa", "coverCondition"], ["estadodelatapa", "coverCondition"], ["covercondition", "coverCondition"],
  ["estadodisco", "vinylCondition"], ["estadodedisco", "vinylCondition"], ["estadodeldisco", "vinylCondition"], ["vinylcondition", "vinylCondition"],
  ["extras", "extras"], ["otrosextras", "otherExtras"], ["otherextras", "otherExtras"],
  ["observaciones", "notes"], ["notas", "notes"], ["notes", "notes"],
  ["precio", "priceARS"], ["precioars", "priceARS"], ["price", "priceARS"], ["pricears", "priceARS"],
  ["disponibilidad", "availability"], ["availability", "availability"],
  ["publicado", "published"], ["visible", "published"], ["published", "published"]
]);

function parsePairs(text) {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("datos.txt debe contener un objeto JSON.");
    const fields = {};
    for (const [key, value] of Object.entries(parsed)) {
      const target = aliases.get(normalizeKey(key));
      if (target) fields[target] = value;
    }
    return fields;
  }

  const fields = {};
  for (const line of text.split(/\r?\n/u)) {
    const cleaned = line.trim();
    if (!cleaned || cleaned.startsWith("#")) continue;
    const separator = cleaned.search(/[:=]/u);
    if (separator < 1) continue;
    const key = normalizeKey(cleaned.slice(0, separator));
    const target = aliases.get(key);
    if (target) fields[target] = cleaned.slice(separator + 1).trim();
  }
  return fields;
}

function normalizedToken(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function optionalString(value) {
  if (value === undefined || value === null) return undefined;
  const string = String(value).trim();
  return !string || /^[.\-–—_\s]+$/u.test(string) ? undefined : string;
}

function parseGenre(value) {
  return optionalString(value);
}

function parseCollection(value) {
  const raw = optionalString(value);
  if (!raw) return undefined;
  const key = normalizedToken(raw).replace(/[\s/]+/gu, "-").replace(/-{2,}/gu, "-");
  const known = new Map([
    ["rock-nacional", "rock-nacional"], ["rock-internacional", "rock-internacional"],
    ["hard-rock-metal", "hard-rock-metal"], ["hard-rock", "hard-rock-metal"], ["metal", "hard-rock-metal"],
    ["jazz", "jazz"], ["brasil", "brasil"], ["brazil", "brasil"]
  ]);
  return known.get(key);
}

function parsePrice(value) {
  const raw = optionalString(value);
  if (!raw) return undefined;
  const cleaned = raw.replace(/[$\s]/gu, "");
  if (!/^(?:\d+|\d{1,3}(?:[.,]\d{3})+)$/u.test(cleaned)) return undefined;
  const price = Number(cleaned.replace(/[.,]/gu, ""));
  return Number.isSafeInteger(price) && price > 0 ? price : undefined;
}

function parseBoolean(value) {
  const raw = optionalString(value);
  if (!raw) return false;
  const token = normalizedToken(raw);
  if (["true", "1", "si", "publicado", "visible", "yes"].includes(token)) return true;
  return false;
}

function parseAvailability(value) {
  const raw = optionalString(value);
  if (!raw) return undefined;
  const token = normalizedToken(raw);
  const values = new Map([
    ["available", "available"], ["disponible", "available"],
    ["reserved", "reserved"], ["reservado", "reserved"],
    ["sold", "sold"], ["vendido", "sold"]
  ]);
  return values.get(token);
}

function parseYear(value) {
  const raw = optionalString(value);
  if (!raw || !/^\d{4}$/u.test(raw)) return undefined;
  const year = Number(raw);
  return year >= 1900 && year <= 2100 ? year : undefined;
}

function safeFilename(name) {
  const extension = path.extname(name).toLowerCase();
  const stem = path.basename(name, path.extname(name))
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "foto";
  return `${stem}${extension}`;
}

async function uniqueId() {
  while (true) {
    const id = randomUUID();
    if (reservedIds.has(id)) continue;
    const [recordExists, mediaExists] = await Promise.all([
      stat(path.join(recordRoot, `${id}.json`)).then(() => true, error => {
        if (error.code === "ENOENT") return false;
        throw error;
      }),
      stat(path.join(mediaRoot, id)).then(() => true, error => {
        if (error.code === "ENOENT") return false;
        throw error;
      })
    ]);
    if (!recordExists && !mediaExists) {
      reservedIds.add(id);
      return id;
    }
  }
}

async function prepareProduct(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  const images = entries
    .filter(entry => entry.isFile() && imageExtensions.has(path.extname(entry.name).toLowerCase()))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b, "es"));
  const dataEntry = entries.find(entry => entry.isFile() && entry.name.toLowerCase() === "datos.txt");
  if (!images.length && !dataEntry) return null;

  const fields = dataEntry ? parsePairs(await readFile(path.join(folder, dataEntry.name), "utf8")) : {};
  const id = await uniqueId();
  const product = { id, published: parseBoolean(fields.published) };

  for (const field of ["artist", "album", "country", "editionType", "coverCondition", "vinylCondition", "otherExtras", "notes"]) {
    const value = optionalString(fields[field]);
    if (value) product[field] = value;
  }

  const genre = parseGenre(fields.genre);
  if (genre) product.genre = genre;
  const collection = parseCollection(fields.collection);
  if (optionalString(fields.collection) && !collection) {
    throw new Error(`La colección «${fields.collection}» no coincide con ninguna de las cinco colecciones principales.`);
  }
  if (collection) product.collection = collection;
  const year = parseYear(fields.year);
  if (year) product.year = year;
  const price = parsePrice(fields.priceARS);
  if (price) product.priceARS = price;

  if (Array.isArray(fields.extras)) {
    const extras = fields.extras.map(optionalString).filter(Boolean);
    if (extras.length) product.extras = [...new Set(extras)];
  } else {
    const extras = optionalString(fields.extras)?.split(/[;,|]/u).map(value => value.trim()).filter(Boolean) ?? [];
    if (extras.length) product.extras = [...new Set(extras)];
  }

  const availability = parseAvailability(fields.availability);
  if (availability) product.availability = availability;

  const mediaDirectory = path.join(mediaRoot, id);
  const usedNames = new Set();
  const photoPaths = images.map(name => {
    const safe = safeFilename(name);
    const extension = path.extname(safe);
    const stem = path.basename(safe, extension);
    let unique = safe;
    let index = 2;
    while (usedNames.has(unique.toLowerCase())) unique = `${stem}-${index++}${extension}`;
    usedNames.add(unique.toLowerCase());
    return `assets/catalogo/${id}/${unique}`;
  });
  if (photoPaths.length) {
    product.cover = photoPaths[0];
    if (photoPaths.length > 1) product.additionalPhotos = photoPaths.slice(1);
  }

  return { folder, id, product, images, mediaDirectory, photoPaths };
}

const prepared = [];
for (const folder of productFolders) {
  const product = await prepareProduct(folder);
  if (product) prepared.push(product);
}
if (!prepared.length) throw new Error("No encontré vinilos para importar. Cada carpeta necesita datos.txt, al menos una foto o ambos.");

for (const item of prepared) {
  const hasData = [item.product.artist, item.product.album, item.product.genre, item.product.country, item.product.year, item.product.priceARS].some(value => value !== undefined);
  console.log(`${dryRun ? "Vista previa" : "Preparando"}: id=${item.id}, datos=${hasData ? "parciales" : "ninguno"}, fotos=${item.images.length}, publicado=${item.product.published}`);
}

if (dryRun) {
  console.log("Vista previa solamente; no se escribió ningún archivo.");
  process.exit(0);
}

const createdPaths = [];
try {
  for (const item of prepared) {
    const recordPath = path.join(recordRoot, `${item.id}.json`);
    if (item.images.length) {
      await mkdir(item.mediaDirectory);
      createdPaths.push(item.mediaDirectory);
      for (let index = 0; index < item.images.length; index += 1) {
        const sourcePath = path.join(item.folder, item.images[index]);
        const destinationPath = path.join(item.mediaDirectory, path.basename(item.photoPaths[index]));
        await copyFile(sourcePath, destinationPath, 1);
      }
    }
    await writeFile(recordPath, `${JSON.stringify(item.product, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    createdPaths.push(recordPath);
  }
} catch (error) {
  for (const createdPath of createdPaths.reverse()) {
    await rm(createdPath, { recursive: true, force: true }).catch(() => {});
  }
  throw error;
}

console.log(`Importación terminada: ${prepared.length} registro(s) creado(s) en data/vinilos. Los registros nuevos quedan ocultos salvo que datos.txt indique publicado: sí.`);
