import { get } from "./http.ts";
import { canonicalYouTube, parseLink } from "./links.ts";
import {
  baseTitle,
  extractCatnos,
  extractDiscogsLinks,
  parseAutoDescription,
  parseVideoTitle,
  similarity,
  splitArtists,
} from "./text.ts";
import type { Resolved } from "./types.ts";

const ODESLI = "https://api.song.link/v1-alpha.1/links";

/** Link -> artist/title/ISRC. Every step is optional; failures are recorded in `notes` and we fall through. */
export async function resolve(input: string): Promise<Resolved> {
  const link = parseLink(input);
  const r: Resolved = {
    input,
    platform: link.platform,
    kind: link.kind,
    artists: [],
    catnoHints: [],
    discogsLinks: [],
    sources: [],
    notes: [],
    platformLinks: {},
  };
  const odesliInput = link.platform === "youtube" && link.id ? canonicalYouTube(link.id) : input;

  // 1. Odesli: cross-platform matching (gives us a Deezer id -> ISRC).
  let deezer: { type: "track" | "album"; id: string } | undefined;
  if (link.platform === "deezer" && link.id && link.kind !== "unknown") {
    deezer = { type: link.kind as "track" | "album", id: link.id };
  } else {
    const od = await odesli(odesliInput);
    if (od.ok) {
      r.sources.push("odesli");
      const data = od.data;
      for (const [platform, v] of Object.entries<any>(data.linksByPlatform ?? {})) r.platformLinks[platform] = v.url;
      const dz = data.linksByPlatform?.deezer;
      const dzEntity = dz ? data.entitiesByUniqueId?.[dz.entityUniqueId] : undefined;
      const inputEntity = data.entitiesByUniqueId?.[data.entityUniqueId];
      if (dz?.entityUniqueId) {
        const [kind, id] = dz.entityUniqueId.split("::");
        deezer = { type: /ALBUM/.test(kind) ? "album" : "track", id };
      }
      if (link.platform !== "youtube") {
        const e = inputEntity ?? dzEntity;
        if (e) {
          r.artist = e.artistName;
          r.title = e.title;
          if (link.kind === "album") r.album = e.title;
        }
      } else if (dzEntity) {
        // Odesli matches YouTube videos by fuzzy title search. For vinyl rips that
        // often lands on the wrong track, so only trust it if it agrees with the title.
        const yt = await youtube(link.id!, r);
        const parsed = parseVideoTitle(yt?.title ?? inputEntity?.title ?? "");
        const agree = similarity(baseTitle(dzEntity.title), parsed.title) >= 0.6;
        if (!agree) {
          r.notes.push(`odesli matched YouTube video to "${dzEntity.artistName} - ${dzEntity.title}" on Deezer, which doesn't match the video title; ignored`);
          deezer = undefined;
        }
      }
    } else {
      r.notes.push(`odesli failed (${od.status || od.error}); falling back`);
    }
  }

  // 2. Deezer: ISRC, label, UPC, year.
  if (deezer?.type === "track") {
    const t = await get(`https://api.deezer.com/track/${deezer.id}`, { bucket: "deezer" });
    if (t.ok && !t.data?.error) {
      r.sources.push("deezer");
      const d = t.data;
      r.isrc = d.isrc || r.isrc;
      r.title = d.title_short || d.title || r.title;
      if (d.title_version) r.mix = d.title_version.replace(/^\(|\)$/g, "");
      const contributors: string[] = (d.contributors ?? []).filter((c: any) => !c.role || c.role === "Main").map((c: any) => c.name);
      r.artist = d.artist?.name || r.artist;
      r.artists = unique([r.artist, ...contributors]);
      r.year = d.release_date ? Number(d.release_date.slice(0, 4)) || undefined : undefined;
      if (d.album?.id) deezer = { type: "album", id: String(d.album.id) };
      r.album = d.album?.title;
    } else {
      r.notes.push(`deezer track lookup failed (${t.data?.error?.message ?? t.status})`);
    }
  }
  if (deezer?.type === "album") {
    const a = await get(`https://api.deezer.com/album/${deezer.id}`, { bucket: "deezer" });
    if (a.ok && !a.data?.error) {
      if (!r.sources.includes("deezer")) r.sources.push("deezer");
      const d = a.data;
      r.label = d.label || r.label;
      r.upc = d.upc || r.upc;
      r.album = d.title || r.album;
      r.year ??= d.release_date ? Number(d.release_date.slice(0, 4)) || undefined : undefined;
      if (r.kind === "album") {
        r.title ??= d.title;
        r.artist ??= d.artist?.name;
      }
    }
  }

  // 3. Apple Music fallback: iTunes Lookup (artist/title/album, no ISRC).
  if (link.platform === "apple" && (!r.artist || !r.title) && link.id) {
    const cc = link.country ? `&country=${link.country}` : "";
    const it = await get(`https://itunes.apple.com/lookup?id=${link.id}${cc}`, { bucket: "itunes" });
    const hit = it.ok ? it.data?.results?.[0] : undefined;
    if (hit) {
      r.sources.push("itunes-lookup");
      r.artist ??= hit.artistName;
      r.title ??= link.kind === "album" ? hit.collectionName : hit.trackName;
      r.album ??= hit.collectionName;
      r.year ??= hit.releaseDate ? Number(hit.releaseDate.slice(0, 4)) : undefined;
      const label = hit.copyright?.replace(/^[℗©]\s*\d{4}\s*/, "");
      if (label && !r.label) r.label = label;
    } else {
      r.notes.push(`itunes lookup failed (${it.status || it.error})`);
    }
  }

  // 4. YouTube: oEmbed title (+ description via Data API if a key is set).
  if (link.platform === "youtube" && link.id) {
    const yt = await youtube(link.id, r);
    if (yt) {
      r.rawTitle = yt.title;
      r.description = yt.description;
      const auto = yt.description ? parseAutoDescription(yt.description) : undefined;
      const parsed = parseVideoTitle(yt.title);
      if (auto?.title && auto.artists?.length) {
        // "Artist - Topic" art track: structured metadata from the label feed.
        r.sources.push("youtube-autodescription");
        r.title ??= auto.title;
        r.artist ??= auto.artists[0];
        r.artists = unique([...r.artists, ...auto.artists]);
        r.album ??= auto.album;
        r.label ??= auto.label;
        r.year ??= auto.year;
      } else if (!r.artist || !r.title) {
        const topic = yt.channel?.match(/^(.*) - Topic$/)?.[1];
        r.artist ??= parsed.artist ?? topic;
        r.title ??= parsed.title;
        r.sources.push("youtube-title-parse");
        if (!parsed.artist && !topic) r.notes.push(`could not split "${yt.title}" into artist/title`);
      }
      r.mix ??= parsed.mix;
      r.label ??= parsed.label;
      r.year ??= parsed.year;
      if (parsed.album) r.album ??= parsed.album;
      r.catnoHints.push(...parsed.catnoHints);
      if (yt.description) {
        r.discogsLinks = extractDiscogsLinks(yt.description);
        // Only confident-looking catnos: "Cat#: XYZ 001"-labelled ones or LETTERS+DIGITS
        // (skips track positions like "A1" and noise like "MP3 320").
        r.catnoHints.push(...extractCatnos(yt.description).filter((c) => /^[A-Z]{2,}[ -]?\d{2,}/.test(c)).slice(0, 3));
      }
    }
  }

  if (!r.artists.length) r.artists = unique(splitArtists(r.artist));
  if (r.artist && !r.artists.includes(r.artist)) r.artists.unshift(r.artist);
  r.catnoHints = unique(r.catnoHints);
  if (!r.artist && !r.title) r.notes.push("could not resolve artist/title from this link");
  return r;
}

