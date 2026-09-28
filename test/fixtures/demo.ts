/**
 * SYNTHETIC API responses for offline demos and page tests (SOURCETRAX_DEMO=1).
 * Shaped like the real APIs, with made-up Discogs ids (9xxxxxx) and prices:
 * links built from them do not point at the right Discogs pages.
 */
import { setCacheEnabled, setFetch, setThrottleEnabled } from "../../src/http.ts";

type Route = [RegExp, unknown | ((url: string) => unknown), number?];

const master = { id: 9100001, title: "Can You Feel It", year: 1986, main_release: 9000001, num_for_sale: 140, lowest_price: 9.5 };
const versions = {
  pagination: { page: 1, pages: 1, items: 5 },
  versions: [
    { id: 9000001, title: "Can You Feel It", format: '12", 33 ⅓ RPM', label: "Trax Records", country: "US", released: "1986", catno: "TX117", major_formats: ["Vinyl"] },
    { id: 9000002, title: "Can You Feel It", format: '12"', label: "Jack Trax", country: "UK", released: "1987", catno: "JTX 20", major_formats: ["Vinyl"] },
    { id: 9000003, title: "Can You Feel It", format: '12", RE', label: "Trax Records", country: "US", released: "2004", catno: "TX117", major_formats: ["Vinyl"] },
    { id: 9000004, title: "Can You Feel It", format: '12", Unofficial Release', label: "Not On Label", country: "Europe", released: "2012", catno: "none", major_formats: ["Vinyl"] },
    { id: 9000005, title: "Can You Feel It", format: '12", RP, 180g', label: "Alleviated Records", country: "Europe", released: "2025", catno: "ML 2224", major_formats: ["Vinyl"] },
  ],
};
const stats: Record<number, { num_for_sale: number; lowest_price: { value: number; currency: string } | null }> = {
  9000001: { num_for_sale: 14, lowest_price: { value: 85, currency: "EUR" } },
  9000002: { num_for_sale: 6, lowest_price: { value: 40, currency: "EUR" } },
  9000003: { num_for_sale: 31, lowest_price: { value: 16, currency: "EUR" } },
  9000004: { num_for_sale: 9, lowest_price: { value: 11, currency: "EUR" } },
  9000005: { num_for_sale: 16, lowest_price: { value: 14, currency: "EUR" } },
};
const original = {
  id: 9000001, title: "Can You Feel It", artists_sort: "Mr. Fingers", artists: [{ id: 9500001, name: "Mr. Fingers" }],
  notes: "Demo notes: recorded at home on a [a=Roland] TR-707. [url=https://example.com]Pressing info[/url] on the B-side label.",
  labels: [{ name: "Trax Records", catno: "TX117" }], year: 1986, country: "US",
  formats: [{ name: "Vinyl", qty: "1", descriptions: ['12"', "33 ⅓ RPM"] }], genres: ["Electronic"], styles: ["Deep House", "Chicago House"], master_id: master.id,
  tracklist: [{ position: "A", title: "Can You Feel It", type_: "track" }, { position: "B", title: "Washing Machine", type_: "track" }],
};
const compilation = {
  id: 9200001, title: "Chicago Jacks", artists_sort: "Various", labels: [{ name: "Jack Records", catno: "CJ 1" }], year: 1988,
  formats: [{ name: "Vinyl", descriptions: ["LP", "Compilation"] }], genres: ["Electronic"], styles: ["House"], master_id: 9100002,
  tracklist: [{ position: "A1", title: "Can You Feel It", artists: [{ name: "Mr. Fingers" }] }],
};
const remix = {
  id: 9300001, title: "Can You Feel It (Remixes)", artists_sort: "Mr. Fingers", artists: [{ id: 9500001, name: "Mr. Fingers" }], labels: [{ name: "Alleviated Records", catno: "ML 2230" }], year: 2019,
  formats: [{ name: "Vinyl", descriptions: ['12"'] }], genres: ["Electronic"], styles: ["Deep House"], master_id: 9100003,
  tracklist: [{ position: "A", title: "Can You Feel It (Remix)" }, { position: "B", title: "Can You Feel It (Dub)" }],
};

