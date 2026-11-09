import { AVAILABILITY, COLLECTIONS, EXTRAS, buildWhatsAppUrl, capitalizeExtraDescriptions, filterAndSortProducts, formatCountryYear, formatPrice, listCatalogGenres, matchesCollection, productTitle, validateCatalog } from "./catalogo-core.mjs?v=5";

const menuToggle = document.querySelector(".menu-toggle");
const mainNav = document.getElementById("main-nav");
const searchInput = document.getElementById("catalog-search");
const genreFilter = document.getElementById("genre-filter");
const collectionFilter = document.getElementById("collection-filter");
const sortSelect = document.getElementById("catalog-sort");
const resultsCount = document.getElementById("results-count");
const productGrid = document.getElementById("product-grid");
const emptyState = document.getElementById("empty-state");
const emptyEyebrow = document.getElementById("empty-eyebrow");
const emptyTitle = document.getElementById("empty-title");
const emptyMessage = document.getElementById("empty-message");
const emptyLink = emptyState.querySelector(".empty-link");
const resetButton = document.getElementById("reset-filters");
const filtersToggle = document.getElementById("filters-toggle");
const filterOptions = document.getElementById("filter-options");
const filtersActiveCount = document.getElementById("filters-active-count");
const dialog = document.getElementById("product-dialog");
const dialogContent = document.getElementById("dialog-content");
const mobileDetailQuery = window.matchMedia("(max-width: 650px)");
let activeWhatsAppPlacement = null;
let products = [];
let pendingGenre = "todos";
let pendingCollection = "todos";

function closeMenu() {
  if (!menuToggle || !mainNav) return;
  menuToggle.setAttribute("aria-expanded", "false");
  mainNav.classList.remove("is-open");
}

function setFiltersExpanded(expanded) {
  filtersToggle.setAttribute("aria-expanded", String(expanded));
  filterOptions.classList.toggle("is-open", expanded);
}

function updateFiltersToggle() {
  const activeCount = [
    Boolean(searchInput.value.trim()),
    collectionFilter.value !== "todos",
    genreFilter.value !== "todos",
    sortSelect.value !== "artist-asc"
  ].filter(Boolean).length;
  filtersActiveCount.hidden = activeCount === 0;
  filtersActiveCount.textContent = activeCount ? `${activeCount} activo${activeCount === 1 ? "" : "s"}` : "";
  filtersToggle.setAttribute("aria-label", activeCount
    ? `Filtros y orden, ${activeCount} ${activeCount === 1 ? "criterio activo" : "criterios activos"}`
    : "Filtros y orden");
}

function placeWhatsAppActions(placement, isMobile) {
  if (isMobile) {
    placement.anchor.after(placement.hint, placement.link);
  } else {
    placement.contactAlt.before(placement.hint, placement.link);
  }
}

mobileDetailQuery.addEventListener("change", event => {
  if (dialog.open && activeWhatsAppPlacement) {
    placeWhatsAppActions(activeWhatsAppPlacement, event.matches);
  }
});

filtersToggle.addEventListener("click", () => {
  setFiltersExpanded(filtersToggle.getAttribute("aria-expanded") !== "true");
});
window.matchMedia("(min-width: 651px)").addEventListener("change", event => {
  if (event.matches) setFiltersExpanded(false);
});

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
const legacyCollectionAliases = { brasil: "otros" };
const requestedCollection = params.get("coleccion") || (requestedGenre && (Object.hasOwn(COLLECTIONS, requestedGenre) || Object.hasOwn(legacyCollectionAliases, requestedGenre)) ? requestedGenre : "");
if (requestedCollection) {
  const canonical = legacyCollectionAliases[requestedCollection] || requestedCollection;
  if (Object.hasOwn(COLLECTIONS, canonical)) pendingCollection = canonical;
}
if (requestedGenre && requestedGenre !== requestedCollection && !Object.hasOwn(COLLECTIONS, requestedGenre) && !Object.hasOwn(legacyCollectionAliases, requestedGenre)) pendingGenre = requestedGenre;

function configureCollectionFilter() {
  const options = [makeElement("option", "", "Todas las colecciones")];
  options[0].value = "todos";
  for (const [collection, label] of Object.entries(COLLECTIONS)) {
    const option = makeElement("option", "", label);
    option.value = collection;
    options.push(option);
  }
  collectionFilter.replaceChildren(...options);
  collectionFilter.value = [...collectionFilter.options].some(option => option.value === pendingCollection) ? pendingCollection : "todos";
  collectionFilter.disabled = options.length === 1;
}

