import { formatPrice, validateCatalog } from "./catalogo-core.mjs?v=5";
import { buildCartWhatsAppMessage, canAddProduct, formatCartEdition, normalizeCartIds, reconcileCartIds, summarizeCart } from "./cart-core.mjs?v=1";

const STORAGE_KEY = "lucuma-records-cart-v1";
const WHATSAPP_NUMBER = "5491165437000";
const cartTriggers = [...document.querySelectorAll(".cart-trigger")];
let cartIds = readStoredIds();
let catalogProducts = [];
let productsById = new Map();
let lastTrigger = null;
let removedOnRefresh = 0;

function readStoredIds() {
  try {
    return normalizeCartIds(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch {
    return [];
  }
}

function writeStoredIds() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cartIds));
  } catch {
    setNotice("No se pudo guardar el carrito en este navegador.");
  }
}

function makeElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const dialog = makeElement("dialog", "cart-dialog");
dialog.id = "cart-dialog";
dialog.setAttribute("aria-labelledby", "cart-title");
const panel = makeElement("div", "cart-panel");
const panelHeader = makeElement("div", "cart-panel__header");
const heading = makeElement("h2", "cart-panel__title", "Tu carrito");
heading.id = "cart-title";
const closeButton = makeElement("button", "cart-close", "×");
closeButton.type = "button";
closeButton.setAttribute("aria-label", "Cerrar carrito");
closeButton.autofocus = true;
panelHeader.append(heading, closeButton);
const notice = makeElement("p", "cart-notice");
notice.setAttribute("role", "status");
notice.setAttribute("aria-live", "polite");
const items = makeElement("div", "cart-items");
const emptyMessage = makeElement("p", "cart-empty", "Todavía no agregaste vinilos.");
const subtotal = makeElement("div", "cart-subtotal");
const subtotalLabel = makeElement("span", "cart-subtotal__label", "Subtotal informativo");
const subtotalValue = makeElement("strong", "cart-subtotal__value", "A consultar");
subtotal.append(subtotalLabel, subtotalValue);
const partialNote = makeElement("p", "cart-partial-note");
const shippingNote = makeElement("p", "cart-shipping-note", "No incluye gastos de envío.");
const whatsappLink = makeElement("a", "cart-whatsapp", "CONSULTAR CARRITO POR WHATSAPP");
whatsappLink.target = "_blank";
whatsappLink.rel = "noopener noreferrer";
whatsappLink.href = "#cart-dialog";
const noReservation = makeElement("p", "cart-no-reservation", "La consulta no reserva los discos. La disponibilidad se confirma por WhatsApp.");
panel.append(panelHeader, notice, items, emptyMessage, subtotal, partialNote, shippingNote, whatsappLink, noReservation);
dialog.append(panel);
document.body.append(dialog);

function setNotice(message = "") {
  notice.textContent = message;
  notice.hidden = !message;
}

function updateCounter() {
  for (const trigger of cartTriggers) {
    const count = trigger.querySelector(".cart-trigger__count");
    if (!count) continue;
    count.textContent = String(cartIds.length);
    count.hidden = cartIds.length === 0;
    trigger.setAttribute("aria-label", cartIds.length
      ? `Abrir carrito, ${cartIds.length} ${cartIds.length === 1 ? "vinilo" : "vinilos"}`
      : "Abrir carrito, vacío");
    trigger.setAttribute("aria-expanded", String(dialog.open));
  }
}

function updateAddButtons() {
  document.querySelectorAll("[data-cart-product-id]").forEach(button => {
    const id = button.dataset.cartProductId;
    const availability = button.dataset.cartAvailability;
    const title = button.dataset.cartTitle || "este vinilo";
    const inCart = cartIds.includes(id);
    const canAdd = availability === "available";
    button.textContent = inCart ? "EN EL CARRITO" : canAdd ? "AGREGAR AL CARRITO" : availability === "sold" ? "VENDIDO" : "NO DISPONIBLE";
    button.disabled = inCart || !canAdd;
    button.setAttribute("aria-label", inCart
      ? `${title}, ya está en el carrito`
      : canAdd ? `Agregar ${title} al carrito` : `${title}, no disponible para agregar`);
    button.classList.toggle("is-added", inCart);
  });
}

function notifyCartChange() {
  updateCounter();
  updateAddButtons();
  window.dispatchEvent(new CustomEvent("lucuma-cart-change", { detail: { ids: [...cartIds], count: cartIds.length } }));
}

function reconcileCurrentCart() {
  const result = reconcileCartIds(cartIds, catalogProducts);
  if (result.removedCount) {
    removedOnRefresh += result.removedCount;
    cartIds = result.ids;
    writeStoredIds();
  }
  notifyCartChange();
}

