import { expect, test } from "bun:test";
import { buildShopLinks, SHOPS } from "../src/shops.ts";

test("every shop builds an absolute https URL that contains the encoded query", () => {
  for (const s of SHOPS) {
    const url = s.search("Strings Of Life");
    expect(url.startsWith("https://")).toBe(true);
    expect(() => new URL(url)).not.toThrow();
    expect(decodeURIComponent(url.replace(/\+/g, " "))).toContain("Strings Of Life");
  }
});

test("shop ids are unique", () => {
  expect(new Set(SHOPS.map((s) => s.id)).size).toBe(SHOPS.length);
});

test("vinyl shops search by catno with a text fallback, digital shops by text", () => {
  const links = buildShopLinks({ artist: "Rhythim Is Rhythim", title: "Strings Of Life", catno: "MS-1" });
  const juno = links.find((l) => l.shop === "Juno Records")!;
  expect(juno.queryType).toBe("catno");
  expect(juno.url).toContain("MS-1");
  expect(juno.fallbackUrl).toContain("Rhythim+Is+Rhythim+Strings+Of+Life");
  const bc = links.find((l) => l.shop === "Bandcamp")!;
  expect(bc.queryType).toBe("text");
  expect(bc.url).toBe("https://bandcamp.com/search?q=Rhythim+Is+Rhythim+Strings+Of+Life");
});

test("multi-artist credits use the first artist; Discogs suffixes dropped", () => {
  const [l] = buildShopLinks({ artist: "Fred again.., Skrillex, Four Tet", title: "Baby again.." });
  expect(l.query).toBe("Fred again.. Baby again..");
  const [m] = buildShopLinks({ artist: "Mark (2)", title: "Dreamland" });
  expect(m.query).toBe("Mark Dreamland");
});