function configureGenreFilter() {
  const scope = collectionFilter.value === "todos"
    ? products
    : products.filter(product => matchesCollection(product, collectionFilter.value));
  const options = [makeElement("option", "", "Todos los géneros")];
  options[0].value = "todos";
  for (const genre of listCatalogGenres(scope)) {
    const option = makeElement("option", "", genre.label);
    option.value = genre.value;
    options.push(option);
  }
  genreFilter.replaceChildren(...options);
  genreFilter.value = [...genreFilter.options].some(option => option.value === pendingGenre) ? pendingGenre : "todos";
  pendingGenre = genreFilter.value;
  genreFilter.disabled = options.length === 1;
}

function syncFilterUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("genero");
  url.searchParams.delete("coleccion");
  if (collectionFilter.value !== "todos") url.searchParams.set("coleccion", collectionFilter.value);
  if (genreFilter.value !== "todos") url.searchParams.set("genero", genreFilter.value);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

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

function productLabel(product) {
  return [product.artist, product.album].filter(value => typeof value === "string" && value.trim()).join(" · ") || "Vinilo sin título";
}

function vinylPlaceholder(label) {
  const placeholder = makeElement("div", "vinyl-placeholder");
  placeholder.setAttribute("role", "img");
  placeholder.setAttribute("aria-label", label || "Ilustración de un disco de vinilo");

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 120 120");
  svg.setAttribute("aria-hidden", "true");
  const disc = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  disc.setAttribute("cx", "60");
  disc.setAttribute("cy", "60");
  disc.setAttribute("r", "47");
  disc.setAttribute("fill", "#171717");
  svg.append(disc);
  for (const radius of [38, 33, 28, 23]) {
    const groove = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    groove.setAttribute("cx", "60");
    groove.setAttribute("cy", "60");
    groove.setAttribute("r", String(radius));
    groove.setAttribute("fill", "none");
    groove.setAttribute("stroke", "#79766f");
    groove.setAttribute("stroke-opacity", ".38");
    groove.setAttribute("stroke-width", "1");
    svg.append(groove);
  }
  const labelCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  labelCircle.setAttribute("cx", "60");
  labelCircle.setAttribute("cy", "60");
  labelCircle.setAttribute("r", "13");
  labelCircle.setAttribute("fill", "#f3ebdd");
  const centerHole = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  centerHole.setAttribute("cx", "60");
  centerHole.setAttribute("cy", "60");
  centerHole.setAttribute("r", "2");
  centerHole.setAttribute("fill", "#171717");
  svg.append(labelCircle, centerHole);
  placeholder.append(svg);
  return placeholder;
}

function displayPhoto(container, source, alt, fallbackLabel) {
  if (!source) {
    container.replaceChildren(vinylPlaceholder(fallbackLabel));
    return;
  }
  const photo = document.createElement("img");
  photo.src = source;
  photo.alt = alt;
  photo.loading = "lazy";
  photo.decoding = "async";
  photo.addEventListener("error", () => container.replaceChildren(vinylPlaceholder(fallbackLabel)), { once: true });
  container.replaceChildren(photo);
}