async function refreshCatalog() {
  const response = await fetch("data/catalogo.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  catalogProducts = validateCatalog(await response.json()).filter(product => product.published !== false);
  productsById = new Map(catalogProducts.map(product => [product.id, product]));
  reconcileCurrentCart();
}

let initialCatalogReady = refreshCatalog().then(() => true).catch(error => {
  console.error("No se pudo validar el carrito:", error);
  return false;
});

function selectedProducts() {
  return cartIds.map(id => productsById.get(id)).filter(Boolean);
}

function makeCartItem(product) {
  const item = makeElement("article", "cart-item");
  if (product.photos?.[0]) {
    const image = makeElement("img", "cart-item__photo");
    image.src = product.photos[0];
    image.alt = `Tapa de ${[product.artist, product.album].filter(Boolean).join(" · ")}`;
    image.loading = "lazy";
    image.decoding = "async";
    item.append(image);
  }

  const copy = makeElement("div", "cart-item__copy");
  const artist = makeElement("span", "cart-item__artist", product.artist || "");
  artist.hidden = !product.artist;
  const album = makeElement("h3", "cart-item__album", product.album || product.artist || "Vinilo");
  const editionText = formatCartEdition(product);
  const edition = makeElement("p", "cart-item__edition", editionText);
  edition.hidden = !editionText;
  const priceText = formatPrice(product.priceARS) || "Precio a consultar";
  const price = makeElement("p", "cart-item__price", priceText);
  copy.append(artist, album, edition, price);

  const remove = makeElement("button", "cart-item__remove", "Quitar");
  remove.type = "button";
  remove.setAttribute("aria-label", `Quitar ${[product.artist, product.album].filter(Boolean).join(" — ")} del carrito`);
  remove.addEventListener("click", () => removeFromCart(product.id));
  item.append(copy, remove);
  return item;
}

function updateWhatsApp(products, summary) {
  if (!products.length) {
    whatsappLink.href = "#cart-dialog";
    whatsappLink.setAttribute("aria-disabled", "true");
    whatsappLink.tabIndex = -1;
    return;
  }
  const message = buildCartWhatsAppMessage(products);
  whatsappLink.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  whatsappLink.removeAttribute("aria-disabled");
  whatsappLink.removeAttribute("tabindex");
  subtotalLabel.textContent = summary.hasUnpriced
    ? summary.pricedCount ? "Subtotal parcial informativo" : "Subtotal informativo"
    : "Subtotal informativo";
  subtotalValue.textContent = summary.pricedCount ? formatPrice(summary.subtotal) : "A consultar";
  partialNote.textContent = summary.hasUnpriced ? "Hay discos sin precio informado; el total final es a consultar." : "";
  partialNote.hidden = !summary.hasUnpriced;
}

function renderPanel() {
  const products = selectedProducts();
  const summary = summarizeCart(products);
  items.replaceChildren(...products.map(makeCartItem));
  emptyMessage.hidden = products.length > 0;
  subtotal.hidden = products.length === 0;
  shippingNote.hidden = products.length === 0;
  noReservation.hidden = products.length === 0;
  whatsappLink.hidden = products.length === 0;
  if (!summary.hasUnpriced) {
    subtotalLabel.textContent = "Subtotal informativo";
    partialNote.textContent = "";
    partialNote.hidden = true;
  }
  updateWhatsApp(products, summary);
  if (removedOnRefresh > 0) {
    setNotice(`Quitamos ${removedOnRefresh} ${removedOnRefresh === 1 ? "vinilo que ya no está disponible" : "vinilos que ya no están disponibles"}.`);
    removedOnRefresh = 0;
  }
}

function removeFromCart(id) {
  cartIds = cartIds.filter(itemId => itemId !== id);
  writeStoredIds();
  renderPanel();
  notifyCartChange();
}

export function hasInCart(id) {
  return cartIds.includes(id);
}

export async function addToCart(id) {
  if (!await initialCatalogReady) {
    try {
      await refreshCatalog();
      initialCatalogReady = Promise.resolve(true);
    } catch {
      return { ok: false, reason: "catalog-unavailable" };
    }
  }
  const product = productsById.get(id);
  if (!canAddProduct(product)) return { ok: false, reason: "unavailable" };
  if (cartIds.includes(id)) return { ok: true, alreadyAdded: true };
  cartIds = [...cartIds, id];
  writeStoredIds();
  renderPanel();
  notifyCartChange();
  return { ok: true, alreadyAdded: false };
}

for (const trigger of cartTriggers) {
  trigger.addEventListener("click", async () => {
    lastTrigger = trigger;
    setNotice("Verificando disponibilidad…");
    try {
      await refreshCatalog();
      setNotice("");
      renderPanel();
    } catch (error) {
      console.error("No se pudo actualizar el carrito:", error);
      renderPanel();
      setNotice("No pudimos confirmar la disponibilidad. Revisá tu conexión e intentá nuevamente.");
      whatsappLink.setAttribute("aria-disabled", "true");
      whatsappLink.tabIndex = -1;
    }
    if (!dialog.open) dialog.showModal();
    updateCounter();
  });
}

closeButton.addEventListener("click", () => dialog.close());
dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
dialog.addEventListener("close", () => {
  updateCounter();
  lastTrigger?.focus();
});
whatsappLink.addEventListener("click", event => {
  if (whatsappLink.getAttribute("aria-disabled") === "true") event.preventDefault();
});
window.addEventListener("storage", event => {
  if (event.key !== STORAGE_KEY) return;
  cartIds = readStoredIds();
  if (catalogProducts.length) reconcileCurrentCart();
  renderPanel();
});
window.addEventListener("lucuma-cart-change", updateAddButtons);
window.addEventListener("pageshow", updateAddButtons);

updateCounter();
updateAddButtons();
renderPanel();
