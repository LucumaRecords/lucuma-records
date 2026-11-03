# Lucuma Records

El catálogo público se genera durante GitHub Actions desde los registros individuales de `data/vinilos/`. Pages CMS administra esos mismos archivos. `data/catalogo.json` en la raíz del proyecto es un archivo de soporte; el catálogo publicado se genera en el sitio desplegado.

## Tandas desde iPhone

Enviá en un único mensaje el listado completo copiado desde Notas y todas las fotografías. Al enviarlo, Codex considera cerrada la tanda; no hace falta un mensaje adicional.

### Fotografías

- Codex copia los adjuntos originales accesibles a `VINILOS PARA PUBLICAR/FOTOS DE VINILOS/Tanda-AAAA-MM-DD/`.
- Conserva los nombres y la calidad originales. Si algún nombre ya existe, agrega un sufijo para evitar sobrescribirlo.
- Las fotos quedan fuera de Git, se verifican después de copiarlas y se informa cuántas se guardaron.
- Codex no las abre para identificar discos, no las asocia con el texto y no crea rutas de fotos en los productos.
- Agregá las fotos manualmente desde Pages CMS. Las carpetas locales se conservan hasta que pidas eliminarlas.
- Si un adjunto no está accesible como archivo local, Codex informa la limitación y no lo cuenta como guardado.

### Textos

El parser acepta listados con un disco por bloque, bloques separados por una línea `-` y entradas en una línea con `•` como separador. Reconoce artista, álbum, bandera de país, edición, año, tapa, discos, extras, precio y disponibilidad indicados en el texto. Los campos ausentes permanecen vacíos. Género y colección solo se guardan si aparecen expresamente; no se investigan ni se asignan por defecto.

El comando de revisión lee solamente texto, los registros actuales y `data/import-history/listado-notas.json`. No lee la carpeta de fotos, no consulta Internet y no escribe planes ni informes:

```text
node scripts/import-text-batch.mjs check
```

Por defecto lee `VINILOS PARA PUBLICAR/LISTADO DE VINILOS.txt`; también acepta una ruta explícita al archivo. Informa cuántos vinilos detectó, cuáles están listos, cuáles ya figuran en el historial y cuáles necesitan revisión por duplicado o error de texto. Una duda afecta solo a ese producto.

Después de aprobar la tanda, aplicá los registros:

```text
node scripts/import-text-batch.mjs apply
```

El importador vuelve a sincronizar `origin/main` y consulta los registros y el historial antes de escribir. Crea solo las fichas seguras en `data/vinilos/`, sin fotografías. Las nuevas fichas aprobadas quedan con `published: true` y `availability: available`, salvo que el texto indique Reservado o Vendido. No modifica productos existentes. Los posibles duplicados o errores individuales quedan sin crear para revisarlos; el resto de la tanda puede continuar.

Tras aplicar una tanda, Codex hace commit y push a `main` y confirma GitHub Actions. Después, cargá manualmente las fotos, el género y la colección desde Pages CMS.

## Campos y catálogo

Todos los campos descriptivos son opcionales. Si el texto incluye una colección válida, se aceptan Rock Nacional, Rock Internacional, Hard Rock / Metal, Jazz, Pop u Otros. Una bandera europea no determina un país específico. Las distintas ediciones de un álbum se conservan por separado cuando el país, año o descripción de edición difieren.

Una ficha publicada puede no tener fotografía: el catálogo muestra su ilustración local de reemplazo. La foto principal y las imágenes adicionales se agregan después desde Pages CMS. No borres imágenes utilizadas por productos publicados; antes de borrar una imagen del catálogo, comprueba que ningún otro registro la use.

El historial persistente conserva las huellas de origen y los identificadores de importaciones previas para ayudar a evitar duplicados. No depende de los precios, las fotos ni la disponibilidad actuales, por lo que los cambios posteriores desde Pages CMS no vuelven a presentar un disco como nuevo.
