import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseVinylList } from "../scripts/parse-vinyl-list.mjs";
import { materializeParsed } from "../scripts/import-vinyl-list.mjs";

const emptyHistory = { version: 1, entries: [] };
const noPhotos = [];

async function existingProducts() {
  const files = [
    "da2e43b8-3d40-4492-9dee-42d9857504f2.json",
    "8e3ded16-33e0-4972-a924-136b7e340be8.json",
    "93dfb9b7-3290-4703-813b-9da7bd7f9693.json",
    "c6a194e4-c515-4cbb-bb0e-28e77a67168e.json"
  ];
  return Promise.all(files.map(async file => JSON.parse(await readFile(new URL(`../data/vinilos/${file}`, import.meta.url), "utf8"))));
}

function review(text, records, registry = emptyHistory) {
  return materializeParsed(parseVinylList(text), records, noPhotos, registry);
}

test("all four current records are read and Kiss is matched even without history", async () => {
  const records = await existingProducts();
  assert.equal(records.length, 4);
  const cases = [
    ["Kiss - Destroyer 🇺🇸\nEdición USA 1977", "da2e43b8-3d40-4492-9dee-42d9857504f2"],
    ["Gordon Lightfoot - Endless Wire 🇺🇸", "8e3ded16-33e0-4972-a924-136b7e340be8"],
    ["Stephen Stills - Right By You 🇦🇷", "93dfb9b7-3290-4703-813b-9da7bd7f9693"],
    ["The Christians - The Christians 🇧🇷", "c6a194e4-c515-4cbb-bb0e-28e77a67168e"]
  ];
  for (const [text, id] of cases) {
    const product = review(text, records)[0];
    assert.equal(product.operation, "pending_duplicate", text);
    assert.equal(product.duplicates.some(item => item.productId === id), true, text);
  }
});

test("same album in explicitly different countries remains a separate edition", async () => {
  const records = await existingProducts();
  records.push({ id: "11111111-1111-4111-8111-111111111111", artist: "Crosby & Nash", album: "The Best Of", country: "USA" });
  const uk = review("Crosby & Nash - The Best Of 🇬🇧\nEdición UK", records)[0];
  assert.equal(uk.operation, "create");
  assert.deepEqual(uk.duplicates, []);
});

test("an indistinguishable physical copy is held for review", async () => {
  const records = await existingProducts();
  records.push({ id: "22222222-2222-4222-8222-222222222222", artist: "Crosby & Nash", album: "The Best Of", country: "USA", editionType: "USA" });
  const copy = review("Crosby & Nash - The Best Of 🇺🇸\nEdición USA", records)[0];
  assert.equal(copy.operation, "pending_duplicate");
  assert.equal(copy.duplicates.some(item => item.productId === "22222222-2222-4222-8222-222222222222"), true);
});

test("similar spelling is flagged as a possible match", async () => {
  const records = await existingProducts();
  records.push({ id: "33333333-3333-4333-8333-333333333333", artist: "Crosby, Stills & Nash", album: "Live It Up" });
  const item = review("Crosby, Stills & Nash - Live At Up", records)[0];
  assert.equal(item.operation, "pending_duplicate");
  assert.equal(item.duplicates.some(match => match.kind === "posible"), true);
});

test("Notas supports multiline and one-line listings", () => {
  const multiline = parseVinylList("Pete Townshend - Another Scoop 🇺🇸\nEdición USA 1987 doble\nTapa NM gatefold\nDiscos EX-\nc/ inserts\n$ 50.000")[0];
  const oneLine = parseVinylList("Rush - Permanent Waves 🇺🇸 • Edición USA 1980 • Tapa VG • Disco EX • c/ insert • $ 50.000")[0];
  assert.equal(multiline.artist, "Pete Townshend");
  assert.equal(multiline.album, "Another Scoop");
  assert.equal(multiline.priceARS, 50000);
  assert.equal(oneLine.artist, "Rush");
  assert.equal(oneLine.album, "Permanent Waves");
  assert.equal(oneLine.priceARS, 50000);
});
