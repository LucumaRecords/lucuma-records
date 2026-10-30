# Datos del catálogo

El catálogo visible de `catalogo.html` se genera durante el despliegue de GitHub Pages. Pages CMS administra cada vinilo en un archivo JSON independiente dentro de `data/vinilos/`; el flujo de GitHub Actions valida esos registros y genera `data/catalogo.json` en el sitio publicado.

No se incluyen productos de ejemplo. Mientras la colección esté vacía, la página muestra el mensaje de próxima disponibilidad.

## Administración

- Creá cada registro desde Pages CMS. No hace falta editar `catalogo.json` ni HTML.
- El identificador se genera automáticamente y se usa como nombre del archivo.
- Subí las fotos a la biblioteca `assets/catalogo/`. La primera foto del campo «Fotografías» es la tapa principal; las siguientes forman la galería.
- Hasta confirmar la carga múltiple en la versión alojada de Pages CMS, subí las fotos de a una y luego agregalas/ordenalas en el campo de galería. Hay un reporte abierto reciente de errores al subir varias imágenes juntas: https://github.com/hunvreus/pagescms/issues/448.
- Para ocultar temporalmente un vinilo, desactivá «Visible en el catálogo». Esto lo quita de la web, pero el registro y las fotos siguen en GitHub.
- «Visible en el catálogo» controla la publicación en la web, no la privacidad: si el repositorio de GitHub es público, ese registro y sus fotos también pueden verse allí.
- Para marcar una venta, cambiá «Disponibilidad» a «Vendido»; para retirarlo temporalmente, elegí «Reservado».
- Si quitás una foto de un registro, solo se quita esa referencia. El archivo permanece en la biblioteca. Antes de borrar un archivo de imagen, comprobá que ningún otro vinilo lo use.
- Eliminar un registro es una acción permanente en Pages CMS; Git conserva el historial para poder recuperar el archivo si hiciera falta.

## Estructura de un registro

Los campos coinciden con `data/catalogo.schema.json` y con la validación que consume la página: artista, álbum, género, país, año, edición, estado de tapa y disco, extras, observaciones, precio en ARS, disponibilidad, visibilidad y fotografías.
