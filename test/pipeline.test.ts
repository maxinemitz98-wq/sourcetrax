/**
 * Offline end-to-end tests of the pipeline with a mocked fetch.
 *
 * The API payloads below are SYNTHETIC: hand-written in the shape of each API's
 * documented responses, with made-up ids (9xxxxxx). They exercise the fall-through
 * and ranking logic; they say nothing about real-world match quality (see REPORT.md).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { setCacheEnabled, setFetch, setThrottleEnabled } from "../src/http.ts";
import { run } from "../src/pipeline.ts";

type Route = [RegExp, unknown | ((url: string) => unknown), number?, Record<string, string>?];
let routes: Route[] = [];
const seen: string[] = [];

function mock(url: string): Promise<Response> {
  seen.push(url);
  for (const [re, body, status = 200, headers = {}] of routes) {
    if (re.test(url)) {
      const b = typeof body === "function" ? (body as (u: string) => unknown)(url) : body;
      return Promise.resolve(new Response(typeof b === "string" ? b : JSON.stringify(b), { status, headers }));
    }
  }
  return Promise.resolve(new Response("not found", { status: 404 }));
}

const opts = { currency: "EUR", statsLimit: 10 };

beforeAll(() => {
  setFetch(mock);
  setCacheEnabled(false);
  setThrottleEnabled(false);
});
beforeEach(() => {
  routes = [];
  seen.length = 0;
  process.env.DISCOGS_TOKEN = "test-token";
  delete process.env.YOUTUBE_API_KEY;
});
afterAll(() => {
  setFetch((u, i) => fetch(u, i));
});

// ---- shared Discogs fixtures: a classic with an original, represses and a bootleg ----

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
const vinylRelease = (id: number, extra: object = {}) => ({
  id,
  title: "Can You Feel It",
  artists_sort: "Mr. Fingers",
  labels: [{ name: "Trax Records", catno: "TX117" }],
  year: 1986,
  country: "US",
  formats: [{ name: "Vinyl", qty: "1", descriptions: ['12"', "33 ⅓ RPM"] }],
  genres: ["Electronic"],
  styles: ["Deep House", "Chicago House"],
  master_id: master.id,
  tracklist: [
    { position: "A", title: "Can You Feel It", type_: "track" },
    { position: "B", title: "Washing Machine", type_: "track" },
  ],
  ...extra,
});
const discogsRoutes: Route[] = [
  [/api\.discogs\.com\/masters\/9100001\/versions/, versions],
  [/api\.discogs\.com\/masters\/9100001(\?|$)/, master],
  [/api\.discogs\.com\/marketplace\/stats\/(\d+)/, (u: string) => ({ num_for_sale: Number(u.match(/stats\/(\d+)/)![1]) % 7, lowest_price: { value: 12.5, currency: "EUR" } })],
  [/api\.discogs\.com\/releases\/9000001/, vinylRelease(9000001)],
];

describe("Spotify -> Odesli -> Deezer ISRC -> MusicBrainz -> Discogs", () => {
  test("identifies via musicbrainz-isrc and expands versions", async () => {
    routes = [
      [/api\.song\.link/, {
        entityUniqueId: "SPOTIFY_SONG::abc",
        linksByPlatform: { deezer: { url: "https://www.deezer.com/track/555", entityUniqueId: "DEEZER_SONG::555" }, spotify: { url: "https://open.spotify.com/track/abc", entityUniqueId: "SPOTIFY_SONG::abc" } },
        entitiesByUniqueId: {
          "SPOTIFY_SONG::abc": { title: "Can You Feel It", artistName: "Mr. Fingers" },
          "DEEZER_SONG::555": { title: "Can You Feel It", artistName: "Mr. Fingers" },
        },
      }],
      [/api\.deezer\.com\/track\/555/, { id: 555, title: "Can You Feel It", title_short: "Can You Feel It", isrc: "USXXX8600001", artist: { name: "Mr. Fingers" }, contributors: [{ name: "Mr. Fingers", role: "Main" }], album: { id: 777, title: "Can You Feel It" }, release_date: "2013-01-01" }],
      [/api\.deezer\.com\/album\/777/, { id: 777, title: "Can You Feel It", label: "Alleviated Records", upc: "0000000000001", release_date: "2013-01-01" }],
      [/musicbrainz\.org\/ws\/2\/isrc\/USXXX8600001/, { recordings: [{ id: "rec1", releases: [{ id: "mbrel-digital", status: "Official", date: "2013" }] }] }],
      [/musicbrainz\.org\/ws\/2\/release\/mbrel-digital/, { relations: [{ type: "discogs", url: { resource: "https://www.discogs.com/release/9000009" } }], "release-group": { id: "rg1" } }],
      // The MB-linked Discogs release is the digital one; it points at the same master.
      [/api\.discogs\.com\/releases\/9000009/, vinylRelease(9000009, { formats: [{ name: "File", descriptions: ["FLAC"] }], labels: [{ name: "Alleviated Records", catno: "ML-D1" }], year: 2013 })],
      ...discogsRoutes,
    ];
    const r = await run("https://open.spotify.com/track/abc", opts);
    expect(r.resolved.isrc).toBe("USXXX8600001");
    expect(r.resolved.sources).toEqual(["odesli", "deezer"]);
    expect(r.identify.path).toBe("musicbrainz-isrc");
    expect(r.identify.candidates[0].masterId).toBe(9100001);
    expect(r.expanded!.versions.map((v) => [v.year, v.isOriginal, v.isReissue, v.isRecent])).toEqual([
      [1986, true, false, false],
      [1987, false, true, false],
      [2004, false, true, false],
      [2012, false, true, false],
      [2025, false, true, true],
    ]);
    // Newest pressing's catno drives the new-vinyl shop search.
    expect(r.whereToGet.vinyl[0].query).toBe("ML 2224");
    expect(r.whereToGet.digital[0].query).toBe("Mr. Fingers Can You Feel It");
    expect(r.whereToGet.discogs.map((d) => d.url)).toContain("https://www.discogs.com/sell/release/9000005");
    // No Discogs search calls needed.
    expect(seen.some((u) => u.includes("/database/search"))).toBe(false);
  });
});

describe("YouTube rip, Odesli down -> oEmbed title -> Discogs search", () => {
  test("falls through and ranks the right master first", async () => {
    routes = [
      [/api\.song\.link/, "rate limited", 429, { "retry-after": "60" }],
      [/youtube\.com\/oembed/, { title: "Mr. Fingers - Can You Feel It (Trax | 1986)", author_name: "housearchive" }],
      [/database\/search.*format=Vinyl/, {
        results: [
          // A compilation that contains the track: different master, "Various" artist.
          { id: 9200001, type: "release", master_id: 9100002, title: "Various - Chicago Jacks", catno: "CJ 1", label: ["Jack Records"], format: ["Vinyl", "LP", "Compilation"], genre: ["Electronic"], style: ["House"], year: "1988" },
          { id: 9000003, type: "release", master_id: 9100001, title: "Mr. Fingers - Can You Feel It", catno: "TX117", label: ["Trax Records"], format: ["Vinyl", '12"', "RE"], genre: ["Electronic"], year: "2004" },
          { id: 9000001, type: "release", master_id: 9100001, title: "Mr. Fingers - Can You Feel It", catno: "TX117", label: ["Trax Records"], format: ["Vinyl", '12"'], genre: ["Electronic"], year: "1986" },
        ],
      }],
      [/api\.discogs\.com\/releases\/9200001/, {
        id: 9200001, title: "Chicago Jacks", artists_sort: "Various", labels: [{ name: "Jack Records", catno: "CJ 1" }], year: 1988,
        formats: [{ name: "Vinyl", descriptions: ["LP", "Compilation"] }], genres: ["Electronic"], styles: ["House"], master_id: 9100002,
        tracklist: [{ position: "A1", title: "Can You Feel It", artists: [{ name: "Mr. Fingers" }] }, { position: "A2", title: "Jack Your Body", artists: [{ name: "Steve 'Silk' Hurley" }] }],
      }],
      ...discogsRoutes,
    ];
    const r = await run("https://www.youtube.com/watch?v=abcdefghijk", opts);
    expect(r.resolved.notes.join(" ")).toContain("odesli failed (429)");
    expect(r.resolved.sources).toEqual(["youtube-oembed", "youtube-title-parse"]);
    expect(r.resolved.label).toBe("Trax");
    expect(r.identify.path).toBe("discogs-search");
    const [first, second] = r.identify.candidates;
    // Original (not the 2004 repress) chosen as the representative of its master.
    expect(first.releaseId).toBe(9000001);
    expect(first.confidence).toBe("high");
    expect(first.matchedTrack).toBe("A Can You Feel It");
    expect(second.releaseId).toBe(9200001);
    expect(second.score).toBeLessThan(first.score);
    expect(r.identify.tried.find((t) => t.path === "youtube-description")!.outcome).toContain("YOUTUBE_API_KEY");
  });
});

describe("YouTube with API key: Discogs link in description", () => {
  test("uses youtube-description path and skips search", async () => {
    process.env.YOUTUBE_API_KEY = "k";
    routes = [
      [/api\.song\.link/, "gone", 410],
      [/googleapis\.com\/youtube\/v3\/videos/, { items: [{ snippet: { title: "Mr. Fingers - Can You Feel It", channelTitle: "somebody", description: "Original 1986 press.\nhttps://www.discogs.com/master/9100001-Mr-Fingers-Can-You-Feel-It" } }] }],
      ...discogsRoutes,
    ];
    const r = await run("https://youtu.be/abcdefghijk", opts);
    expect(r.resolved.discogsLinks).toEqual([{ type: "master", id: 9100001 }]);
    expect(r.identify.path).toBe("youtube-description");
    expect(r.identify.candidates[0].releaseId).toBe(9000001);
    expect(seen.some((u) => u.includes("/database/search"))).toBe(false);
    expect(seen.some((u) => u.includes("oembed"))).toBe(false);
  });
});

describe("Odesli maps a vinyl rip to an unrelated streaming track", () => {
  test("the bogus Deezer match is ignored", async () => {
    routes = [
      [/api\.song\.link/, {
        entityUniqueId: "YOUTUBE_VIDEO::abcdefghijk",
        linksByPlatform: { deezer: { url: "https://www.deezer.com/track/1", entityUniqueId: "DEEZER_SONG::1" } },
        entitiesByUniqueId: {
          "YOUTUBE_VIDEO::abcdefghijk": { title: "P.R.D. – I Want To... (Vocal) Rare Italo Disco 1984", artistName: "italo archive" },
          "DEEZER_SONG::1": { title: "I Want You Back", artistName: "Someone Else" },
        },
      }],
      [/youtube\.com\/oembed/, { title: "P.R.D. – I Want To... (Vocal) Rare Italo Disco 1984", author_name: "italo archive" }],
      [/database\/search/, { results: [] }],
    ];
    const r = await run("https://www.youtube.com/watch?v=abcdefghijk", opts);
    expect(r.resolved.notes.join(" ")).toContain("doesn't match the video title; ignored");
    expect(r.resolved.isrc).toBeUndefined();
    expect(seen.some((u) => u.includes("api.deezer.com"))).toBe(false);
    expect(r.resolved.artist).toBe("P.R.D.");
    expect(r.resolved.title).toBe("I Want To...");
    expect(r.identify.path).toBeUndefined();
    expect(r.identify.tried.at(-1)!.outcome).toContain("no results");
    // Still produce text-search shop links.
    expect(r.whereToGet.vinyl[0].query).toBe("P.R.D. I Want To...");
  });
});

test("without DISCOGS_TOKEN the search path is skipped with a clear reason", async () => {
  delete process.env.DISCOGS_TOKEN;
  routes = [[/youtube\.com\/oembed/, { title: "Artist - Title", author_name: "x" }]];
  const r = await run("https://www.youtube.com/watch?v=abcdefghijk", opts);
  expect(r.identify.tried.at(-1)).toEqual({ path: "discogs-search", outcome: "skipped: DISCOGS_TOKEN not set" });
});

describe("ISRC resolves to a compilation", () => {
  test("Discogs search is also run and the original record outranks the compilation", async () => {
    const comp = {
      id: 9200001, title: "Chicago Jacks", artists_sort: "Various", labels: [{ name: "Jack Records", catno: "CJ 1" }], year: 1988,
      formats: [{ name: "Vinyl", descriptions: ["LP", "Compilation"] }], genres: ["Electronic"], styles: ["House"], master_id: 9100002,
      tracklist: [{ position: "A1", title: "Can You Feel It", artists: [{ name: "Mr. Fingers" }] }],
    };
    routes = [
      [/api\.song\.link/, {
        entityUniqueId: "SPOTIFY_SONG::abc",
        linksByPlatform: { deezer: { url: "https://www.deezer.com/track/555", entityUniqueId: "DEEZER_SONG::555" } },
        entitiesByUniqueId: { "SPOTIFY_SONG::abc": { title: "Can You Feel It", artistName: "Mr. Fingers" } },
      }],
      [/api\.deezer\.com\/track\/555/, { id: 555, title: "Can You Feel It", isrc: "USXXX8600001", artist: { name: "Mr. Fingers" } }],
      [/musicbrainz\.org\/ws\/2\/isrc/, { recordings: [{ id: "rec1", releases: [{ id: "mbcomp", status: "Official", date: "1988" }] }] }],
      [/musicbrainz\.org\/ws\/2\/release\/mbcomp/, { relations: [{ type: "discogs", url: { resource: "https://www.discogs.com/release/9200001" } }] }],
      [/api\.discogs\.com\/releases\/9200001/, comp],
      [/database\/search.*format=Vinyl/, { results: [{ id: 9000001, type: "release", master_id: 9100001, title: "Mr. Fingers - Can You Feel It", catno: "TX117", format: ["Vinyl"], year: "1986" }] }],
      ...discogsRoutes,
    ];
    const r = await run("https://open.spotify.com/track/abc", opts);
    expect(r.identify.candidates.map((c) => c.releaseId)).toEqual([9000001, 9200001]);
    expect(r.identify.path).toBe("discogs-search");
    expect(r.identify.tried.map((t) => t.path)).toEqual(["musicbrainz-isrc", "discogs-search"]);
    expect(r.identify.candidates[1].reasons).toContain("compilation (prefer the original record)");
  });
});
