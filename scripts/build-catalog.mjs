import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateCatalog } from "../assets/catalogo-core.mjs";

const repositoryRoot = process.cwd();
const outputRoot = path.resolve(repositoryRoot, process.argv[2] ?? "_site");
const recordsRoot = path.join(repositoryRoot, "data", "vinilos");
const mediaRoot = path.join(repositoryRoot, "assets", "catalogo");
const manifestPath = path.join(outputRoot, "data", "catalogo.json");
const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

const entries = await readdir(recordsRoot, { withFileTypes: true });
const recordFiles = entries
  .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
  .map(entry => entry.name)
  .sort((a, b) => a.localeCompare(b, "es"));

const records = [];
for (const filename of recordFiles) {
  const record = JSON.parse(await readFile(path.join(recordsRoot, filename), "utf8"));
  if (record.priceARS === undefined) record.priceARS = null;
  if (record.extras === undefined || record.extras === null) record.extras = [];
  if (record.otherExtras === undefined || record.otherExtras === null) record.otherExtras = "";
  if (record.notes === undefined || record.notes === null) record.notes = "";
  if (record.availability === undefined || record.availability === null) record.availability = "available";
  if (record.published === undefined || record.published === null) record.published = true;

  if (Object.hasOwn(record, "cover") || Object.hasOwn(record, "additionalPhotos")) {
    if (typeof record.cover !== "string" || !record.cover.trim()) {
      throw new Error(`Falta la fotografía principal de ${record.album ?? filename}.`);
    }
    const additionalPhotos = Array.isArray(record.additionalPhotos) ? record.additionalPhotos : [];
    record.photos = [record.cover, ...additionalPhotos];
    delete record.cover;
    delete record.additionalPhotos;
  }

  if (filename !== `${record.id}.json`) {
    throw new Error(`El archivo ${filename} no coincide con el identificador del vinilo.`);
  }
  records.push(record);
}

const allProducts = validateCatalog({ schemaVersion: 1, products: records });
const publishedProducts = allProducts.filter(product => product.published !== false);
const imageCopies = new Map();

for (const product of publishedProducts) {
  for (const reference of product.photos) {
    const normalized = reference.replaceAll("\\", "/");
    if (!normalized.startsWith("assets/catalogo/")) {
      throw new Error(`La foto de ${product.album} debe estar dentro de assets/catalogo/.`);
    }

    const relativeImage = normalized.slice("assets/catalogo/".length);
    const imageSource = path.resolve(mediaRoot, relativeImage);
    if (!relativeImage || !isInside(mediaRoot, imageSource)) {
      throw new Error(`Ruta de foto no permitida en ${product.album}: ${reference}`);
    }
    if (!allowedExtensions.has(path.extname(imageSource).toLowerCase())) {
      throw new Error(`Formato de foto no permitido en ${product.album}: ${reference}`);
    }

    const imageDestination = path.resolve(outputRoot, normalized);
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
