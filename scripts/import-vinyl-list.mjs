import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { parseVinylList, normalizeMatchName, similarNameCandidates } from "./parse-vinyl-list.mjs";
import { suggestGenres } from "./suggest-vinyl-genres.mjs";
import { classifyVinyl } from "./classify-vinyl.mjs";

const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const listFilename = "LISTADO DE VINILOS.txt";
const photoFolderName = "FOTOS DE VINILOS";
const planFilename = "PLAN DE IMPORTACION.json";
const reportFilename = "INFORME DE REVISION.md";
const visualReportFilename = "INFORME DE REVISION.html";
const photoMapFilename = "ASOCIACION DE FOTOS.json";
const registryRelativePath = path.join("data", "import-history", "listado-notas.json");
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emptyRegistry = { version: 1, entries: [] };

function digest() {
  return createHash("sha256");
}

async function hashFile(filename) {
  const hash = digest();
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

async function hashDirectory(filename) {
  const entries = await readdir(filename, { withFileTypes: true }).catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const files = entries.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map(entry => entry.name).sort((a, b) => a.localeCompare(b, "es"));
  const hash = digest();
  for (const name of files) {
    hash.update(name);
    hash.update(await hashFile(path.join(filename, name)));
  }
  return { hash: hash.digest("hex"), files };
}

async function readRegistry(repositoryRoot) {
  const filename = path.join(repositoryRoot, registryRelativePath);
  let registry;
  try {
    registry = JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return structuredClone(emptyRegistry);
    throw new Error(`No pude leer el registro persistente de importaciones: ${error.message}`);
  }
  if (registry?.version !== 1 || !Array.isArray(registry.entries)) {
    throw new Error("El registro persistente de importaciones tiene un formato inválido; no se importó nada.");
  }
  const keys = new Set();
  for (const entry of registry.entries) {
    if (typeof entry?.sourceKey !== "string" || !/^[a-f0-9]{64}$/i.test(entry.sourceKey)
      || typeof entry?.productId !== "string" || !uuidV4Pattern.test(entry.productId)
      || keys.has(entry.sourceKey)) {
      throw new Error("El registro persistente contiene una entrada inválida o repetida; no se importó nada.");
    }
    keys.add(entry.sourceKey);
  }
  return registry;
}

async function readPhotoMap(preparationRoot) {
  const filename = path.join(preparationRoot, photoMapFilename);
  let photoMap;
  try {
    photoMap = JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, assignments: [] };
    throw new Error(`No pude leer la asociación de fotos: ${error.message}`);
  }
  if (photoMap?.version !== 1 || !Array.isArray(photoMap.assignments)) {
    throw new Error("ASOCIACION DE FOTOS.json tiene un formato inválido; no se importó nada.");
  }
  const sourceIndices = new Set();
  for (const assignment of photoMap.assignments) {
    if (!Number.isInteger(assignment?.sourceIndex) || assignment.sourceIndex < 1 || sourceIndices.has(assignment.sourceIndex)
      || !Array.isArray(assignment.photos) || assignment.photos.length === 0) {
      throw new Error("ASOCIACION DE FOTOS.json contiene un bloque inválido o repetido.");
    }
    sourceIndices.add(assignment.sourceIndex);
    for (const photo of assignment.photos) {
      if (typeof photo?.file !== "string" || !photo.file.trim() || !["cover", "gallery"].includes(photo.role)) {
        throw new Error("Cada foto asociada debe indicar el archivo y el rol cover o gallery.");
      }
    }
  }
  return photoMap;
}

function isNonIdentityLine(line) {
  return /^\$\s*\d/u.test(line)
    || /^(?:precio|price)\s*[:=\-]?\s*\$?\s*\d/iu.test(line)
    || /^(?:disponibilidad|availability)\s*[:=\-]?\s*(?:disponible|reservado|vendido|available|reserved|sold)\b/iu.test(line)
    || /^(?:publicad[oa]|publicar|visible)(?:\s+en\s+(?:el\s+)?cat[aá]logo)?\s*[:=\-]?\s*(?:s[ií]|no|yes|true|false|1|0)\b/iu.test(line)
    || /^(?:carpeta\s+(?:de\s+)?fotos|fotos\s+de\s+carpeta)\s*[:=\-]/iu.test(line)
    || /^(?:importar\s+como\s+)?(?:ejemplar\s+independiente|nuevo\s+ejemplar|otro\s+ejemplar|ejemplar\s+distinto|ya\s+est[aá]\s+cargad[oa]|ya\s+existe\s+en\s+cat[aá]logo|vincular\s+existente)\s*[:=\-]?\s*(?:s[ií]|no|yes|true|false|1|0)\b/iu.test(line);
}

function sourceKeys(products) {
  const counts = new Map();
  return products.map(product => {
    const stableLines = product.sourceBlock
      .filter(line => !isNonIdentityLine(line))
      .map(line => normalizeMatchName(line))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "es"));
    const base = JSON.stringify({
      lines: stableLines,
      photoFolder: product.photoFolder ? normalizeMatchName(product.photoFolder) : ""
    });
    const occurrence = (counts.get(base) ?? 0) + 1;
    counts.set(base, occurrence);
    const sourceKey = digest().update(`${base}\n#${occurrence}`).digest("hex");
    return { ...product, sourceKey };
  });
}

