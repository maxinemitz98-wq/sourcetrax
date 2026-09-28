import { beforeAll, describe, expect, test } from "bun:test";
import { installDemo } from "./fixtures/demo.ts";
import { run } from "../src/pipeline.ts";
import { buildRows } from "../src/web/rows.ts";
import { makeHandler } from "../server.ts";
import type { Result } from "../src/types.ts";

const SPOTIFY = "https://open.spotify.com/track/2jwRKUOBoN1hiMFuuKdIJE";
const opts = { currency: "EUR", statsLimit: 15 };
const handle = makeHandler();
const get = (path: string) => handle(new Request(`http://x${path}`));

beforeAll(() => {
  installDemo();
  process.env.DISCOGS_TOKEN = "demo";
});

describe("table rows", () => {
  test("Discogs rows carry real prices; shops link out with no price; ordered by place", async () => {
    const rows = buildRows(await run(SPOTIFY, opts));
    const places = rows.map((r) => r.place);
    expect(places).toEqual([...places].sort((a, b) => a.localeCompare(b)));

    const discogs = rows.filter((r) => r.place === "Discogs");
    expect(discogs.map((r) => [r.what, r.avail, r.price?.value])).toEqual([
      ['12" · original 1986 press', "14 copies for sale", 85],
      ['12" · 3 later pressings, newest 2025', "53 copies for sale", 14],
      ['12" · unofficial pressing (bootleg)', "9 copies for sale", 11],
    ]);
    expect(discogs.every((r) => r.type === "vinyl")).toBe(true);

    const shops = rows.filter((r) => r.place !== "Discogs");
    expect(shops.every((r) => r.price === undefined && r.avail === "Stock not checked")).toBe(true);
    expect(rows.find((r) => r.place === "Juno Records")!.what).toBe('12" · catalog no. ML 2224');
    expect(rows.find((r) => r.place === "Bandcamp")!.type).toBe("digital");
  });
});

describe("server", () => {
  test("home page", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Find your track.");
    expect(html).toContain("Lossless or on wax.");
    expect(html).toContain('action="/find"');
  });

  test("rejects missing and unsupported links on the home page", async () => {
    let res = await get("/find?url=");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Paste a link first.");
    res = await get(`/find?url=${encodeURIComponent("https://someone.bandcamp.com/track/x")}`);
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("isn&#39;t from Spotify, Apple Music or YouTube");
    expect(html).toContain('value="https://someone.bandcamp.com/track/x"');
  });

  test("results page: record, other matches, table", async () => {
    const res = await get(`/find?url=${encodeURIComponent(SPOTIFY)}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1>Can You Feel It</h1>");
    expect(html).toContain("Not this record? 2 other matches");
    expect(html).toContain(`/find?url=${encodeURIComponent(SPOTIFY)}&amp;release=9300001`);
    expect(html).toContain('class="row vinyl" data-type="vinyl" data-place="Discogs" data-price="85"');
    expect(html).toContain('class="row digital" data-type="digital" data-place="Bandcamp" data-price=""');
    expect(html).toContain(">Check price</a>");
    expect(html).toContain("from €85.00");
  });

  test("picking another match expands that release", async () => {
    const html = await (await get(`/find?url=${encodeURIComponent(SPOTIFY)}&release=9300001`)).text();
    expect(html).toContain("<h1>Can You Feel It (Remixes)</h1>");
    expect(html).toContain("Not this record? 2 other matches");
  });

  test("JSON API", async () => {
    const res = await get(`/api/find?url=${encodeURIComponent(SPOTIFY)}`);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as Result;
    expect(body.identify.chosenReleaseId).toBe(9000001);
  });

  test("escapes text from APIs", async () => {
    const evil = makeHandler(async (input) => {
      const r = await run(input, opts);
      r.identify.candidates[0].title = `<img src=x onerror=alert(1)>`;
      return r;
    });
    const html = await (await evil(new Request(`http://x/find?url=${encodeURIComponent(SPOTIFY)}`))).text();
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});
