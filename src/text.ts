import type { DiscogsRef } from "./types.ts";

// ---- normalisation & fuzzy matching ------------------------------------------

/** Lowercase, strip accents/punctuation, unify "&"/"and", drop Discogs "(2)" and "*" artist suffixes. */
export function norm(s: string | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s\(\d+\)(?=$|\s|,)/g, " ") // Discogs artist disambiguation "Mark (2)"
    .replace(/\*/g, "")
    .replace(/&/g, " and ")
    .replace(/\bfeat(uring)?\.?\b|\bft\.?\b/g, " ")
    .replace(/[''`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^the\s+|\s+the$/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Same as norm() but also removes spaces, e.g. "P.R.D." -> "prd", "Rhythim Is Rhythim" -> "rhythimisrhythim". */
export function compact(s: string | undefined): string {
  return norm(s).replace(/ /g, "");
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice coefficient on character bigrams of the compacted strings (0..1). */
export function dice(a: string, b: string): number {
  const x = compact(a);
  const y = compact(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const bx = bigrams(x);
  const by = bigrams(y);
  let overlap = 0;
  for (const [g, n] of bx) overlap += Math.min(n, by.get(g) ?? 0);
  return (2 * overlap) / (x.length - 1 + (y.length - 1));
}

/** Fraction of the shorter string's tokens found in the longer one (0..1). */
export function tokenContainment(a: string, b: string): number {
  const ta = new Set(norm(a).split(" ").filter(Boolean));
  const tb = new Set(norm(b).split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let hit = 0;
  for (const t of small) if (big.has(t)) hit++;
  return hit / small.size;
}

/** Combined similarity: tolerant of word order, extra words and punctuation. */
export function similarity(a: string | undefined, b: string | undefined): number {
  if (!a || !b) return 0;
  const d = dice(a, b);
  const tc = tokenContainment(a, b);
  // Containment alone over-rewards one-word titles contained in long ones; damp it.
  const lenA = norm(a).split(" ").length;
  const lenB = norm(b).split(" ").length;
  const ratio = Math.min(lenA, lenB) / Math.max(lenA, lenB);
  return Math.max(d, tc * (0.6 + 0.3 * ratio));
}

/** Split a multi-artist credit ("A, B & C", "A x B", "A feat. B", "A vs. B") into names. */
export function splitArtists(s: string | undefined): string[] {
  if (!s) return [];
  return s
    .split(/\s*(?:,|&|\+|\bx\b|\bvs\.?|\bfeat\.?|\bfeaturing\b|\bft\.?|\band\b|\bwith\b|\/)\s*/i)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

// ---- title parsing (YouTube-style "Artist - Title (Mix) [Label]") -------------

const NOISE_PAREN = /^(official( music| lyric)?( video| audio| visuali[sz]er)?|official|audio|video|music video|lyric video|lyrics|visuali[sz]er|hd|hq|4k|full ep|full album|premiere|free download|out now|vinyl( rip)?|vinyl only|clip officiel|video oficial|explicit|remastered( \d{4})?|\d{4} remaster(ed)?|\d{4})$/i;
const MIX_WORDS = /\b(mix|remix|version|edit|dub|vocal|instrumental|rework|re-?edit|extended|club|original|radio|acapella|a cappella|reprise|remaster(ed)?|live)\b/i;
const PREFIX_NOISE = /^\s*(premiere|exclusive|free dl|free download|new|out now|debut)\s*[:|\-–—]\s*/i;
const TRAILING_NOISE = /\s*[|•]\s*.*$/; // "Artist - Title | Label 2021"

export interface ParsedTitle {
  artist?: string;
  title?: string;
  mix?: string;
  label?: string;
  year?: number;
  catnoHints: string[];
  /** "(Raw Grooves EP)"-style groups: the record the track is on. */
  album?: string;
  /** Words after the last bracket that were ignored ("Rare Italo Disco 1984"). */
  extra?: string;
}

/**
 * Parse a YouTube-style video title. Handles:
 *   Artist - Title (Mix) [Label]
 *   Artist – 'Title' (Official Audio)
 *   PREMIERE: Artist - Title [LABEL001]
 *   Artist - Title (Label | 1987)
 *   A1. Artist - Title
 */
export function parseVideoTitle(raw: string): ParsedTitle {
  const out: ParsedTitle = { catnoHints: [] };
  let s = raw.replace(/\s+/g, " ").trim();
  s = s.replace(PREFIX_NOISE, "");
  s = s.replace(/^[A-D]\d{1,2}[.)]?\s+(?=\S)/, ""); // vinyl side prefix "A1. "

  // Pull every (...) and [...] group out, leaving a marker so we know where they were.
  const groups: string[] = [];
  s = s.replace(/[([]([^)\]]*)[)\]]/g, (_m, inner: string) => {
    groups.push(inner.trim());
    return " \u0000 ";
  });
  // Words after the last bracket group are usually uploader noise ("Rare Italo Disco 1984").
  const lastMarker = s.lastIndexOf("\u0000");
  if (lastMarker >= 0) {
    const tail = s.slice(lastMarker + 1).trim();
    if (tail && !/\s[-–—]\s/.test(tail)) {
      out.extra = tail;
      s = s.slice(0, lastMarker + 1);
    }
  }
  s = s.replace(/\u0000/g, " ").replace(TRAILING_NOISE, "").replace(/\s+/g, " ").trim();

  for (const g of groups) classifyGroup(g, out);

  const sep = s.match(/\s+[-–—~]{1,2}\s+|\s*[–—]\s*/);
  if (sep && sep.index !== undefined && sep.index > 0) {
    out.artist = stripQuotes(s.slice(0, sep.index).trim());
    out.title = stripQuotes(s.slice(sep.index + sep[0].length).trim());
  } else {
    out.title = stripQuotes(s);
  }
  if (!out.title) out.title = undefined;
  if (!out.artist) out.artist = undefined;
  return out;
}

function classifyGroup(g: string, out: ParsedTitle) {
  if (!g) return;
  if (NOISE_PAREN.test(g)) {
    const y = g.match(/(19[5-9]\d|20[0-4]\d)/);
    if (y && /^\d{4}$/.test(g)) out.year = Number(y[1]);
    return;
  }
  // "(Transmat | 1987)", "[Label - CAT001]", "[LABEL001]"
  const rest: string[] = [];
  for (const p of g.split(/\s*[|/•]\s*|\s+[-–—]\s+/).filter(Boolean)) {
    if (/^(19[5-9]\d|20[0-4]\d)$/.test(p)) {
      out.year = Number(p);
    } else if (isWholeCatno(p)) {
      out.catnoHints.push(p.toUpperCase());
    } else {
      rest.push(p);
    }
  }
  if (!rest.length) return;
  const text = rest.join(" ");
  if (MIX_WORDS.test(text)) {
    out.mix ??= text;
  } else if (isFormatOrGenreNoise(text)) {
    return;
  } else if (/\b(EP|LP|album|12"|12''|7"|7'')$/i.test(text)) {
    out.album ??= text;
  } else {
    out.label ??= text;
  }
}

/** Words uploaders put in brackets that are neither label nor mix: formats, genres, "rare". */
const NOISE_TOKENS = new Set(
  ("vinyl maxi single 12 12inch 7 7inch 10 lp ep rip promo white label rare hq hd 320 flac wav bpm rpm 33 45 " +
    "italo euro disco house techno electro acid ambient breaks breakbeat dnb drum bass jungle boogie funk soul synth " +
    "pop wave new dance electronic deep minimal detroit chicago garage balearic cosmic afro dub downtempo leftfield " +
    "hi nrg edm trance hardcore rave idm experimental").split(" "),
);
function isFormatOrGenreNoise(text: string) {
  const tokens = norm(text).split(" ").filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => NOISE_TOKENS.has(t) || /^(19|20)\d\d$/.test(t));
}

function isWholeCatno(p: string) {
  const c = extractCatnos(p, { strict: true });
  return c.length === 1 && c[0] === p.trim().toUpperCase() && /\d/.test(p) && /[A-Za-z]/.test(p);
}

function stripQuotes(s: string | undefined) {
  if (!s) return s;
  return s.replace(/^["'‘’“”]+|["'‘’“”]+$/g, "").trim();
}

/** Strip mix/version decorations from a streaming title: "Track (Original Mix)" -> "Track". */
export function baseTitle(t: string | undefined): string | undefined {
  if (!t) return t;
  const stripped = t
    .replace(/\s*[([][^)\]]*[)\]]\s*/g, " ")
    .replace(/\s+-\s+(.*\b(mix|remix|version|edit|remaster(ed)?|dub|vocal|instrumental)\b.*)$/i, "")
    .trim();
  return stripped || t;
}

// ---- catalog numbers ---------------------------------------------------------

const CATNO_STOPWORDS = new Set(["MP3", "HD", "HQ", "4K", "EP", "LP", "UK", "US", "EU", "DJ", "CD", "BPM", "FLAC", "WAV", "AIFF", "VOL", "NO", "PT", "PART", "OP", "RPM", "MP", "KBPS", "TRACK", "SIDE"]);

/**
 * Find catalog-number-like tokens: "TX117", "TL 004", "MS-1", "WARPLP123", "RS 9306".
 * strict: whole-token letters+digits only (for titles). Non-strict also accepts text
 * after "Cat#:", "Catalog:", "Cat. No." labels in descriptions.
 */
export function extractCatnos(text: string, opts: { strict?: boolean } = {}): string[] {
  const found = new Set<string>();
  if (!opts.strict) {
    for (const m of text.matchAll(/\b(?:cat(?:alog(?:ue)?)?\.?\s*(?:#|no\.?|number)?|catno)\s*[:#]?\s*([A-Z0-9][A-Z0-9 .\-/]{1,18}[A-Z0-9])/gi)) {
      found.add(m[1].trim().toUpperCase());
    }
  }
  for (const m of text.matchAll(/\b([A-Za-z]{1,8})[ -]?(\d{1,5})([A-Za-z]{0,2})\b/g)) {
    const letters = m[1].toUpperCase();
    if (CATNO_STOPWORDS.has(letters)) continue;
    if (/^(19|20)\d\d$/.test(m[2]) && m[0].includes(" ")) continue; // "Italo 1984"
    if (m[1] !== letters && m[1].length > 2) continue; // "Track1" style words; catnos are usually upper-case
    if (letters.length === 1 && m[2].length < 2) continue;
    found.add(m[0].toUpperCase());
  }
  return [...found];
}

/** Normalise catnos for comparison: "TX-117", "tx 117" and "TX117" are equal. */
export function catnoKey(c: string | undefined): string {
  return (c ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/([A-Z])0+(\d)/g, "$1$2");
}

// ---- links in descriptions ---------------------------------------------------

/** discogs.com/release/123-Artist-Title, discogs.com/Artist-Title/master/456, discogs.com/de/release/789 */
export function extractDiscogsLinks(text: string): DiscogsRef[] {
  const out: DiscogsRef[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/discogs\.com\/(?:[a-z]{2}\/)?(?:[^\s/]+\/)?(release|master)\/(\d+)/gi)) {
    const key = `${m[1].toLowerCase()}:${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: m[1].toLowerCase() as "release" | "master", id: Number(m[2]) });
  }
  return out;
}

