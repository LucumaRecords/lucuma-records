import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const args = process.argv.slice(2);

if (args[0] === "--help" || args[0] === "-h") {
  console.log("Uso:\n  node scripts/import-bulk-catalog.mjs check [LISTADO.txt]\n  node scripts/import-bulk-catalog.mjs apply [LISTADO.txt]\n\nEl flujo de texto no lee ni asocia fotos. Ejecutá apply solamente después de aprobar la tanda.");
} else if (!["check", "apply"].includes(args[0])) {
  console.error("Indicá check o apply. Usá --help para ver el uso.");
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, [path.join(scriptDirectory, "import-text-batch.mjs"), ...args], {
    cwd: repositoryRoot,
    stdio: "inherit"
  });
  if (result.error) {
    console.error(`No pude iniciar el importador de texto: ${result.error.message}`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
}
