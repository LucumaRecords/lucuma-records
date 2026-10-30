import { AVAILABILITY, EXTRAS, GENRES, filterAndSortProducts, formatPrice, validateCatalog } from "./catalogo-core.mjs";

const menuToggle = document.querySelector(".menu-toggle");
const mainNav = document.getElementById("main-nav");
const searchInput = document.getElementById("catalog-search");
const genreFilter = document.getElementById("genre-filter");
const sortSelect = document.getElementById("catalog-sort");
const resultsCount = document.getElementById("results-count");
const productGrid = document.getElementById("product-grid");
const emptyState = document.getElementById("empty-state");
const emptyEyebrow = document.getElementById("empty-eyebrow");
const emptyTitle = document.getElementById("empty-title");
const emptyMessage = document.getElementById("empty-message");
const emptyLink = emptyState.querySelector(".empty-link");
const resetButton = document.getElementById("reset-filters");
const dialog = document.getElementById("product-dialog");
const dialogContent = document.getElementById("dialog-content");
let products = [];

function closeMenu() {
  if (!menuToggle || !mainNav) return;
  menuToggle.setAttribute("aria-expanded", "false");
  mainNav.classList.remove("is-open");
}

if (menuToggle && mainNav) {
  menuToggle.addEventListener("click", () => {
    const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
    menuToggle.setAttribute("aria-expanded", String(!isOpen));
    mainNav.classList.toggle("is-open", !isOpen);
  });
  mainNav.querySelectorAll("a").forEach(link => link.addEventListener("click", closeMenu));
  window.matchMedia("(min-width: 651px)").addEventListener("change", closeMenu);
}

document.addEventListener("keydown", event => { if (event.key === "Escape") closeMenu(); });
document.getElementById("year").textContent = new Date().getFullYear();

const params = new URLSearchParams(window.location.search);
const requestedGenre = params.get("genero");
genreFilter.value = requestedGenre && Object.hasOwn(GENRES, requestedGenre) ? requestedGenre : "todos";

function makeElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function availabilityBadge(status, extraClass = "") {
  const badge = makeElement("span", `availability availability--${status}${extraClass ? ` ${extraClass}` : ""}`, AVAILABILITY[status]);
  return badge;
}

function makeProductCard(product) {
  const article = makeElement("article", "product-card");
  const openButton = makeElement("button", "product-card__open");
  openButton.type = "button";
  openButton.setAttribute("aria-haspopup", "dialog");
  openButton.setAttribute("aria-label", `Ver detalles de ${product.artist}: ${product.album}`);

  const photoWrap = makeElement("div", "product-card__photo");
  const photo = document.createElement("img");
  photo.src = product.photos[0];
  photo.alt = `Tapa de ${product.album}, de ${product.artist}`;
  photo.loading = "lazy";
  photo.decoding = "async";
  photo.addEventListener("error", () => photoWrap.classList.add("is-broken"), { once: true });
  photoWrap.append(photo);

  const info = makeElement("div", "product-card__info");
  info.append(makeElement("span", "product-card__artist", product.artist));
  info.append(makeElement("h2", "product-card__album", product.album));
  info.append(makeElement("span", "product-card__price", formatPrice(product.priceARS)));
  info.append(makeElement("p", "product-card__pressing", `${product.country} · ${product.year}`));
  info.append(availabilityBadge(product.availability, "product-card__availability"));

  openButton.append(photoWrap, info);
  openButton.addEventListener("click", () => openProductDetails(product));
  article.append(openButton);
  return article;
}

function showEmptyState({ eyebrow, title, message, link = false }) {
  emptyEyebrow.textContent = eyebrow;
  emptyTitle.textContent = title;
  emptyMessage.textContent = message;
  emptyLink.hidden = !link;
  emptyState.hidden = false;
  productGrid.hidden = true;
}