async function photoInventory(photoRoot) {
  const folders = await readdir(photoRoot, { withFileTypes: true }).catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const inventory = [];
  const imageData = async (directory, entries, relativeDirectory = "") => {
    const images = [];
    for (const entry of entries.filter(item => item.isFile() && imageExtensions.has(path.extname(item.name).toLowerCase()))) {
      const imagePath = path.join(directory, entry.name);
      const info = await stat(imagePath);
      const stem = path.parse(entry.name).name;
      const suffix = stem.lastIndexOf("__");
      images.push({
        name: entry.name,
        fileRef: relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name,
        sourceDirectory: relativeDirectory,
        role: suffix >= 0 ? stem.slice(suffix + 2).toLocaleLowerCase("es") : "",
        sha256: await hashFile(imagePath),
        size: info.size
      });
    }
    return images.sort((a, b) => a.name.localeCompare(b.name, "es"));
  };

  for (const folder of folders.filter(entry => entry.isDirectory() && !entry.name.startsWith("."))) {
    const folderPath = path.join(photoRoot, folder.name);
    const entries = await readdir(folderPath, { withFileTypes: true });
    inventory.push({ name: folder.name, sourceDirectory: folder.name, images: await imageData(folderPath, entries, folder.name) });
  }

  const flatGroups = new Map();
  for (const entry of folders.filter(item => item.isFile() && imageExtensions.has(path.extname(item.name).toLowerCase()))) {
    const stem = path.parse(entry.name).name;
    const suffix = stem.lastIndexOf("__");
    const groupName = suffix >= 0 ? stem.slice(0, suffix) : stem;
    const group = flatGroups.get(groupName) ?? { name: groupName, sourceDirectory: "", images: [] };
    group.images.push(...await imageData(photoRoot, [entry]));
    flatGroups.set(groupName, group);
  }
  inventory.push(...flatGroups.values());
  inventory.sort((a, b) => a.name.localeCompare(b.name, "es"));
  return inventory;
}

async function catalogRecords(repositoryRoot) {
  const recordsPath = path.join(repositoryRoot, "data", "vinilos");
  const entries = await readdir(recordsPath, { withFileTypes: true });
  const records = [];
  for (const entry of entries.filter(item => item.isFile() && item.name.toLowerCase().endsWith(".json"))) {
    const record = JSON.parse(await readFile(path.join(recordsPath, entry.name), "utf8"));
    records.push({ ...record, _sourceFile: entry.name });
  }
  return records;
}