export const demoRoutes: Route[] = [
  [/api\.song\.link/, {
    entityUniqueId: "SPOTIFY_SONG::demo",
    linksByPlatform: { deezer: { url: "https://www.deezer.com/track/555", entityUniqueId: "DEEZER_SONG::555" } },
    entitiesByUniqueId: { "SPOTIFY_SONG::demo": { title: "Can You Feel It", artistName: "Mr. Fingers" }, "DEEZER_SONG::555": { title: "Can You Feel It", artistName: "Mr. Fingers" } },
  }],
  [/youtube\.com\/oembed/, { title: "Mr. Fingers - Can You Feel It (Trax | 1986)", author_name: "demo" }],
  [/itunes\.apple\.com/, { results: [{ artistName: "Mr. Fingers", trackName: "Can You Feel It" }] }],
  [/api\.deezer\.com\/track\/555/, { id: 555, title: "Can You Feel It", artist: { name: "Mr. Fingers" } }],
  [/database\/search/, {
    results: [
      { id: 9000001, type: "release", master_id: 9100001, title: "Mr. Fingers - Can You Feel It", catno: "TX117", label: ["Trax Records"], format: ["Vinyl", '12"'], genre: ["Electronic"], year: "1986" },
      { id: 9200001, type: "release", master_id: 9100002, title: "Various - Chicago Jacks", catno: "CJ 1", label: ["Jack Records"], format: ["Vinyl", "LP", "Compilation"], genre: ["Electronic"], year: "1988" },
      { id: 9300001, type: "release", master_id: 9100003, title: "Mr. Fingers - Can You Feel It (Remixes)", catno: "ML 2230", label: ["Alleviated Records"], format: ["Vinyl", '12"'], genre: ["Electronic"], year: "2019" },
    ],
  }],
  [/api\.discogs\.com\/masters\/9100001\/versions/, versions],
  [/api\.discogs\.com\/masters\/9100001(\?|$)/, master],
  [/api\.discogs\.com\/masters\/\d+\/versions/, { pagination: { pages: 1, items: 0 }, versions: [] }],
  [/api\.discogs\.com\/masters\/\d+(\?|$)/, (u: string) => ({ id: Number(u.match(/masters\/(\d+)/)![1]), title: "Demo master", year: 1988 })],
  [/api\.discogs\.com\/marketplace\/stats\/(\d+)/, (u: string) => stats[Number(u.match(/stats\/(\d+)/)![1])] ?? { num_for_sale: 3, lowest_price: { value: 20, currency: "EUR" } }],
  [/api\.discogs\.com\/artists\/9500001\/releases/, {
    pagination: { items: 3 },
    releases: [
      { id: 9100001, type: "master", role: "Main", title: "Can You Feel It" },
      { id: 9100003, type: "master", role: "Main", title: "Can You Feel It (Remixes)" },
      { id: 9200001, type: "release", role: "TrackAppearance", title: "Chicago Jacks" },
    ],
  }],
  [/api\.discogs\.com\/artists\/9500001/, {
    id: 9500001, name: "Mr. Fingers", realname: "Demo Realname",
    aliases: [{ id: 9500002, name: "Demo Alias" }, { id: 9500003, name: "Other Alias (2)" }],
    profile: "Demo profile: Chicago house producer. Worked with [a=Demo Vocalist] and released on [l=Trax Records].",
  }],
  [/api\.discogs\.com\/releases\/9000001/, original],
  [/api\.discogs\.com\/releases\/9200001/, compilation],
  [/api\.discogs\.com\/releases\/9300001/, remix],
];

export function demoFetch(url: string): Promise<Response> {
  for (const [re, body, status = 200] of demoRoutes) {
    if (re.test(url)) {
      const b = typeof body === "function" ? (body as (u: string) => unknown)(url) : body;
      return Promise.resolve(new Response(JSON.stringify(b), { status }));
    }
  }
  return Promise.resolve(new Response("not found", { status: 404 }));
}

export function installDemo() {
  process.env.DISCOGS_TOKEN ||= "demo";
  process.env.SOURCETRAX_DEMO ||= "1";
  setFetch(demoFetch);
  setCacheEnabled(false);
  setThrottleEnabled(false);
}
