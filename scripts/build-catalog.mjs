import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeCatalogProduct, validateCatalog } from "../assets/catalogo-core.mjs";

const repositoryRoot = process.cwd();
const outputRoot = path.resolve(repositoryRoot, process.argv[2] ?? "_site");
const recordsRoot = path.join(repositoryRoot, "data", "vinilos");
const mediaRoot = path.join(repositoryRoot, "assets", "catalogo");
const manifestPath = path.join(outputRoot, "data", "catalogo.json");
const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const slugIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isBlank(value) {
  return value === undefined || value === null || (typeof value === "string" && (!value.trim() || /^[.\-–—_\s]+$/u.test(value)));
}

function deterministicId(filename) {
  const stem = path.basename(filename, path.extname(filename)).toLowerCase();
  if (slugIdPattern.test(stem) || uuidV4Pattern.test(stem)) return stem;

  const hash = createHash("sha256").update(filename).digest("hex").slice(0, 32).split("");
  hash[12] = "4";
  hash[16] = "89ab"[Number.parseInt(hash[16], 16) % 4];
  const value = hash.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function referencesFrom(record) {
  const raw = [];
  if (!isBlank(record.cover)) raw.push(record.cover);
  if (Array.isArray(record.additionalPhotos)) raw.push(...record.additionalPhotos);
  else if (!isBlank(record.additionalPhotos)) raw.push(record.additionalPhotos);
  if (Array.isArray(record.photos)) raw.push(...record.photos);
  else if (!isBlank(record.photos)) raw.push(record.photos);
  return [...new Set(raw.filter(value => !isBlank(value)).map(value => {
    if (typeof value !== "string") throw new Error("Las rutas de fotografías deben ser texto.");
    return value.trim().replaceAll("\\", "/");
  }))];
}

const entries = await readdir(recordsRoot, { withFileTypes: true });
const recordFiles = entries
  .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
  .map(entry => entry.name)
  .sort((a, b) => a.localeCompare(b, "es"));

const records = [];
for (const filename of recordFiles) {
  const record = JSON.parse(await readFile(path.join(recordsRoot, filename), "utf8"));
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`El registro ${filename} no contiene un objeto JSON.`);
  }

  const sourceId = typeof record.id === "string" ? record.id.trim() : "";
  const fileId = path.basename(filename, path.extname(filename));
  const id = sourceId || deterministicId(filename);
  if (sourceId && sourceId !== fileId) {
    throw new Error(`El identificador de ${filename} no coincide con el nombre del archivo.`);
  }

  const references = referencesFrom(record);
  const photos = references.map(reference => {
    const normalized = reference.replaceAll("\\", "/");
    if (!normalized.startsWith("assets/catalogo/")) {
      throw new Error(`La fotografía de ${record.album || record.artist || id} debe estar dentro de assets/catalogo/.`);
    }
    return normalized;
  });

  const product = normalizeCatalogProduct({ ...record, id, photos });
  records.push(product);
}

const allProducts = validateCatalog({ schemaVersion: 1, products: records });
const publishedProducts = allProducts
  .filter(product => product.published === true)
  .map(({ classificationPending, ...product }) => product);
const imageCopies = new Map();

for (const product of publishedProducts) {
  for (const reference of product.photos) {
    const relativeImage = reference.slice("assets/catalogo/".length);
    const imageSource = path.resolve(mediaRoot, relativeImage);
    if (!relativeImage || !isInside(mediaRoot, imageSource)) {
      throw new Error(`La ruta de foto no es válida para ${product.album || product.artist || product.id}: ${reference}`);
    }
    if (!allowedExtensions.has(path.extname(imageSource).toLowerCase())) {
      throw new Error(`Formato de foto no permitido: ${reference}`);
    }

    const imageDestination = path.resolve(outputRoot, reference);
    if (!isInside(outputRoot, imageDestination)) {
      throw new Error(`La ruta de publicación no es válida: ${reference}`);
    }
    imageCopies.set(imageSource, imageDestination);
  }
}

for (const [source, destination] of imageCopies) {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

await mkdir(path.dirname(manifestPath), { recursive: true });
await writeFile(manifestPath, `${JSON.stringify({ schemaVersion: 1, products: publishedProducts }, null, 2)}\n`, "utf8");
console.log(`Catálogo generado: ${publishedProducts.length} vinilo(s), ${imageCopies.size} foto(s).`);
