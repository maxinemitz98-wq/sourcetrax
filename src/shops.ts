import type { ShopLink } from "./types.ts";

/**
 * How much we trust each search-URL pattern (see README "Shop URL patterns"):
 *  - "indexed":  a live search-results URL in exactly this form was found in a web index (Sep 2026)
 *  - "platform": URL is the standard search for the shop's platform (WooCommerce ?s=) or a
 *                long-stable public pattern; not fetched from this environment
 *  - "unverified": best knowledge; run `bun run check-shops` to confirm before relying on it
 */
export type Verified = "indexed" | "platform" | "unverified";

export interface Shop {
  id: string;
  name: string;
  kind: "digital" | "vinyl";
  region: "EU" | "UK" | "global";
  currency: "EUR" | "GBP" | "USD";
  /** Build a search URL for a free-text query. */
  search: (q: string) => string;
  /** Does searching by catalog number work well here? (vinyl shops index catnos). */
  catno: boolean;
  verified: Verified;
  note?: string;
}

const enc = encodeURIComponent;
const plus = (q: string) => enc(q).replace(/%20/g, "+");

/** One place to add/remove shops. Order = display order. */
export const SHOPS: Shop[] = [
  // ---- digital ----
  { id: "bandcamp", name: "Bandcamp", kind: "digital", region: "global", currency: "EUR", catno: false, verified: "platform",
    search: (q) => `https://bandcamp.com/search?q=${plus(q)}` },
  { id: "beatport", name: "Beatport", kind: "digital", region: "global", currency: "EUR", catno: false, verified: "platform",
    search: (q) => `https://www.beatport.com/search?q=${plus(q)}` },
  { id: "traxsource", name: "Traxsource", kind: "digital", region: "global", currency: "EUR", catno: false, verified: "indexed",
    search: (q) => `https://www.traxsource.com/search?term=${plus(q)}` },
  { id: "junodownload", name: "Juno Download", kind: "digital", region: "UK", currency: "GBP", catno: false, verified: "platform",
    note: "same search engine as juno.co.uk (q[all][]=)",
    search: (q) => `https://www.junodownload.com/search/?q%5Ball%5D%5B%5D=${plus(q)}&solrorder=relevancy` },

  // ---- new vinyl, EU/UK ----
  { id: "juno", name: "Juno Records", kind: "vinyl", region: "UK", currency: "GBP", catno: true, verified: "indexed",
    search: (q) => `https://www.juno.co.uk/search/?q%5Ball%5D%5B%5D=${plus(q)}&solrorder=relevancy&hide_forthcoming=0` },
  { id: "deejay", name: "Deejay.de", kind: "vinyl", region: "EU", currency: "EUR", catno: true, verified: "unverified",
    note: "deejay.de treats the path as a search term",
    search: (q) => `https://www.deejay.de/${enc(q)}` },
  { id: "decks", name: "Decks.de", kind: "vinyl", region: "EU", currency: "EUR", catno: true, verified: "indexed",
    search: (q) => `https://www.decks.de/decks/workfloor/search_db.php?such=${plus(q)}&wosuch=all&wassuch=atl&where=1st` },
  { id: "hhv", name: "HHV", kind: "vinyl", region: "EU", currency: "EUR", catno: true, verified: "unverified",
    search: (q) => `https://www.hhv.de/en-US/search?q=${plus(q)}` },
  { id: "hardwax", name: "Hard Wax", kind: "vinyl", region: "EU", currency: "EUR", catno: true, verified: "unverified",
    search: (q) => `https://hardwax.com/?search=${plus(q)}` },
  { id: "phonica", name: "Phonica", kind: "vinyl", region: "UK", currency: "GBP", catno: true, verified: "unverified",
    note: "/search/ exists; query parameter not confirmed",
    search: (q) => `https://www.phonicarecords.com/search/${enc(q)}` },
  { id: "redeye", name: "Redeye Records", kind: "vinyl", region: "UK", currency: "GBP", catno: true, verified: "indexed",
    search: (q) => `https://www.redeyerecords.co.uk/search/?keywords=${plus(q)}` },
  { id: "yoyaku", name: "Yoyaku", kind: "vinyl", region: "EU", currency: "EUR", catno: true, verified: "platform",
    note: "WordPress/WooCommerce product search",
    search: (q) => `https://yoyaku.io/?s=${plus(q)}&post_type=product` },
  { id: "clone", name: "Clone", kind: "vinyl", region: "EU", currency: "EUR", catno: true, verified: "indexed",
    search: (q) => `https://clone.nl/search?instock=0&query=${plus(q)}` },
  { id: "rushhour", name: "Rush Hour", kind: "vinyl", region: "EU", currency: "EUR", catno: true, verified: "indexed",
    search: (q) => `https://www.rushhour.nl/search?query=${plus(q)}` },
  { id: "bordello", name: "Bordello A Parigi", kind: "vinyl", region: "EU", currency: "EUR", catno: true, verified: "platform",
    note: "WordPress/WooCommerce product search",
    search: (q) => `https://bordelloaparigi.com/?s=${plus(q)}&post_type=product` },
];

export function buildShopLinks(input: { artist?: string; title?: string; catno?: string }, shops: Shop[] = SHOPS): ShopLink[] {
  const text = [firstArtist(input.artist), input.title].filter(Boolean).join(" ").trim();
  const out: ShopLink[] = [];
  for (const s of shops) {
    const useCatno = s.catno && !!input.catno;
    const query = useCatno ? input.catno! : text;
    if (!query) continue;
    out.push({
      shop: s.name,
      kind: s.kind,
      region: s.region,
      query,
      queryType: useCatno ? "catno" : "text",
      url: s.search(query),
      fallbackUrl: useCatno && text ? s.search(text) : undefined,
      verified: s.verified,
    });
  }
  return out;
}

/** "Fred again.., Skrillex, Four Tet" -> "Fred again.."; Discogs "Mark (2)" -> "Mark". */
function firstArtist(a?: string) {
  if (!a) return a;
  return a.split(/\s*,\s*|\s+&\s+|\s+feat\.?\s+/i)[0].replace(/\s\(\d+\)$/, "").replace(/\*$/, "").trim();
}