function tokenSimilarity(first, second) {
  const a = new Set(normalizeMatchName(first).split(" ").filter(Boolean));
  const b = new Set(normalizeMatchName(second).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter(token => b.has(token)).length;
  return overlap / Math.max(a.size, b.size);
}

function findDuplicates(product, candidates) {
  const artist = normalizeMatchName(product.artist ?? "");
  const album = normalizeMatchName(product.album ?? "");
  if (!album) return [];
  const matches = [];
  for (const candidate of candidates) {
    const otherArtist = normalizeMatchName(candidate.artist ?? "");
    const otherAlbum = normalizeMatchName(candidate.album ?? "");
    if (!otherAlbum) continue;

    if (album === otherAlbum) {
      const sameArtist = artist && otherArtist && artist === otherArtist;
      matches.push({ kind: sameArtist ? "exacto" : "posible", artist: candidate.artist || "(sin artista)", album: candidate.album, productId: candidate.id, source: candidate._sourceFile || `vinilo ${candidate.sourceIndex}` });
      continue;
    }

    if ((artist && otherArtist && artist === otherArtist && tokenSimilarity(product.album, candidate.album) >= 0.75)
      || tokenSimilarity(`${product.artist ?? ""} ${product.album ?? ""}`, `${candidate.artist ?? ""} ${candidate.album ?? ""}`) >= 0.85) {
      matches.push({ kind: "posible", artist: candidate.artist || "(sin artista)", album: candidate.album, productId: candidate.id, source: candidate._sourceFile || `vinilo ${candidate.sourceIndex}` });
    }
  }
  return matches;
}

function aliasesFor(product) {
  const variants = [];
  if (product.album) variants.push(product.album);
  if (product.artist && product.album) {
    variants.push(`${product.artist} ${product.album}`, `${product.album} ${product.artist}`);
  }
  return new Set(variants.map(normalizeMatchName).filter(Boolean));
}

function chooseCover(images) {
  if (!images.length) return { cover: undefined, gallery: [], issue: undefined };
  const covers = images.filter(image => ["tapa", "portada"].includes(image.role || path.parse(image.name).name.toLocaleLowerCase("es")));
  if (covers.length > 1) return { cover: undefined, gallery: [], issue: `Hay más de una candidata a tapa: ${covers.map(image => image.name).join(", ")}.` };
  if (covers.length === 1) return { cover: covers[0].fileRef, gallery: images.filter(image => image.fileRef !== covers[0].fileRef).map(image => image.fileRef) };
  if (images.length === 1) return { cover: images[0].fileRef, gallery: [] };
  return { cover: undefined, gallery: [], issue: `La carpeta tiene varias fotos pero ninguna se llama tapa.* o portada.*: ${images.map(image => image.name).join(", ")}.` };
}

function assignPhotos(products, inventory, photoMap) {
  const allImages = inventory.flatMap(folder => folder.images);
  const imagesByFile = new Map(allImages.map(image => [image.fileRef.toLocaleLowerCase("es"), image]));
  const assignmentsByIndex = new Map(photoMap.assignments.map(assignment => [assignment.sourceIndex, assignment]));
  const mappedFileUseCount = new Map();
  for (const assignment of photoMap.assignments) {
    for (const photo of assignment.photos) {
      const key = photo.file.toLocaleLowerCase("es");
      mappedFileUseCount.set(key, (mappedFileUseCount.get(key) ?? 0) + 1);
    }
  }
  const autoInventory = inventory.map(folder => ({
    ...folder,
    images: folder.images.filter(image => !mappedFileUseCount.has(image.fileRef.toLocaleLowerCase("es")))
  }));
  const folderNames = autoInventory.filter(folder => folder.images.length).map(folder => folder.name);
  const exactByProduct = products.map(product => {
    if (assignmentsByIndex.has(product.sourceIndex)) return [];
    if (product.photoFolder) {
      const requested = normalizeMatchName(product.photoFolder);
      return autoInventory.filter(folder => normalizeMatchName(folder.name) === requested);
    }
    const aliases = aliasesFor(product);
    return autoInventory.filter(folder => folder.images.length && aliases.has(normalizeMatchName(folder.name)));
  });
  const useCount = new Map();
  for (const matches of exactByProduct) {
    for (const folder of matches) useCount.set(folder.name, (useCount.get(folder.name) ?? 0) + 1);
  }

  return products.map((product, index) => {
    const assignment = assignmentsByIndex.get(product.sourceIndex);
    if (assignment) {
      const issues = [];
      const chosen = [];
      const seenFiles = new Set();
      for (const photo of assignment.photos) {
        const normalizedRef = photo.file.toLocaleLowerCase("es");
        const image = imagesByFile.get(normalizedRef);
        if (!image) {
          issues.push(`No se encontró el adjunto «${photo.file}» indicado para este vinilo.`);
          continue;
        }
        if (seenFiles.has(normalizedRef)) {
          issues.push(`El adjunto «${photo.file}» está repetido en la asociación de este vinilo.`);
          continue;
        }
        if (mappedFileUseCount.get(normalizedRef) > 1) {
          issues.push(`El adjunto «${photo.file}» fue asignado a más de un vinilo.`);
          continue;
        }
        seenFiles.add(normalizedRef);
        chosen.push({ ...image, assignedRole: photo.role });
      }
      const covers = chosen.filter(image => image.assignedRole === "cover");
      if (chosen.length && covers.length !== 1) issues.push("La asociación visual debe tener exactamente una fotografía principal por vinilo.");
      return {
        status: "asociación visual del chat",
        folder: "Adjuntos asociados por Codex",
        cover: covers.length === 1 ? covers[0].fileRef : undefined,
        gallery: chosen.filter(image => image.assignedRole === "gallery").map(image => image.fileRef),
        images: chosen.map(image => image.fileRef),
        issues
      };
    }
    const exact = exactByProduct[index];
    const issues = [];
    if (product.photoFolder && exact.length === 0) {
      issues.push(`La carpeta de fotos indicada «${product.photoFolder}» no existe o no coincide exactamente con un nombre de carpeta.`);
      return { status: "carpeta indicada no encontrada", folder: undefined, cover: undefined, gallery: [], images: [], issues };
    }
    if (exact.length > 1) {
      issues.push(`Hay varias carpetas con coincidencia exacta: ${exact.map(folder => folder.name).join(", ")}.`);
      return { status: "ambiguo", folder: undefined, cover: undefined, gallery: [], images: [], issues };
    }
    if (exact.length === 1 && useCount.get(exact[0].name) > 1) {
      issues.push(`La carpeta «${exact[0].name}» coincide con más de un vinilo del listado.`);
      return { status: "ambiguo", folder: exact[0].name, sourceDirectory: exact[0].sourceDirectory, cover: undefined, gallery: [], images: exact[0].images.map(image => image.fileRef), issues };
    }
    if (exact.length === 1) {
      const folder = exact[0];
      const selection = chooseCover(folder.images);
      if (selection.issue) issues.push(selection.issue);
      return { status: selection.issue ? "ambiguo" : folder.images.length ? "coincidencia exacta" : "carpeta vacía", folder: folder.name, sourceDirectory: folder.sourceDirectory, cover: selection.cover, gallery: selection.gallery, images: folder.images.map(image => image.fileRef), issues };
    }

    const similar = similarNameCandidates(product, folderNames);
    if (similar.length) {
      issues.push(`Hay carpetas con nombres parecidos y no se asociaron automáticamente: ${similar.join(", ")}.`);
      return { status: "posible coincidencia; revisar", folder: undefined, cover: undefined, gallery: [], images: [], candidates: similar, issues };
    }
    return { status: "sin coincidencia", folder: undefined, cover: undefined, gallery: [], images: [], issues };
  }).map((photo, index) => ({ ...products[index], photo }));
}

function candidateTitle(product) {
  return [product.artist, product.album].filter(Boolean).join(" — ") || "Vinilo sin título";
}

function visibleStatus(product) {
  return product.published === true ? "Visible (indicado expresamente en la nota)" : "Oculto (por defecto)";
}

function operationLabel(operation) {
  return ({
    create: "Nuevo: listo para aprobación",
    already_imported: "Ya importado antes; se omite",
    adopt_existing: "Ya existe en Pages CMS; se vinculará sin crear otro producto",
    pending_duplicate: "Pendiente: posible duplicado; requiere decisión",
    blocked: "Detenido: revisar los errores indicados"
  })[operation] ?? "Pendiente de revisión";
}

function reviewReport(products, inventory, unusedPhotoFiles, sourcePath) {
  const lines = [
    "# Informe de revisión — Lucuma Records",
    "",
    `Archivo revisado: \`${path.basename(sourcePath)}\``,
    `Vinilos identificados: **${products.length}**`,
    `Nuevos para importar: **${products.filter(product => product.operation === "create").length}**`,
    `Ya importados (se omiten): **${products.filter(product => product.operation === "already_imported").length}**`,
    `Para vincular con Pages CMS: **${products.filter(product => product.operation === "adopt_existing").length}**`,
    `Pendientes o detenidos: **${products.filter(product => product.blocked).length}**`,
    "",
    "Este informe es una vista previa. No se crearon productos ni se copiaron fotografías al catálogo.",
    ""
  ];
  if (!products.length) {
    lines.push("Todavía no hay publicaciones para revisar. Pegá el contenido de Notas en el TXT y volvé a generar el informe.", "");
  }

  products.forEach((product, index) => {
    const photos = product.photo.images.length
      ? `${product.photo.folder ?? "Sin carpeta asociada"}: ${product.photo.images.join(", ")}`
      : product.photo.candidates?.length ? `Pendiente de asociación; carpetas parecidas: ${product.photo.candidates.join(", ")}` : "Ninguna";
    const missing = product.missing.length ? product.missing.join(", ") : "Ninguno de los campos principales";
    const duplicates = product.duplicates.length
      ? product.duplicates.map(match => `${match.kind}: ${match.artist} — ${match.album} (${match.source})`).join("; ")
      : product.identityWarning ? `No se pudo comprobar: ${product.identityWarning}` : "No se encontraron coincidencias con los registros actuales ni con otros títulos completos del listado.";
    lines.push(
      `## ${index + 1}. ${candidateTitle(product)}`,
      "",
      `- **Artista:** ${product.artist || "(vacío)"}`,
      `- **Álbum:** ${product.album || "(vacío)"}`,
      `- **Edición indicada:** ${product.editionDescription || product.editionType || "(vacía)"}`,
      `- **País:** ${product.country || "(vacío)"}`,
      `- **Año:** ${product.year || "(vacío)"}`,
      `- **Género:** ${product.genre || "(vacío)"}`,
      `- **Colección principal:** ${product.collection ? ({"rock-nacional":"Rock Nacional","rock-internacional":"Rock Internacional","hard-rock-metal":"Hard Rock / Metal",jazz:"Jazz",otros:"Otros"}[product.collection] || product.collection) : "(sin asignar)"}`,
      `- **Confianza de la clasificación:** ${product.classificationConfidence || "Sin clasificar"}`,
      ...(product.classificationSources?.length ? [`- **Fuentes de clasificación:** ${product.classificationSources.join("; ")}`] : []),
      ...(product.classificationWarning ? [`- **Advertencia de clasificación:** ${product.classificationWarning}`] : []),
      ...(product.genreSuggestions?.length ? [`- **Sugerencias de género (MusicBrainz, revisar):** ${product.genreSuggestions.map(item => `${item.label} (${item.count} votos; ${item.url})`).join("; ")}`] : product.genreSuggestionStatus ? [`- **Sugerencias de género:** ${product.genreSuggestionStatus}`] : []),
      `- **Estado de tapa:** ${product.coverCondition || "(vacío)"}`,
      `- **Estado del disco:** ${product.vinylCondition || "(vacío)"}`,
      `- **Extras:** ${[...(product.extras ?? []), product.otherExtras].filter(Boolean).join(", ") || "(vacíos)"}`,
      `- **Observaciones:** ${product.notes || "(vacías)"}`,
      `- **Precio:** ${product.priceARS ? `$ ${new Intl.NumberFormat("es-AR").format(product.priceARS)}` : "(vacío)"}`,
      ...(product.photoFolder ? [`- **Carpeta de fotos indicada:** ${product.photoFolder}`] : []),
      `- **Fotografías asociadas:** ${photos}`,
      `- **Datos faltantes:** ${missing}`,
      `- **Ambigüedades:** ${[...product.issues, ...product.photo.issues].join("; ") || "Ninguna"}`,
      `- **Posibles duplicados:** ${duplicates}`,
      `- **Visibilidad prevista:** ${visibleStatus(product)}`,
      `- **Resultado:** ${operationLabel(product.operation)}`,
      ...(product.blockingIssues.length ? [`- **Requiere resolver:** ${product.blockingIssues.join("; ")}`] : []),
      ""
    );
  });

  if (inventory.length) {
    lines.push("## Fotografías sin asociar", "", ...(unusedPhotoFiles.length ? unusedPhotoFiles.map(name => `- ${name}`) : ["- Ninguna"]), "");
  }
  lines.push(
    "Si un título coincide con un producto existente pero es otro ejemplar, agregá dentro de ese bloque `Ejemplar independiente: sí` y generá un informe nuevo.",
    "Si corresponde al mismo producto que ya cargaste desde Pages CMS, agregá `Ya está cargado: sí`; se vinculará al registro existente solo cuando haya una única coincidencia exacta.",
    "Para asociar imágenes sin carpetas, guardalas directamente en FOTOS DE VINILOS como `Artista - Álbum__tapa.jpg`, `Artista - Álbum__contratapa.jpg` o `Artista - Álbum__foto-02.jpg`. Para varias copias del mismo disco, agregá `__copia-1`/`__copia-2` al grupo e indicá `Carpeta de fotos: <grupo exacto>`.",
    "Los registros que ya figuran en el historial se omiten aunque Pages CMS haya cambiado su precio, fotos o disponibilidad.",
    "Después de aprobar el informe, pedime que vuelva a validar la tanda. No ejecutes la fase de importación hasta aprobarla.",
    ""
  );
  return lines.join("\n");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function reportImagePath(fileRef) {
  const imagePath = `${photoFolderName}/${fileRef}`;
  return imagePath.split("/").map(encodeURIComponent).join("/");
}

function reviewReportHtml(products, unusedPhotoFiles) {
  const productCards = products.map((product, index) => {
    const cover = product.photo.cover
      ? `<img class="cover" src="${escapeHtml(reportImagePath(product.photo.cover))}" alt="Tapa de ${escapeHtml(candidateTitle(product))}">`
      : `<div class="empty-photo">Sin fotografía principal asignada</div>`;
    const gallery = product.photo.gallery.length
      ? `<div class="gallery">${product.photo.gallery.map(file => `<figure><img src="${escapeHtml(reportImagePath(file))}" alt="Foto adicional de ${escapeHtml(candidateTitle(product))}"><figcaption>${escapeHtml(file)}</figcaption></figure>`).join("")}</div>`
      : "";
    const rows = [
      ["Artista", product.artist], ["Álbum", product.album], ["País / año", [product.country, product.year].filter(Boolean).join(" · ")],
      ["Edición", product.editionDescription || product.editionType], ["Género informado", product.genre],
      ["Colección principal", product.collection ? ({"rock-nacional":"Rock Nacional","rock-internacional":"Rock Internacional","hard-rock-metal":"Hard Rock / Metal",jazz:"Jazz",otros:"Otros"}[product.collection] || product.collection) : undefined],
      ["Confianza de clasificación", product.classificationConfidence],
      ["Fuentes de clasificación", product.classificationSources?.join("; ")],
      ["Estado de clasificación", product.classificationPending ? "PENDIENTE DE REVISIÓN" : "Clasificación confirmada"],
      ["Sugerencias de género (revisar)", product.genreSuggestions?.length ? product.genreSuggestions.map(item => `${item.label} (${item.count} votos) — ${item.url}`).join("; ") : product.genreSuggestionStatus],
      ["Estado tapa", product.coverCondition], ["Estado disco", product.vinylCondition],
      ["Extras", [...(product.extras ?? []), product.otherExtras].filter(Boolean).join(", ")],
      ["Observaciones", product.notes], ["Precio", product.priceARS ? `$ ${new Intl.NumberFormat("es-AR").format(product.priceARS)}` : undefined],
      ["Disponibilidad", product.availability], ["Visibilidad", visibleStatus(product)]
    ].filter(([, value]) => value !== undefined && value !== null && value !== "");
    const details = rows.length
      ? `<dl>${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>`
      : `<p class="muted">Sin datos descriptivos; se revisará con su identificador técnico.</p>`;
    const duplicates = product.duplicates.length
      ? `<p class="warning"><strong>Posibles coincidencias:</strong> ${escapeHtml(product.duplicates.map(item => `${item.artist} — ${item.album} (${item.source})`).join("; "))}</p>`
      : "";
    const issues = product.blockingIssues.length
      ? `<p class="warning"><strong>Revisión necesaria:</strong> ${escapeHtml(product.blockingIssues.join("; "))}</p>`
      : "";
    const classificationWarning = product.classificationWarning
      ? `<p class="warning"><strong>Clasificación provisional:</strong> ${escapeHtml(product.classificationWarning)}</p>`
      : "";
    return `<article><header><span>Lote · ${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(operationLabel(product.operation))}</strong></header><h2>${escapeHtml(candidateTitle(product))}</h2><div class="layout"><div>${cover}${gallery}</div><div>${details}${duplicates}${classificationWarning}${issues}</div></div></article>`;
  }).join("");
  const unused = unusedPhotoFiles.length
    ? `<section><h2>Fotos sin asociar</h2><p>Quedaron en el área de preparación y no se asignarán hasta revisarlas.</p><ul>${unusedPhotoFiles.map(file => `<li>${escapeHtml(file)}</li>`).join("")}</ul></section>`
    : "";
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Revisión de lote · Lucuma Records</title>
<style>
:root{color-scheme:light;--paper:#f3eedf;--ink:#171717;--line:#d9d2c5;--muted:#716d65;--warn:#7d321f}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 Arial,sans-serif}.page{max-width:1120px;margin:auto;padding:32px 22px 64px}h1{font-size:clamp(26px,4vw,42px);line-height:1.05;margin:0 0 8px;text-transform:uppercase;letter-spacing:.02em}.intro,.muted{color:var(--muted)}article,section{background:#fffdf8;border:1px solid var(--line);padding:22px;margin:22px 0}article>header{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid var(--line);padding-bottom:10px;text-transform:uppercase;letter-spacing:.08em;font-size:12px}article h2{font-size:24px;margin:16px 0}.layout{display:grid;grid-template-columns:minmax(220px,38%) 1fr;gap:24px}.cover{display:block;width:100%;height:auto;max-height:520px;object-fit:contain;background:#ece7de}.empty-photo{min-height:240px;display:grid;place-items:center;text-align:center;padding:20px;background:#ece7de;color:var(--muted)}.gallery{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}.gallery figure{margin:0;width:calc(33.333% - 8px)}.gallery img{display:block;width:100%;height:100px;object-fit:contain;background:#ece7de}.gallery figcaption{font-size:11px;overflow-wrap:anywhere;color:var(--muted)}dl{margin:0}dl>div{display:grid;grid-template-columns:135px 1fr;gap:12px;border-bottom:1px solid #ebe6dd;padding:8px 0}dt{font-weight:700}dd{margin:0;overflow-wrap:anywhere}.warning{padding:11px 13px;background:#f8eee8;color:var(--warn);overflow-wrap:anywhere}.badge{display:inline-block;background:#171717;color:white;padding:6px 9px;font-size:12px;text-transform:uppercase}.empty{padding:28px 0}@media(max-width:680px){.page{padding:24px 14px 40px}article,section{padding:15px}.layout{grid-template-columns:1fr;gap:16px}.cover{max-height:420px}.gallery figure{width:calc(50% - 5px)}article>header{font-size:10px}article h2{font-size:21px}dl>div{grid-template-columns:110px 1fr}}
</style></head><body><main class="page"><h1>Revisión visual del lote</h1><p class="intro">Lucuma Records · ${products.length} publicación(es). Vista previa local: todavía no se creó ni publicó ningún producto.</p>${products.length ? productCards : `<p class="empty">Todavía no hay publicaciones para revisar. Enviá el texto y las fotos del lote y volvé a generar el informe.</p>`}${unused}</main></body></html>`;
}

async function gitValue(repositoryRoot, args, gitRunner = execFileSync) {
  return gitRunner("git", args, { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function snapshot(repositoryRoot, preparationRoot, gitRunner = execFileSync) {
  const listPath = path.join(preparationRoot, listFilename);
  const photoRoot = path.join(preparationRoot, photoFolderName);
  const listStat = await stat(listPath).catch(() => null);
  if (!listStat?.isFile()) throw new Error(`Falta el archivo ${listFilename} en ${preparationRoot}.`);
  const registryPath = path.join(repositoryRoot, registryRelativePath);
  const photoMapPath = path.join(preparationRoot, photoMapFilename);
  const [listHash, photos, catalog, registryHash, photoMapHash] = await Promise.all([
    hashFile(listPath),
    photoInventory(photoRoot),
    hashDirectory(path.join(repositoryRoot, "data", "vinilos")),
    hashFile(registryPath).catch(error => {
      if (error.code === "ENOENT") return digest().update(JSON.stringify(emptyRegistry)).digest("hex");
      throw error;
    }),
    hashFile(photoMapPath).catch(error => {
      if (error.code === "ENOENT") return digest().update(JSON.stringify({ version: 1, assignments: [] })).digest("hex");
      throw error;
    })
  ]);
  return {
    listPath,
    photoRoot,
    listHash,
    photos,
    photosHash: digest().update(JSON.stringify(photos)).digest("hex"),
    catalogHash: catalog.hash,
    catalogFiles: catalog.files,
    registryHash,
    photoMapHash,
    headSha: await gitValue(repositoryRoot, ["rev-parse", "HEAD"], gitRunner)
  };
}

export function materializeParsed(parsed, existingRecords, photoInventoryEntries, registry, photoMap = { version: 1, assignments: [] }) {
  const keyed = sourceKeys(parsed);
  const withPhotos = assignPhotos(keyed, photoInventoryEntries, photoMap);
  const registryByKey = new Map(registry.entries.map(entry => [entry.sourceKey, entry]));
  const existingById = new Map(existingRecords.map(record => [record.id, record]));

  return withPhotos.map(product => {
    const history = registryByKey.get(product.sourceKey);
    const historyRecord = history ? existingById.get(history.productId) : undefined;
    const duplicates = historyRecord ? [] : [
      ...findDuplicates(product, existingRecords),
      ...findDuplicates(product, withPhotos.filter(candidate => candidate !== product))
    ];
    const issues = [...product.issues, ...product.photo.issues];
    let operation;
    let linkedProductId;

    if (history) {
      if (historyRecord) {
        operation = "already_imported";
        linkedProductId = history.productId;
      } else {
        operation = "blocked";
        issues.push(`El registro histórico apunta al producto ${history.productId}, que ya no está en data/vinilos. Revisá el historial antes de continuar.`);
      }
    } else if (product.adoptExisting) {
      const exact = duplicates.filter(match => match.kind === "exacto" && uuidV4Pattern.test(match.productId ?? ""));
      if (duplicates.length === 1 && exact.length === 1) {
        operation = "adopt_existing";
        linkedProductId = exact[0].productId;
      } else {
        operation = "blocked";
        issues.push("Para vincular un producto existente debe haber una única coincidencia exacta de artista y álbum.");
      }
    } else if (duplicates.length && !product.confirmSeparateCopy) {
      operation = "pending_duplicate";
      issues.push("Hay una coincidencia posible. Agregá «Ejemplar independiente: sí» para autorizar una copia distinta, o «Ya está cargado: sí» para vincular una única coincidencia exacta.");
    } else {
      operation = "create";
    }

    product.duplicates = duplicates;
    product.operation = operation;
    product.linkedProductId = linkedProductId;
    product.blockingIssues = [...new Set(issues)];
    product.blocked = operation === "blocked" || operation === "pending_duplicate" || issues.length > 0;
    return product;
  });
}

export function allocateProductIds(products, existingRecords) {
  const ids = new Set(existingRecords.map(record => record.id).filter(Boolean));
  return products.map(product => {
    if (product.operation === "already_imported" || product.operation === "adopt_existing") {
      return { ...product, id: product.linkedProductId };
    }
    if (product.operation !== "create") return product;
    let id;
    do { id = randomUUID(); } while (ids.has(id));
    ids.add(id);
    return { ...product, id };
  });
}

function sourceRecord(product, id) {
  const record = { id, published: product.published === true };
  for (const field of ["artist", "album", "genre", "collection", "country", "year", "editionType", "coverCondition", "vinylCondition", "extras", "otherExtras", "notes", "priceARS", "availability"]) {
    if (product[field] !== undefined && product[field] !== null && product[field] !== "") record[field] = product[field];
  }
  if (product.classificationPending === true) record.classificationPending = true;
  return record;
}

function safeFilename(name) {
  const extension = path.extname(name).toLowerCase();
  const stem = path.basename(name, path.extname(name)).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "foto";
  return `${stem}${extension}`;
}

function withUniquePhotoNames(names) {
  const used = new Set();
  return names.map(name => {
    const safe = safeFilename(name);
    const extension = path.extname(safe);
    const stem = path.basename(safe, extension);
    let candidate = safe;
    let suffix = 2;
    while (used.has(candidate.toLowerCase())) candidate = `${stem}-${suffix++}${extension}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

export async function createListReview({ repositoryRoot, preparationRoot, gitRunner = execFileSync, genreLookup = true, fetchImpl = globalThis.fetch }) {
  const current = await snapshot(repositoryRoot, preparationRoot, gitRunner);
  const raw = await readFile(current.listPath, "utf8");
  const existing = await catalogRecords(repositoryRoot);
  const registry = await readRegistry(repositoryRoot);
  const photoMap = await readPhotoMap(preparationRoot);
  const parsed = parseVinylList(raw);
  for (const record of parsed) {
    const lookup = genreLookup && !record.genre && record.artist && record.album
      ? await suggestGenres(record, fetchImpl)
      : { suggestions: [], status: genreLookup ? "No se necesitó consulta externa o falta artista/álbum." : "Consulta externa desactivada." };
    record.genreSuggestions = lookup.suggestions ?? [];
    record.genreSuggestionStatus = lookup.status;
    const classification = classifyVinyl(record, lookup);
    if (!record.genre && classification.genre) record.genre = classification.genre;
    if (!record.collection && classification.collection) record.collection = classification.collection;
    record.classificationPending = classification.pending;
    record.classificationConfidence = classification.confidence;
    record.classificationSources = classification.sources;
    record.classificationWarning = classification.warning;
    if (record.genre) record.missing = record.missing.filter(field => field !== "género");
  }
  if (photoMap.assignments.some(assignment => assignment.sourceIndex > parsed.length)) {
    throw new Error("ASOCIACION DE FOTOS.json refiere a un número de producto que no existe en el TXT. Actualizá la asociación y volvé a revisar.");
  }
  const products = allocateProductIds(materializeParsed(parsed, existing, current.photos, registry, photoMap), existing);
  const usedFiles = new Set(products.flatMap(product => product.photo.images ?? []));
  const unusedPhotoFiles = current.photos.flatMap(group => group.images.map(image => image.fileRef)).filter(file => !usedFiles.has(file));
  const blockingProducts = products.filter(product => product.blocked);
  const plan = {
    version: 3,
    createdAt: new Date().toISOString(),
    headSha: current.headSha,
    listHash: current.listHash,
    photosHash: current.photosHash,
    catalogHash: current.catalogHash,
    registryHash: current.registryHash,
    photoMapHash: current.photoMapHash,
    products: products.map(product => ({
      ...product,
      sourceBlock: product.sourceBlock,
      photo: product.photo
    })),
    unusedPhotoFiles
  };
  const planPath = path.join(preparationRoot, planFilename);
  const reportPath = path.join(preparationRoot, reportFilename);
  const visualReportPath = path.join(preparationRoot, visualReportFilename);
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  await writeFile(reportPath, reviewReport(products, current.photos, unusedPhotoFiles, current.listPath), "utf8");
  await writeFile(visualReportPath, reviewReportHtml(products, unusedPhotoFiles), "utf8");
  console.log(`Informe: ${reportPath}`);
  console.log(`Vista visual: ${visualReportPath}`);
  console.log(`Vinilos identificados: ${products.length}; nuevos: ${products.filter(product => product.operation === "create").length}; ya importados: ${products.filter(product => product.operation === "already_imported").length}; para vincular: ${products.filter(product => product.operation === "adopt_existing").length}; pendientes/detenidos: ${blockingProducts.length}; fotografías sin asignar: ${unusedPhotoFiles.length}.`);
  console.log("No se crearon productos ni se copiaron fotografías al catálogo.");
}

async function assertSynced(repositoryRoot, gitRunner = execFileSync) {
  let branch;
  try {
    branch = await gitValue(repositoryRoot, ["branch", "--show-current"], gitRunner);
    await gitValue(repositoryRoot, ["fetch", "origin"], gitRunner);
  } catch (error) {
    throw new Error(`No pude actualizar origin para proteger cambios de Pages CMS; no importé nada. ${error.message}`);
  }
  if (branch !== "main") throw new Error(`La importación debe hacerse desde main (rama actual: ${branch}). No se importó nada.`);
  const [head, originMain] = await Promise.all([
    gitValue(repositoryRoot, ["rev-parse", "HEAD"], gitRunner),
    gitValue(repositoryRoot, ["rev-parse", "origin/main"], gitRunner)
  ]);
  if (head !== originMain) throw new Error("origin/main cambió o la rama local no está sincronizada. Sincronizá Pages CMS, generá un nuevo informe y revisá la tanda otra vez.");
  return head;
}

export async function importReviewedList({ repositoryRoot, preparationRoot, gitRunner = execFileSync }) {
  const planPath = path.join(preparationRoot, planFilename);
  const planInfo = await stat(planPath).catch(() => null);
  if (!planInfo?.isFile()) throw new Error(`No existe ${planFilename}. Primero generá el informe con --review-list.`);
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  if (plan.version !== 3 || !Array.isArray(plan.products)) throw new Error("El plan de revisión no tiene el formato vigente. Generá un informe nuevo.");
  if (plan.products.some(product => product.blocked)) {
    const titles = plan.products.filter(product => product.blocked).map(product => `#${product.sourceIndex} ${candidateTitle(product)}`).join("; ");
    throw new Error(`La importación se detuvo sin escribir archivos porque hay productos que requieren revisión: ${titles}. Corregí el listado o la asociación de fotos y volvé a generar el informe.`);
  }

  const current = await snapshot(repositoryRoot, preparationRoot, gitRunner);
  if (current.listHash !== plan.listHash || current.photosHash !== plan.photosHash || current.catalogHash !== plan.catalogHash || current.registryHash !== plan.registryHash || current.photoMapHash !== plan.photoMapHash || current.headSha !== plan.headSha) {
    throw new Error("El listado, las fotos, sus asociaciones, Pages CMS, el historial de importaciones o el commit cambiaron desde el informe. No importé nada; generá y revisá un informe nuevo.");
  }
  await assertSynced(repositoryRoot, gitRunner);
  const fresh = await snapshot(repositoryRoot, preparationRoot, gitRunner);
  if (fresh.listHash !== plan.listHash || fresh.photosHash !== plan.photosHash || fresh.catalogHash !== plan.catalogHash || fresh.registryHash !== plan.registryHash || fresh.photoMapHash !== plan.photoMapHash || fresh.headSha !== plan.headSha) {
    throw new Error("Los datos cambiaron durante la comprobación de Git. No importé nada; generá un informe nuevo.");
  }

  const existing = await catalogRecords(repositoryRoot);
  const existingIds = new Set(existing.map(product => product.id).filter(Boolean));
  const registry = await readRegistry(repositoryRoot);
  const photoMap = await readPhotoMap(preparationRoot);
  const parsed = parseVinylList(await readFile(fresh.listPath, "utf8"));
  if (photoMap.assignments.some(assignment => assignment.sourceIndex > parsed.length)) {
    throw new Error("ASOCIACION DE FOTOS.json refiere a un producto inexistente. No importé nada; generá y revisá un informe nuevo.");
  }
  const checked = materializeParsed(parsed, existing, fresh.photos, registry, photoMap);
  if (checked.length !== plan.products.length || checked.some((product, index) =>
    product.blocked
      || product.sourceKey !== plan.products[index].sourceKey
      || product.operation !== plan.products[index].operation)) {
    throw new Error("La revisión actual detectó diferencias, nuevas coincidencias o cambios en el historial. No importé nada; generá un informe nuevo.");
  }
  const products = checked.map((product, index) => {
    const reviewed = plan.products[index];
    return {
      ...product,
      genre: product.genre || reviewed.genre,
      collection: product.collection || reviewed.collection,
      classificationPending: reviewed.classificationPending === true,
      id: reviewed.id
    };
  });
  const createIds = products.filter(product => product.operation === "create").map(product => product.id);
  if (createIds.some(id => typeof id !== "string" || !uuidV4Pattern.test(id) || existingIds.has(id)) || new Set(createIds).size !== createIds.length) {
    throw new Error("El plan contiene identificadores nuevos repetidos, existentes o inválidos. No importé nada; generá un informe nuevo.");
  }
  for (const [index, product] of products.entries()) {
    if (product.operation !== "create" && product.id !== product.linkedProductId) {
      throw new Error(`El plan cambió el vínculo histórico del producto #${index + 1}. No importé nada; generá un informe nuevo.`);
    }
  }
  const recordRoot = path.join(repositoryRoot, "data", "vinilos");
  const mediaRoot = path.join(repositoryRoot, "assets", "catalogo");
  const createdPaths = [];
  const registryPath = path.join(repositoryRoot, registryRelativePath);
  const registryTempPath = `${registryPath}.${process.pid}.${randomUUID()}.tmp`;
  const registryEntries = [...registry.entries];
  const importedAt = new Date().toISOString();
  try {
    for (const product of products) {
      if (product.operation !== "create") continue;
      const recordPath = path.join(recordRoot, `${product.id}.json`);
      const currentRecord = sourceRecord(product, product.id);
      const originalPhotos = [...(product.photo.cover ? [product.photo.cover] : []), ...product.photo.gallery];
      const safePhotos = withUniquePhotoNames(originalPhotos);
      if (originalPhotos.length) {
        const mediaDirectory = path.join(mediaRoot, product.id);
        await mkdir(mediaDirectory);
        createdPaths.push(mediaDirectory);
        for (let index = 0; index < originalPhotos.length; index += 1) {
          const sourcePath = path.join(fresh.photoRoot, ...originalPhotos[index].split("/"));
          const destinationPath = path.join(mediaDirectory, safePhotos[index]);
          await copyFile(sourcePath, destinationPath, 1);
          if (index === 0) currentRecord.cover = `assets/catalogo/${product.id}/${safePhotos[index]}`;
          else {
            currentRecord.additionalPhotos ??= [];
            currentRecord.additionalPhotos.push(`assets/catalogo/${product.id}/${safePhotos[index]}`);
          }
        }
      }
      await writeFile(recordPath, `${JSON.stringify(currentRecord, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      createdPaths.push(recordPath);
    }
    const registeredKeys = new Set(registryEntries.map(entry => entry.sourceKey));
    for (const product of products.filter(item => item.operation === "create" || item.operation === "adopt_existing")) {
      if (registeredKeys.has(product.sourceKey)) throw new Error("El historial ya contiene una clave de origen repetida. No se completó la importación.");
      registryEntries.push({
        sourceKey: product.sourceKey,
        productId: product.id,
        importedAt,
        kind: product.operation === "adopt_existing" ? "linked-existing" : "created"
      });
      registeredKeys.add(product.sourceKey);
    }
    if (registryEntries.length !== registry.entries.length) {
      await writeFile(registryTempPath, `${JSON.stringify({ version: 1, entries: registryEntries }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      await rename(registryTempPath, registryPath);
    }
  } catch (error) {
    await rm(registryTempPath, { force: true }).catch(() => {});
    for (const filename of createdPaths.reverse()) await rm(filename, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  const createdCount = products.filter(product => product.operation === "create").length;
  const linkedCount = products.filter(product => product.operation === "adopt_existing").length;
  const skippedCount = products.filter(product => product.operation === "already_imported").length;
  console.log(`Revisión aplicada localmente: ${createdCount} producto(s) nuevo(s), ${linkedCount} vínculo(s) a Pages CMS y ${skippedCount} ya importado(s) omitido(s). No se modificaron registros existentes ni se hizo commit o push.`);
}
