import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCatalogProduct } from "../assets/catalogo-core.mjs";
import { materializeParsed, readRegistry, sourceKeys } from "./import-vinyl-list.mjs";
import { parseVinylList } from "./parse-vinyl-list.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultList = path.join(repositoryRoot, "VINILOS PARA PUBLICAR", "LISTADO DE VINILOS.txt");
const recordsRoot = path.join(repositoryRoot, "data", "vinilos");
const registryPath = path.join(repositoryRoot, "data", "import-history", "listado-notas.json");

function git(args) {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function syncMain() {
  if (git(["branch", "--show-current"]) !== "main") throw new Error("Usá este flujo desde la rama main.");
  if (git(["status", "--porcelain"])) throw new Error("Hay cambios locales versionados pendientes. Sincronizalos antes de procesar la tanda.");
  git(["fetch", "origin", "main"]);
  const head = git(["rev-parse", "HEAD"]);
  const remote = git(["rev-parse", "origin/main"]);
  if (head === remote) return;
  const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", head, remote], { cwd: repositoryRoot, stdio: "ignore" });
  if (ancestor.status !== 0) throw new Error("La rama local y origin/main divergieron. No se importó nada; sincronizá y revisá la tanda otra vez.");
  git(["merge", "--ff-only", "origin/main"]);
}

async function existingProducts() {
  const names = (await readdir(recordsRoot, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map(entry => entry.name);
  return Promise.all(names.map(async name => JSON.parse(await readFile(path.join(recordsRoot, name), "utf8"))));
}

export function inspectTextBatch(text, existing, registry) {
  const plainText = parseVinylList(text).map(({ photoFolder, photos, ...product }) => product);
  const parsed = sourceKeys(plainText);
  return materializeParsed(parsed, existing, [], registry).map(product => {
    let state = "ready";
    if (product.operation === "already_imported") state = "already_imported";
    else if (product.identityWarning || product.issues?.length || product.operation !== "create") state = "review";
    return { ...product, state };
  });
}

export function recordFromTextProduct(product, id = randomUUID()) {
  const source = { id, published: true, availability: product.availability || "available" };
  for (const field of ["artist", "album", "genre", "collection", "country", "year", "editionType", "coverCondition", "vinylCondition", "extras", "otherExtras", "notes", "priceARS"]) {
    const value = product[field];
    if (value !== undefined && value !== null && value !== "") source[field] = value;
  }
  const { photos, ...record } = normalizeCatalogProduct(source);
  return record;
}

function productLabel(product) {
  return [product.artist, product.album].filter(Boolean).join(" — ") || "Vinilo sin título";
}

function showSummary(products) {
  const ready = products.filter(product => product.state === "ready");
  const already = products.filter(product => product.state === "already_imported");
  const review = products.filter(product => product.state === "review");
  console.log(`Detectados: ${products.length}; listos: ${ready.length}; ya importados: ${already.length}; para revisar: ${review.length}.`);
  for (const product of review) {
    const reason = product.operation === "pending_duplicate"
      ? `Posible duplicado: ${product.duplicates.map(match => `${match.artist} — ${match.album}`).join("; ")}`
      : product.identityWarning || product.issues?.join("; ") || product.blockingIssues?.join("; ") || "Revisar este registro";
    console.log(`Revisar #${product.sourceIndex} ${productLabel(product)}: ${reason}`);
  }
}

async function applyProducts(products) {
  const ready = products.filter(product => product.state === "ready");
  if (!ready.length) {
    console.log("No hay fichas nuevas listas para crear.");
    return;
  }
  const registry = await readRegistry(repositoryRoot);
  const registryEntries = [...registry.entries];
  const knownKeys = new Set(registryEntries.map(entry => entry.sourceKey));
  const created = [];
  const tempPath = `${registryPath}.${process.pid}.${randomUUID()}.tmp`;
  const importedAt = new Date().toISOString();
  try {
    for (const product of ready) {
      if (knownKeys.has(product.sourceKey)) throw new Error(`El historial ya contiene ${productLabel(product)}; no escribí la tanda.`);
      const id = randomUUID();
      const filename = path.join(recordsRoot, `${id}.json`);
      const record = recordFromTextProduct(product, id);
      await writeFile(filename, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      created.push(filename);
      registryEntries.push({ sourceKey: product.sourceKey, productId: id, importedAt, kind: "created" });
      knownKeys.add(product.sourceKey);
    }
    await writeFile(tempPath, `${JSON.stringify({ version: 1, entries: registryEntries }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(tempPath, registryPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    for (const filename of created.reverse()) await rm(filename, { force: true }).catch(() => {});
    throw error;
  }
  console.log(`Creados ${created.length} registros sin fotografías. Quedaron ${products.filter(product => product.state === "review").length} para revisar; los ya importados se omitieron.`);
}

async function main(args) {
  const [mode, inputArgument] = args;
  if (mode === "--help" || mode === "-h") {
    console.log("Uso:\n  node scripts/import-text-batch.mjs check [LISTADO.txt]\n  node scripts/import-text-batch.mjs apply [LISTADO.txt]\n\n`apply` se usa solamente después de la aprobación explícita de la tanda. Las fotos no se leen ni se asocian.");
    return;
  }
  if (!["check", "apply"].includes(mode)) throw new Error("Indicá check o apply. Usá --help para ver el uso.");
  syncMain();
  const listPath = inputArgument ? path.resolve(inputArgument) : defaultList;
  const text = await readFile(listPath, "utf8");
  const products = inspectTextBatch(text, await existingProducts(), await readRegistry(repositoryRoot));
  showSummary(products);
  if (mode === "apply") await applyProducts(products);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
