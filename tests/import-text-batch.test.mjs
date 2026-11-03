import test from "node:test";
import assert from "node:assert/strict";
import { inspectTextBatch, recordFromTextProduct } from "../scripts/import-text-batch.mjs";
import { parseVinylList } from "../scripts/parse-vinyl-list.mjs";
import { sourceKeys } from "../scripts/import-vinyl-list.mjs";

const emptyHistory = { version: 1, entries: [] };

test("text batch parses multiline and one-line listings without photos or inferred classification", () => {
  const text = "Pete Townshend - Another Scoop 🇺🇸\nEdición USA 1987 doble\nTapa NM gatefold\nDiscos EX-\nc/ inserts\n$ 50.000\n-\nRush - Permanent Waves 🇺🇸 • Edición USA 1980 • Tapa VG • Disco EX • c/ insert • $ 50.000";
  const items = inspectTextBatch(text, [], emptyHistory);
  assert.equal(items.length, 2);
  assert(items.every(item => item.state === "ready"));
  const record = recordFromTextProduct(items[0], "11111111-1111-4111-8111-111111111111");
  assert.equal(record.artist, "Pete Townshend");
  assert.equal(record.album, "Another Scoop");
  assert.equal(record.year, 1987);
  assert.equal(record.priceARS, 50000);
  assert.equal(record.published, true);
  assert.equal(record.availability, "available");
  assert.equal(record.genre, undefined);
  assert.equal(record.collection, undefined);
  assert.equal(record.cover, undefined);
  assert.equal(record.additionalPhotos, undefined);
});

test("explicit collection and availability are kept while unknown collections stay empty", () => {
  const product = parseVinylList("Artist - Album 🇺🇸\nGénero: Pop\nColección: Pop\nVendido")[0];
  const record = recordFromTextProduct(product, "22222222-2222-4222-8222-222222222222");
  assert.equal(record.genre, "Pop");
  assert.equal(record.collection, "pop");
  assert.equal(record.availability, "sold");
  const unknown = parseVinylList("Artist - Album\nColección: Unlisted")[0];
  assert.equal(unknown.collection, undefined);
});

test("photo folder notes do not inspect or associate photographs", () => {
  const items = inspectTextBatch("Artist - Album\nCarpeta de fotos: Album folder", [], emptyHistory);
  assert.equal(items[0].state, "ready");
  const record = recordFromTextProduct(items[0], "55555555-5555-4555-8555-555555555555");
  assert.equal(record.cover, undefined);
  assert.equal(record.additionalPhotos, undefined);
});

test("same editions are held for review, while different country or year is a separate edition", () => {
  const existing = [{ id: "33333333-3333-4333-8333-333333333333", artist: "Crosby & Nash", album: "The Best Of…", country: "USA", year: 1978 }];
  const exact = inspectTextBatch("Crosby & Nash - The Best Of… 🇺🇸\nEdición USA 1978", existing, emptyHistory)[0];
  const uk = inspectTextBatch("Crosby & Nash - The Best Of… 🇬🇧\nEdición UK 1978", existing, emptyHistory)[0];
  const laterUs = inspectTextBatch("Crosby & Nash - The Best Of… 🇺🇸\nEdición USA 1980", existing, emptyHistory)[0];
  assert.equal(exact.state, "review");
  assert.equal(exact.operation, "pending_duplicate");
  assert.equal(uk.state, "ready");
  assert.equal(laterUs.state, "ready");
});

test("a matching history key is skipped as already imported", () => {
  const text = "Grace Slick - Dreams 🇺🇸\nEdición USA 1980";
  const parsed = sourceKeys(parseVinylList(text));
  const registry = { version: 1, entries: [{ sourceKey: parsed[0].sourceKey, productId: "44444444-4444-4444-8444-444444444444", importedAt: "2026-11-03T00:00:00.000Z", kind: "created" }] };
  const existing = [{ id: "44444444-4444-4444-8444-444444444444", artist: "Grace Slick", album: "Dreams", country: "USA", year: 1980 }];
  assert.equal(inspectTextBatch(text, existing, registry)[0].state, "already_imported");
});
