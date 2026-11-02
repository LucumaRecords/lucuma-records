# Datos del catálogo

El catálogo visible de `catalogo.html` se genera durante el despliegue de GitHub Pages. Pages CMS administra cada vinilo en un archivo JSON independiente dentro de `data/vinilos/`; el flujo de GitHub Actions normaliza esos registros y genera `data/catalogo.json` en el sitio publicado.

No se incluyen productos de ejemplo. Mientras la colección esté vacía, la página muestra el mensaje de próxima disponibilidad.

## Administración

- Todos los datos descriptivos, el precio, la disponibilidad y las fotografías son opcionales. El formulario omite la información vacía; no muestra campos sin datos ni un precio de $0.
- El identificador técnico se genera automáticamente y se usa como nombre del archivo.
- `genre` es texto libre y opcional (por ejemplo, Soul, Funk, Country, Folk, Pop, Blues o Rock Progresivo). `collection` es un campo separado y opcional para ubicar el disco en Rock Nacional, Rock Internacional, Hard Rock / Metal, Jazz u Otros. Dejar colección vacía no limita la venta ni el filtro general.
- La importación desde Notas consulta etiquetas del álbum en coincidencias exactas de MusicBrainz. Solo asigna género y colección cuando la evidencia es consistente; si no, deja el género vacío, propone Otros y marca `classificationPending: true` para revisión. La marca se conserva en Pages CMS pero no se muestra a los visitantes del catálogo.
- Los vinilos nuevos quedan ocultos. Activá «Visible en el catálogo» para publicarlos; si ese dato falta en un registro, el generador también lo trata como oculto.
- La foto principal y la galería son opcionales. Si una publicación visible no tiene foto, el catálogo muestra una ilustración local de un vinilo.
- Hasta confirmar la carga múltiple en la versión alojada de Pages CMS, subí las fotos de a una y luego agregalas/ordenalas en el campo de galería. Hay un reporte abierto reciente de errores al subir varias imágenes juntas: https://github.com/hunvreus/pagescms/issues/448.
- Para ocultar temporalmente un vinilo, desactivá «Visible en el catálogo». Esto lo quita de la web, pero el registro y las fotos siguen en GitHub.
- «Visible en el catálogo» controla la publicación en la web, no la privacidad: si el repositorio de GitHub es público, ese registro y sus fotos también pueden verse allí.
- «Disponibilidad» también es opcional. Si no se indica, no se muestra una etiqueta; para marcar una venta, elegí «Vendido» y para reservarlo, «Reservado».
- Si quitás una foto de un registro, solo se quita esa referencia. El archivo permanece en la biblioteca. Antes de borrar un archivo de imagen, comprobá que ningún otro vinilo lo use.
- Eliminar un registro es una acción permanente en Pages CMS; Git conserva el historial para poder recuperar el archivo si hiciera falta.

## Estructura de un registro

El archivo fuente de cada registro usa el identificador como nombre y solo necesita el identificador técnico y el estado de publicación. Los demás campos pueden faltar. En el catálogo generado, los productos contienen además `photos` (una lista vacía cuando no hay fotografías). Los registros antiguos que guardaban un código de portada en `genre` siguen filtrándose por esa colección; el código heredado `brasil` se interpreta como `otros`. Esa compatibilidad se aplica solo a códigos técnicos exactos, no al texto libre normal de un género.

## Método principal: enviar el lote al chat de Codex desde iPhone

En un solo mensaje, adjuntá todas las fotos y pegá el listado completo copiado desde Notas. Al enviar ese mensaje, Codex lo considera una tanda completa y prepara directamente el informe visual; no hace falta escribir una frase adicional. Si avisás que vas a mandar más material en otros mensajes, Codex espera tu confirmación antes de cerrar la tanda. No hace falta crear carpetas por disco ni renombrar fotos.

Codex revisa los adjuntos de la conversación y copia al área de preparación únicamente las imágenes que pueda abrir realmente. Las asocia con el listado por reconocimiento visual y coherencia de los títulos; si una asociación no es segura, la deja pendiente para revisión. Si el chat muestra una imagen pero no ofrece un archivo accesible para copiar, no se contará como recibida: usá la alternativa de OneDrive que sigue.