function makeProductCard(product) {
  const article = makeElement("article", "product-card");
  const openButton = makeElement("button", "product-card__open");
  openButton.type = "button";
  openButton.setAttribute("aria-haspopup", "dialog");
  openButton.setAttribute("aria-label", `Ver detalles de ${productLabel(product)}`);

  const photoWrap = makeElement("div", "product-card__photo");
  displayPhoto(photoWrap, product.photos[0], `Tapa de ${productLabel(product)}`, `Imagen no disponible para ${productLabel(product)}`);

  const info = makeElement("div", "product-card__info");
  if (product.artist && product.album) {
    info.append(makeElement("span", "product-card__artist", product.artist));
    info.append(makeElement("h2", "product-card__album", product.album));
  } else {
    info.append(makeElement("h2", "product-card__album product-card__generic", product.artist || product.album || "VINILO"));
  }
  const pressing = formatCountryYear(product.country, product.year);
  if (pressing) info.append(makeElement("p", "product-card__pressing", pressing));
  const price = formatPrice(product.priceARS);
  if (price) info.append(makeElement("span", "product-card__price", price));
  if (product.availability) info.append(availabilityBadge(product.availability, "product-card__availability"));

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
  updateFiltersToggle();
  const hasFilters = Boolean(searchInput.value.trim()) || genreFilter.value !== "todos" || collectionFilter.value !== "todos";
  resetButton.hidden = !hasFilters;
  const visibleProducts = filterAndSortProducts(products, {
    query: searchInput.value,
    genre: genreFilter.value,
    collection: collectionFilter.value,
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
  activeWhatsAppPlacement = null;
  const gallery = makeElement("div", "detail-gallery");
  const mainPhoto = makeElement("div", "detail-gallery__main");
  const label = productLabel(product);
  displayPhoto(mainPhoto, product.photos[0], `Tapa de ${label}`, `Imagen no disponible para ${label}`);
  gallery.append(mainPhoto);

  if (product.photos.length > 1) {
    const thumbnails = makeElement("div", "detail-thumbnails");
    product.photos.forEach((src, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", `Ver fotografía ${index + 1}`);
      button.setAttribute("aria-pressed", String(index === 0));
      displayPhoto(button, src, "", `Fotografía ${index + 1} no disponible`);
      button.addEventListener("click", () => {
        displayPhoto(mainPhoto, src, `Fotografía ${index + 1} de ${label}`, `Fotografía ${index + 1} no disponible para ${label}`);
        thumbnails.querySelectorAll("button").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
      });
      thumbnails.append(button);
    });
    gallery.append(thumbnails);
  }

  const copy = makeElement("div", "detail-copy");
  if (product.genre) {
    const legacyCollectionLabel = Object.hasOwn(COLLECTIONS, product.genre) ? COLLECTIONS[product.genre] : product.genre;
    copy.append(makeElement("span", "eyebrow", legacyCollectionLabel));
  }
  if (product.collection) copy.append(makeElement("p", "detail-copy__meta", `Colección: ${COLLECTIONS[product.collection]}`));
  const headingText = product.artist || product.album || "VINILO";
  const heading = makeElement("h2", "", headingText);
  heading.id = "dialog-title";
  copy.append(heading);
  if (product.artist && product.album) copy.append(makeElement("p", "detail-copy__album", product.album));
  const metadata = formatCountryYear(product.country, product.year, { editionType: product.editionType });
  if (metadata) copy.append(makeElement("p", "detail-copy__meta", metadata));
  const price = formatPrice(product.priceARS);
  const priceNode = price ? makeElement("p", "detail-copy__price", price) : null;
  if (priceNode) copy.append(priceNode);
  let availabilityNode = null;
  if (product.availability === "sold") {
    availabilityNode = makeElement("p", "sold-notice", "VINILO VENDIDO");
  } else if (product.availability) {
    availabilityNode = availabilityBadge(product.availability);
  }
  if (availabilityNode) copy.append(availabilityNode);

  const specs = makeElement("dl", "detail-specs");
  const extras = [
    ...(Array.isArray(product.extras) ? product.extras.map(extra => EXTRAS[extra] || extra) : []),
    ...(product.otherExtras?.trim() ? [product.otherExtras.trim()] : [])
  ].map(extra => capitalizeExtraDescriptions(extra.trim()));
  const fields = [
    ["Edición", product.editionType],
    ["Estado de tapa", product.coverCondition],
    ["Estado del vinilo", product.vinylCondition],
    ...(extras.length ? [["Extras", extras.join(", ")]] : [])
  ].filter(([, value]) => typeof value === "string" && value.trim());
  fields.forEach(([label, value]) => {
    specs.append(makeElement("dt", "", label), makeElement("dd", "", value));
  });
  if (fields.length) copy.append(specs);
  if (product.notes?.trim()) copy.append(makeElement("p", "detail-notes", product.notes));

  const instagramLink = document.createElement("a");
  instagramLink.href = "https://www.instagram.com/lucumarecords/";
  instagramLink.target = "_blank";
  instagramLink.rel = "noopener noreferrer";
  instagramLink.textContent = "Instagram";

  if (product.availability === "sold") {
    const soldContact = makeElement("p", "detail-contact-alt", "¿Buscás otro disco? Consultanos por ");
    soldContact.append(instagramLink);
    copy.append(soldContact);
  } else {
    const whatsappHint = makeElement("p", "detail-whatsapp-hint", "Revisá los detalles del disco y consultanos por WhatsApp");
    const whatsappLink = document.createElement("a");
    whatsappLink.className = "whatsapp-button";
    whatsappLink.href = buildWhatsAppUrl(product);
    whatsappLink.target = "_blank";
    whatsappLink.rel = "noopener noreferrer";
    const whatsappIcon = document.createElement("span");
    whatsappIcon.className = "whatsapp-button__icon";
    whatsappIcon.setAttribute("aria-hidden", "true");
    const whatsappSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    whatsappSvg.setAttribute("viewBox", "0 0 24 24");
    const whatsappPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    whatsappPath.setAttribute("fill", "currentColor");
    whatsappPath.setAttribute("d", "M20.52 3.48A11.82 11.82 0 0 0 12.13 0C5.57 0 .23 5.34.23 11.9c0 2.1.55 4.14 1.6 5.95L.12 24l6.3-1.65a11.9 11.9 0 0 0 5.7 1.45h.01c6.56 0 11.9-5.34 11.9-11.9 0-3.18-1.24-6.17-3.51-8.42ZM12.13 21.8h-.01c-1.78 0-3.52-.48-5.04-1.39l-.36-.21-3.74.98 1-3.65-.24-.37a9.84 9.84 0 0 1-1.51-5.26c0-5.46 4.44-9.9 9.9-9.9 2.65 0 5.13 1.03 7 2.9a9.84 9.84 0 0 1 2.9 7c0 5.46-4.44 9.9-9.9 9.9Zm5.43-7.41c-.3-.15-1.78-.88-2.06-.98-.28-.1-.48-.15-.68.15-.2.3-.78.98-.95 1.18-.18.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.46-.88-.79-1.48-1.77-1.65-2.07-.18-.3-.02-.46.13-.61.13-.13.3-.35.45-.53.15-.18.2-.3.3-.5.1-.2.05-.38-.03-.53-.07-.15-.68-1.63-.93-2.23-.24-.58-.49-.5-.68-.51h-.58c-.2 0-.53.07-.8.37-.28.3-1.05 1.03-1.05 2.51s1.08 2.91 1.23 3.11c.15.2 2.12 3.24 5.14 4.55.72.31 1.28.5 1.72.64.72.23 1.38.2 1.9.12.58-.09 1.78-.73 2.03-1.43.25-.7.25-1.3.18-1.43-.08-.12-.28-.2-.58-.35Z");
    whatsappSvg.append(whatsappPath);
    whatsappIcon.append(whatsappSvg);
    whatsappLink.append(whatsappIcon, document.createTextNode("CONSULTAR POR WHATSAPP"));
    whatsappLink.setAttribute("aria-label", `Consultar por WhatsApp sobre ${productTitle(product)}`);
    copy.append(whatsappHint, whatsappLink);
    const contactAlt = makeElement("p", "detail-contact-alt", "También podés escribirnos por ");
    contactAlt.append(instagramLink);
    copy.append(contactAlt);
    activeWhatsAppPlacement = {
      copy,
      hint: whatsappHint,
      link: whatsappLink,
      contactAlt,
      anchor: availabilityNode || priceNode || heading
    };
    placeWhatsAppActions(activeWhatsAppPlacement, mobileDetailQuery.matches);
  }

  dialogContent.replaceChildren(gallery, copy);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

document.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
searchInput.addEventListener("input", render);
genreFilter.addEventListener("change", render);
genreFilter.addEventListener("change", syncFilterUrl);
collectionFilter.addEventListener("change", () => {
  pendingGenre = "todos";
  configureGenreFilter();
  render();
  syncFilterUrl();
});
genreFilter.addEventListener("change", () => { pendingGenre = genreFilter.value; });
sortSelect.addEventListener("change", render);
resetButton.addEventListener("click", () => {
  searchInput.value = "";
  collectionFilter.value = "todos";
  pendingGenre = "todos";
  configureGenreFilter();
  genreFilter.value = "todos";
  sortSelect.value = "artist-asc";
  window.history.replaceState(null, "", window.location.pathname);
  render();
});

async function loadCatalog() {
  try {
    const response = await fetch("data/catalogo.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    products = validateCatalog(await response.json()).filter(product => product.published === true);
    configureCollectionFilter();
    configureGenreFilter();
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
