import { formatCountryYear, formatPrice } from "./catalogo-core.mjs?v=5";

export function normalizeCartIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(id => typeof id === "string" && id.trim()).map(id => id.trim()))];
}

export function canAddProduct(product) {
  return Boolean(product && product.id && product.published !== false && product.availability === "available");
}

export function reconcileCartIds(ids, products) {
  const availableIds = new Set((Array.isArray(products) ? products : []).filter(canAddProduct).map(product => product.id));
  const uniqueIds = normalizeCartIds(ids);
  const retained = uniqueIds.filter(id => availableIds.has(id));
  return { ids: retained, removedCount: uniqueIds.length - retained.length };
}

export function formatCartEdition(product) {
  const editionType = typeof product?.editionType === "string" ? product.editionType.trim() : "";
  const metadata = formatCountryYear(product?.country, product?.year, { editionType });
  return [metadata, editionType].filter(Boolean).join(" · ");
}

export function summarizeCart(products) {
  const pricedProducts = [];
  const unpricedProducts = [];
  let subtotal = 0;

  for (const product of products) {
    if (Number.isFinite(product?.priceARS) && product.priceARS > 0) {
      pricedProducts.push(product);
      subtotal += product.priceARS;
    } else {
      unpricedProducts.push(product);
    }
  }

  return {
    subtotal,
    pricedCount: pricedProducts.length,
    unpricedCount: unpricedProducts.length,
    hasUnpriced: unpricedProducts.length > 0
  };
}

export function buildCartWhatsAppMessage(products) {
  const summary = summarizeCart(products);
  const lines = products.map((product, index) => {
    const title = [product.artist, product.album].filter(value => typeof value === "string" && value.trim()).join(" — ");
    const edition = formatCartEdition(product);
    const price = Number.isFinite(product.priceARS) && product.priceARS > 0
      ? formatPrice(product.priceARS)
      : "Precio a consultar";
    return `${index + 1}. ${[title, edition, price].filter(Boolean).join(" — ")}`;
  });

  let subtotalLine = "Subtotal informativo: A consultar";
  if (summary.pricedCount > 0) {
    subtotalLine = `${summary.hasUnpriced ? "Subtotal parcial informativo" : "Subtotal informativo"}: ${formatPrice(summary.subtotal)}`;
  }

  return [
    "Hola, ¿cómo estás? Quería consultar por estos vinilos de Lucuma Records:",
    "",
    ...lines,
    "",
    subtotalLine,
    ...(summary.hasUnpriced ? ["Hay discos sin precio informado; el total final es a consultar."] : []),
    "",
    "¿Me confirmás la disponibilidad y cómo podemos coordinar la compra? ¡Gracias!"
  ].join("\n");
}