/**
 * YouTube "Topic"/Art Track auto-descriptions:
 *   Provided to YouTube by Label
 *
 *   Title · Artist · Artist2
 *
 *   Album
 *
 *   ℗ 1987 Label
 *
 *   Released on: 1987-05-01
 */
export function parseAutoDescription(desc: string): { title?: string; artists?: string[]; album?: string; label?: string; year?: number } | undefined {
  if (!/Provided to YouTube by/i.test(desc)) return;
  const lines = desc.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: { title?: string; artists?: string[]; album?: string; label?: string; year?: number } = {};
  const provided = lines.findIndex((l) => /^Provided to YouTube by/i.test(l));
  out.label = lines[provided]?.replace(/^Provided to YouTube by\s*/i, "").trim() || undefined;
  const credit = lines[provided + 1];
  if (credit?.includes("·")) {
    const [t, ...as] = credit.split("·").map((x) => x.trim());
    out.title = t;
    out.artists = as;
  }
  const album = lines[provided + 2];
  if (album && !/^[℗©]|^Released on|^Auto-generated/i.test(album)) out.album = album;
  const released = desc.match(/Released on:\s*(\d{4})/i);
  const p = desc.match(/℗\s*(\d{4})/);
  out.year = released ? Number(released[1]) : p ? Number(p[1]) : undefined;
  return out;
}