function render() {
  const hasFilters = Boolean(searchInput.value.trim()) || genreFilter.value !== "todos";
  resetButton.hidden = !hasFilters;
  const visibleProducts = filterAndSortProducts(products, {
    query: searchInput.value,
    genre: genreFilter.value,
    sort: sortSelect.value
  });

  if (products.length === 0) {
    resultsCount.textContent = "Colección en preparación";
    showEmptyState({
      eyebrow: "Colección en preparación",
      title: "Muy pronto, nuevos hallazgos.",
      message: "Estamos preparando nuestra colección. Muy pronto vas a poder explorar nuestros vinilos.",
      link: true
    });
    return;
  }

  if (visibleProducts.length === 0) {
    resultsCount.textContent = "0 vinilos encontrados";
    showEmptyState({
      eyebrow: "Sin resultados",
      title: "No encontramos vinilos con esa búsqueda.",
      message: "Probá con otro artista, álbum o género, o limpiá los filtros para ver la colección completa."
    });
    return;
  }

  resultsCount.textContent = `${visibleProducts.length} ${visibleProducts.length === 1 ? "vinilo" : "vinilos"}`;
  emptyState.hidden = true;
  productGrid.hidden = false;
  productGrid.replaceChildren(...visibleProducts.map(makeProductCard));
}

function openProductDetails(product) {
  const gallery = makeElement("div", "detail-gallery");
  const mainPhoto = makeElement("div", "detail-gallery__main");
  const mainImage = document.createElement("img");
  mainImage.src = product.photos[0];
  mainImage.alt = `Tapa de ${product.album}, de ${product.artist}`;
  mainPhoto.append(mainImage);
  gallery.append(mainPhoto);

  if (product.photos.length > 1) {
    const thumbnails = makeElement("div", "detail-thumbnails");
    product.photos.forEach((src, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", `Ver fotografía ${index + 1}`);
      button.setAttribute("aria-pressed", String(index === 0));
      const thumbnail = document.createElement("img");
      thumbnail.src = src;
      thumbnail.alt = "";
      thumbnail.loading = "lazy";
      button.append(thumbnail);
      button.addEventListener("click", () => {
        mainImage.src = src;
        mainImage.alt = `Fotografía ${index + 1} de ${product.album}, de ${product.artist}`;
        thumbnails.querySelectorAll("button").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
      });
      thumbnails.append(button);
    });
    gallery.append(thumbnails);
  }

  const copy = makeElement("div", "detail-copy");
  const artistHeading = makeElement("h2", "", product.artist);
  artistHeading.id = "dialog-title";
  copy.append(makeElement("span", "eyebrow", GENRES[product.genre]));
  copy.append(artistHeading);
  copy.append(makeElement("p", "detail-copy__album", product.album));
  copy.append(makeElement("p", "detail-copy__meta", `${product.country} · ${product.year}`));
  copy.append(makeElement("p", "detail-copy__price", formatPrice(product.priceARS)));
  copy.append(availabilityBadge(product.availability));

  const specs = makeElement("dl", "detail-specs");
  const extras = [
    ...(Array.isArray(product.extras) ? product.extras.map(extra => EXTRAS[extra] || extra) : []),
    ...(product.otherExtras?.trim() ? [product.otherExtras.trim()] : [])
  ];
  const fields = [
    ["Edición", product.editionType],
    ["Estado de tapa", product.coverCondition],
    ["Estado del vinilo", product.vinylCondition],
    ["Extras", extras.length ? extras.join(", ") : "Sin extras declarados"]
  ];
  fields.forEach(([label, value]) => {
    specs.append(makeElement("dt", "", label), makeElement("dd", "", value));
  });
  copy.append(specs);
  if (product.notes?.trim()) copy.append(makeElement("p", "detail-notes", product.notes));

  dialogContent.replaceChildren(gallery, copy);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

document.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
searchInput.addEventListener("input", render);
genreFilter.addEventListener("change", render);
sortSelect.addEventListener("change", render);
resetButton.addEventListener("click", () => {
  searchInput.value = "";
  genreFilter.value = "todos";
  sortSelect.value = "artist-asc";
  window.history.replaceState(null, "", window.location.pathname);
  render();
});

async function loadCatalog() {
  try {
    const response = await fetch("data/catalogo.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    products = validateCatalog(await response.json()).filter(product => product.published !== false);
    render();
  } catch (error) {
    console.error("No se pudo cargar el catálogo:", error);
    resultsCount.textContent = "Catálogo no disponible";
    showEmptyState({
      eyebrow: "No pudimos cargar el catálogo",
      title: "Abrí esta página desde un servidor web.",
      message: "Para cargar el archivo de datos, usá GitHub Pages o un servidor local. Abrir el HTML directamente como file:// no permite leer el JSON.",
      link: false
    });
  }
}

render();
loadCatalog();
