import * as discogs from "./discogs.ts";
import type { FlatRelease } from "./discogs.ts";
import { get } from "./http.ts";
import { baseTitle, norm } from "./text.ts";
import type { About, Candidate, Expanded, OtherRelease } from "./types.ts";

const MUSIC_WORDS = /\b(dj|disc jockey|musician|producer|record(ing)? artist|records|band|singer|composer|duo|trio|group|electronic|house|techno|disco)\b/i;
const VARIOUS_ARTIST_ID = 194;

/** Discogs profile markup -> plain text: [a=Name] -> Name, [url=..]text[/url] -> text, [b] etc. dropped. */
export function cleanDiscogsMarkup(s: string | undefined): string {
  if (!s) return "";
  return s
    .replace(/\[(?:a|l|m|r|g)=([^\]]+)\]/gi, (_m, name: string) => name.replace(/\s\(\d+\)$/, ""))
    .replace(/\[(?:a|l|m|r|g)\d+\]/gi, "")
    .replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/gi, "$1")
    .replace(/\[\/?(?:b|i|u|s)\]/gi, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** First sentences up to `max` chars. */
export function excerpt(text: string, max = 420): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > max * 0.25 ?cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, "")}…`;
}

/** "Mr. Fingers is a moniker of Larry Heard, who also records as …" (pure; exported for tests). */
export function monikerSentence(a: { name: string; realName?: string; aliases: string[]; groups: string[]; recordCount?: number }): string | undefined {
  const parts: string[] = [];
  const real = a.realName && norm(a.realName) !== norm(a.name) ? a.realName : undefined;
  const others = a.aliases.filter((x) => norm(x) !== norm(a.name) && (!real || norm(x) !== norm(real)));
  if (real) {
    parts.push(`${a.name} is a moniker of ${real}${others.length ? `, who also records as ${list(others.slice(0, 4))}` : ""}.`);
  } else if (others.length) {
    parts.push(`${a.name} also records as ${list(others.slice(0, 4))}.`);
  }
  if (a.groups.length) parts.push(`Member of ${list(a.groups.slice(0, 3))}.`);
  if (a.recordCount === 1) parts.push(`This is the only record released under the name ${a.name}.`);
  else if (a.recordCount && a.recordCount <= 3) parts.push(`One of only ${a.recordCount} records released as ${a.name}.`);
  return parts.length ? parts.join(" ") : undefined;
}

function list(xs: string[]) {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
}

const stripDisambig = (s: string) => s.replace(/\s\(\d+\)$/, "");

async function wikipedia(names: string[]): Promise<About["bio"]> {
  const tried = new Set<string>();
  for (const n of names) {
    for (const title of [n, `${n} (musician)`, `${n} (DJ)`]) {
      if (tried.has(title)) continue;
      tried.add(title);
      const r = await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`, { bucket: "wikipedia", timeoutMs: 8_000 });
      const d = r.ok ? r.data : undefined;
      if (!d || d.type === "disambiguation" || !d.extract) continue;
      if (!MUSIC_WORDS.test(d.extract)) continue; // another person/thing with the same name
      return { text: excerpt(d.extract), source: "Wikipedia", url: d.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}` };
    }
  }
  return undefined;
}

/**
 * The About box: who the artist is (real name, other monikers, how many records under this name),
 * a short bio (Discogs profile, else Wikipedia), the release notes, and, when Discogs shows no
 * repress of this record, an extra search for other records carrying the same track.
 */
export async function aboutRelease(c: Candidate, e: Expanded | undefined, details: Map<number, FlatRelease>): Promise<About> {
  const out: About = {};
  const flat = details.get(c.releaseId);

  const notes = cleanDiscogsMarkup(flat?.notes);
  if (notes) out.releaseNotes = excerpt(notes, 360);

  const ref = flat?.artistRefs?.find((a) => a.id !== VARIOUS_ARTIST_ID);
  if (ref) {
    const a = await discogs.artist(ref.id);
    if (a) {
      const name = stripDisambig(a.name ?? ref.name);
      const rel = await discogs.artistReleases(ref.id);
      // Records as main artist: Discogs lists a record with several pressings once, as its master.
      const records = rel ? new Set(rel.releases.filter((x) => !x.role || x.role === "Main").map((x) => `${x.type}:${x.id}`)) : undefined;
      out.artist = {
        name,
        url: discogs.webUrl.artist(ref.id),
        realName: a.realname || undefined,
        aliases: ((a.aliases ?? []) as any[]).map((x) => stripDisambig(x.name)),
        groups: ((a.groups ?? []) as any[]).map((x) => stripDisambig(x.name)),
        recordCount: records && rel && rel.total <= 100 ? records.size : undefined,
      };
      out.moniker = monikerSentence(out.artist);
      const profile = cleanDiscogsMarkup(a.profile);
      if (profile) out.bio = { text: excerpt(profile), source: "Discogs", url: out.artist.url };
    }
  }
  if (!out.bio) {
    const names = [out.artist?.name ?? stripDisambig(c.artist), out.artist?.realName].filter((x): x is string => !!x);
    out.bio = await wikipedia(names);
  }

  // No official later pressing on Discogs: look for the track on other records (represses filed
  // under another master, reissues on other labels, compilations).
  const laterOfficial = (e?.versions ?? []).filter((v) => !v.isOriginal && !/unofficial/i.test(v.format ?? ""));
  if (!laterOfficial.length) {
    const track = c.matchedTrack ? baseTitle(c.matchedTrack.replace(/^\S+\s+/, "")) : baseTitle(c.title);
    const artistName = out.artist?.name ?? stripDisambig(c.artist);
    const queries = [{ artist: artistName, track }, ...(c.catno && !/^none$/i.test(c.catno) ? [{ catno: c.catno }] : [])];
    const seen = new Set<number>();
    const found: OtherRelease[] = [];
    for (const q of queries) {
      const { results } = await discogs.search({ ...q, type: "release" });
      for (const r of results) {
        if (r.id === c.releaseId || seen.has(r.id) || (c.masterId && r.master_id === c.masterId)) continue;
        seen.add(r.id);
        const f = discogs.flattenSearchResult(r);
        found.push({
          artist: f.artist,
          title: f.title,
          label: f.label,
          catno: f.catno,
          year: f.year,
          format: f.formats.filter((x) => x !== "Vinyl").slice(0, 2).join(", ") || f.formats[0],
          url: discogs.webUrl.release(f.id),
          unofficial: f.formats.some((x) => /unofficial/i.test(x)),
        });
      }
    }
    out.otherReleases = found.sort((a, b) => (b.year ?? 0) - (a.year ?? 0)).slice(0, 5);
    out.repressSearched = true;
  }
  return out;
}
