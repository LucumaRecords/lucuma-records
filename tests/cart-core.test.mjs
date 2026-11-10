import test from "node:test";
import assert from "node:assert/strict";
import { buildCartWhatsAppMessage, canAddProduct, formatCartEdition, normalizeCartIds, reconcileCartIds, summarizeCart } from "../assets/cart-core.mjs";

const available = (overrides = {}) => ({
  id: "record-a",
  artist: "Crosby & Nash",
  album: "The Best Of…",
  country: "USA",
  year: 1978,
  editionType: "Primera edición",
  priceARS: 20000,
  availability: "available",
  published: true,
  ...overrides
});

test("normaliza IDs del carrito y elimina repeticiones sin alterar el orden", () => {
  assert.deepEqual(normalizeCartIds(["a", "b", "a", "", null, " c "]), ["a", "b", "c"]);
});

test("solo permite agregar ejemplares publicados y disponibles", () => {
  assert.equal(canAddProduct(available()), true);
  assert.equal(canAddProduct(available({ availability: "reserved" })), false);
  assert.equal(canAddProduct(available({ availability: "sold" })), false);
  assert.equal(canAddProduct(available({ published: false })), false);
});

test("revalida y retira registros vendidos, no disponibles o ausentes", () => {
  const products = [available(), available({ id: "record-b", availability: "reserved" })];
  assert.deepEqual(reconcileCartIds(["record-a", "record-b", "retirado", "record-a"], products), {
    ids: ["record-a"],
    removedCount: 2
  });
});

test("calcula subtotales exactos y distingue productos sin precio", () => {
  const summary = summarizeCart([available(), available({ id: "record-b", priceARS: undefined })]);
  assert.equal(summary.subtotal, 20000);
  assert.equal(summary.pricedCount, 1);
  assert.equal(summary.unpricedCount, 1);
  assert.equal(summary.hasUnpriced, true);
});

test("presenta país, año y edición sin duplicar datos repetidos", () => {
  assert.equal(formatCartEdition(available()), "USA · 1978 · Primera edición");
  assert.equal(formatCartEdition(available({ editionType: "USA 1978, reissue" })), "USA 1978, reissue");
});

test("mensaje de WhatsApp identifica discos, precios y subtotal parcial sin sumar envíos", () => {
  const message = buildCartWhatsAppMessage([
    available(),
    available({ id: "record-b", artist: "Billy Joel", album: "Songs In The Attic", priceARS: undefined })
  ]);
  assert.match(message, /Crosby & Nash — The Best Of…/);
  assert.match(message, /USA · 1978 · Primera edición/);
  assert.match(message, /Billy Joel — Songs In The Attic/);
  assert.match(message, /Precio a consultar/);
  assert.match(message, /Subtotal parcial informativo/);
  assert.match(message, /Hay discos sin precio informado/);
  assert.doesNotMatch(message, /gastos de envío|costo de envío/iu);
});

test("mensaje no inventa un subtotal si ningún producto tiene precio", () => {
  const message = buildCartWhatsAppMessage([available({ priceARS: undefined })]);
  assert.match(message, /Subtotal informativo: A consultar/);
  assert.doesNotMatch(message, /Subtotal parcial informativo: \$/u);
});