Las imágenes sin nombres descriptivos se revisarán visualmente y Codex generará `VINILOS PARA PUBLICAR/ASOCIACION DE FOTOS.json`, asignando cada archivo a un bloque del listado y marcándolo como tapa o foto adicional. Si una edición o una portada no se reconoce con claridad, quedará sin asignar en el informe para que la revises; no se elegirá por intuición. La asociación queda ligada a la tanda revisada y el plan se invalida si cambian las fotos, el mapa, el texto, Pages CMS o el historial.

El informe incluye `INFORME DE REVISION.html`, una vista visual local con la portada y la galería de cada vinilo. Abrilo antes de aprobar la tanda. La revisión no crea productos ni publica cambios. Tras tu aprobación, el importador sincroniza `origin/main`, vuelve a comprobar duplicados e historial y solo prepara productos autorizados, ocultos por defecto. La publicación se hará después de esa aprobación.

## Alternativa: OneDrive y carga local

Si un adjunto no se puede copiar desde el chat, subí las fotos desde OneDrive móvil a `VINILOS PARA PUBLICAR/FOTOS DE VINILOS/`, todas juntas y con sus nombres actuales. No crees subcarpetas ni cambies sus nombres; luego avisale a Codex que ya están disponibles. También podés usar las reglas de nombres exactos o carpetas individuales que se describen abajo.

## Método de respaldo: listado TXT y fotografías locales

Pegá la nota completa en `VINILOS PARA PUBLICAR/LISTADO DE VINILOS.txt`. Para las fotos ya no hace falta crear una carpeta por álbum: podés dejar todos los archivos directamente en `VINILOS PARA PUBLICAR/FOTOS DE VINILOS/`. Nombralos con el formato `Artista - Álbum__tapa.jpg`, `Artista - Álbum__contratapa.jpg` y `Artista - Álbum__foto-02.jpg`; la parte anterior a `__` debe coincidir con el título del listado. El sufijo `__tapa` o `__portada` identifica la tapa principal. También se conservan las carpetas individuales por álbum, si ya las tenés. La carpeta de preparación está excluida de Git y del sitio publicado; permanece en esta computadora.

El importador reconoce encabezados `Artista - Álbum`, banderas de país conocidas, líneas de edición, año, gradaciones de tapa y disco, extras como `c/ insert`, géneros libres y precios argentinos como `$ 50.000`. Una línea opcional `Colección: Rock Nacional` asigna además una colección principal; no se deduce del género. Si no se escribe género, el informe intenta consultar etiquetas de MusicBrainz cuando hay coincidencia exacta artista/álbum. Las etiquetas son colaborativas, no una clasificación editorial: se presentan como sugerencias orientativas con enlace y cantidad de votos, nunca se guardan solas; agregá la opción elegida como `Género: ...` y generá un informe nuevo. Si no hay conexión o coincidencia confiable, el género queda vacío. Para omitir la consulta online: `--review-list --skip-genre-lookup`. También permite cada publicación en una sola línea usando `•`. Una línea compuesta solo por `-` separa productos; el guion dentro del nombre Artista - Álbum no los separa. Los campos que no aparezcan permanecen vacíos, sin inferencias.

En carpetas individuales, usá `tapa.jpg` o `portada.jpg` para indicar la portada; las otras fotos pasan a la galería. Para dos copias del mismo álbum, podés usar nombres planos como `Artista - Álbum__copia-1__tapa.jpg` y `Artista - Álbum__copia-2__tapa.jpg`, y dentro de cada bloque indicar `Carpeta de fotos: Artista - Álbum__copia-1` o `...__copia-2`. También funcionan carpetas separadas con esos nombres. Si hay más de una posible portada, falta una carpeta indicada o una asociación es ambigua, el informe lo marca y no asigna fotos a ciegas. También compara los títulos con los registros de Pages CMS y señala coincidencias posibles.

Generar el informe no crea productos ni copia fotos al catálogo:

```text
node scripts/import-bulk-catalog.mjs "VINILOS PARA PUBLICAR" --review-list
```

El informe y el plan quedan dentro de la carpeta de preparación. Revisá cada ficha, los campos faltantes, las fotos, duplicados, la clasificación y la visibilidad prevista. Preparar el informe no crea productos ni publica cambios. Después de tu aprobación se importan únicamente los discos autorizados. Si aprobás la tanda para la venta, la disponibilidad predeterminada será `available`, salvo que el texto indique `reserved` o `sold`; sin esa aprobación, la disponibilidad vacía permanece vacía. El historial persistente está en `data/import-history/listado-notas.json`: guarda una huella del bloque de notas y el ID del producto, no depende de sus datos editables. Así, los cambios posteriores de precio, fotos o disponibilidad en Pages CMS no hacen que el disco vuelva a aparecer como nuevo. El historial se conserva en Git junto con las publicaciones, pero el workflow lo excluye del sitio público.

El comparador no descarta dos copias por compartir artista y álbum. Las marca para decisión. Dentro del bloque correspondiente, agregá `Ejemplar independiente: sí` para importar deliberadamente otro ejemplar. Si la nota corresponde a un disco que ya cargaste manualmente desde Pages CMS, agregá `Ya está cargado: sí`; solo se vincula cuando hay una única coincidencia exacta. El importador nunca sobrescribe el registro CMS.

Después de aprobar la tanda, se vuelven a validar el listado, las fotos, el registro persistente y los productos de Pages CMS. El importador actualiza `origin/main` con `git fetch` y aborta sin importar si la rama local no está sincronizada o detecta cambios nuevos; primero habrá que sincronizar el repositorio y generar un informe nuevo. La fase de importación es:

```text
node scripts/import-bulk-catalog.mjs "VINILOS PARA PUBLICAR" --import-reviewed-list
```

Esta fase solo crea archivos locales y copias de las fotos; no hace commit ni push. Una ficha con artista y álbum vacíos puede importarse después de revisarla: se mostrará con un identificador visual genérico. Sin título no se puede comparar con seguridad para detectar duplicados.

## Método secundario: carpetas individuales con datos.txt

El importador integrado no requiere dependencias externas. Cada vinilo puede tener una carpeta propia con fotografías opcionales y un `datos.txt` opcional. También se puede pasar directamente una carpeta que represente un solo vinilo.

```text
lote/
  vinilo-uno/
    datos.txt       (opcional)
    01-portada.jpg  (opcional)
    02-contratapa.jpg (opcional)
  vinilo-dos/
    01-foto.webp
```

En `datos.txt`, escribí un campo por línea con formato `campo: valor` o `campo = valor`. Se aceptan nombres en español o inglés: artista/artist, álbum/album, género/genre (texto libre), colección/collection (una de las cinco colecciones principales), país/country, año/year, edición/edition, estado_tapa/coverCondition, estado_disco/vinylCondition, extras, otros_extras/otherExtras, observaciones/notes, precio/priceARS, disponibilidad/availability y publicado/published. Se ignoran campos vacíos y líneas que empiezan con `#`. También se puede usar un objeto JSON dentro de `datos.txt`.

Solo fotos: el importador genera el registro sin datos descriptivos. Solo `datos.txt`: también genera el registro sin fotos, que tendrá el reemplazo visual en la web si luego se publica. Los identificadores UUID se generan automáticamente; las fotos se copian a `assets/catalogo/<id>/`. La primera foto por orden alfabético se toma como portada y las restantes se guardan en la galería.

Ejecutá desde la carpeta del repositorio:

```text
node scripts/import-bulk-catalog.mjs "RUTA\A\lote" --dry-run
node scripts/import-bulk-catalog.mjs "RUTA\A\lote"
```

La vista previa no escribe archivos. Al importar, cada producto queda oculto salvo que `datos.txt` incluya `publicado: sí` o `published: true`. Las publicaciones y las fotos importadas se revisan y se suben luego con el flujo habitual de GitHub/Pages CMS.