async function odesli(url: string) {
  const key = process.env.ODESLI_KEY ? `&key=${process.env.ODESLI_KEY}` : "";
  return get(`${ODESLI}?url=${encodeURIComponent(url)}&userCountry=GB${key}`, {
    bucket: "odesli",
    timeoutMs: 12_000,
    maxRetryWaitMs: 10_000,
  });
}

type YtInfo = { title: string; channel?: string; description?: string };
/** Per-resolve memo so the Odesli check and the YouTube step share one lookup. */
const ytMemo = new WeakMap<Resolved, YtInfo | undefined>();

async function youtube(id: string, r: Resolved) {
  if (ytMemo.has(r)) return ytMemo.get(r);
  let out: YtInfo | undefined;
  const key = process.env.YOUTUBE_API_KEY;
  if (key) {
    const v = await get(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${id}&key=${key}`, { bucket: "youtube" });
    const sn = v.ok ? v.data?.items?.[0]?.snippet : undefined;
    if (sn) {
      out = { title: sn.title, channel: sn.channelTitle, description: sn.description };
      r.sources.push("youtube-data-api");
    } else {
      r.notes.push(`youtube data api failed (${v.status || v.error})`);
    }
  }
  if (!out) {
    const o = await get(`https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalYouTube(id))}&format=json`, { bucket: "youtube" });
    if (o.ok && o.data?.title) {
      out = { title: o.data.title, channel: o.data.author_name };
      r.sources.push("youtube-oembed");
      if (!key) r.notes.push("no YOUTUBE_API_KEY: video description not read");
    } else {
      r.notes.push(`youtube oembed failed (${o.status || o.error})`);
    }
  }
  ytMemo.set(r, out);
  return out;
}

function unique(xs: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (!x) continue;
    const k = x.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}
