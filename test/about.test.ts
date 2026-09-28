import { beforeAll, expect, test } from "bun:test";
import { cleanDiscogsMarkup, excerpt, monikerSentence } from "../src/about.ts";
import { installDemo } from "./fixtures/demo.ts";
import { run } from "../src/pipeline.ts";

const SPOTIFY = "https://open.spotify.com/track/2jwRKUOBoN1hiMFuuKdIJE";
const opts = { currency: "EUR", statsLimit: 15 };

beforeAll(() => {
  installDemo();
  process.env.DISCOGS_TOKEN = "demo";
});

test("Discogs markup is cleaned", () => {
  expect(cleanDiscogsMarkup("Worked with [a=Larry Heard (2)] on [l=Trax Records]. See [url=https://x.y]this[/url], [b]bold[/b] [a12345]")).toBe(
    "Worked with Larry Heard on Trax Records. See this, bold",
  );
});

test("excerpt cuts at a sentence", () => {
  const long = "First sentence here. " + "Second sentence goes on and on ".repeat(20);
  expect(excerpt(long, 60)).toBe("First sentence here.");
  expect(excerpt("short", 60)).toBe("short");
});

test("moniker sentence", () => {
  expect(monikerSentence({ name: "Mr. Fingers", realName: "Larry Heard", aliases: ["Larry Heard", "Gherkin Jerks", "Loosefingers"], groups: [], recordCount: 1 })).toBe(
    "Mr. Fingers is a moniker of Larry Heard, who also records as Gherkin Jerks and Loosefingers. This is the only record released under the name Mr. Fingers.",
  );
  expect(monikerSentence({ name: "X", aliases: ["Y"], groups: ["Z Band"], recordCount: 3 })).toBe("X also records as Y. Member of Z Band. One of only 3 records released as X.");
  expect(monikerSentence({ name: "X", realName: "X", aliases: [], groups: [], recordCount: 40 })).toBeUndefined();
});

test("About: artist, bio and release notes from Discogs; no extra search when represses exist", async () => {
  const r = await run(SPOTIFY, opts);
  expect(r.about?.moniker).toBe(
    "Mr. Fingers is a moniker of Demo Realname, who also records as Demo Alias and Other Alias. One of only 2 records released as Mr. Fingers.",
  );
  expect(r.about?.bio).toEqual({ text: "Demo profile: Chicago house producer. Worked with Demo Vocalist and released on Trax Records.", source: "Discogs", url: "https://www.discogs.com/artist/9500001" });
  expect(r.about?.releaseNotes).toBe("Demo notes: recorded at home on a Roland TR-707. Pressing info on the B-side label.");
  expect(r.about?.repressSearched).toBeUndefined();
});

test("About: no repress on Discogs -> extra search lists other records with the track", async () => {
  const r = await run(SPOTIFY, { ...opts, releaseId: 9300001 });
  expect(r.about?.repressSearched).toBe(true);
  expect(r.about?.otherReleases?.map((o) => [o.title, o.year])).toEqual([
    ["Chicago Jacks", 1988],
    ["Can You Feel It", 1986],
  ]);
});
