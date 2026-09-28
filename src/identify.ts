import * as discogs from "./discogs.ts";
import type { FlatRelease, SearchParams } from "./discogs.ts";
import { discogsFromBarcode, discogsFromIsrc } from "./musicbrainz.ts";
import { baseTitle, catnoKey, similarity, splitArtists } from "./text.ts";
import type { Candidate, DiscogsRef, IdentifyPath, Resolved } from "./types.ts";

/** Styles that make a non-"Electronic" release still count as electronic-adjacent. */
const ELECTRONIC_STYLES = new Set(
  [
    "Disco", "Boogie", "Italo-Disco", "Euro-Disco", "Hi NRG", "Dub", "Downtempo", "Leftfield", "Ambient",
    "Electro", "Breaks", "Breakbeat", "Drum n Bass", "Jungle", "Garage House", "UK Garage", "Balearic",
    "Synth-pop", "Dub Techno", "Acid", "Acid House", "Deep House", "House", "Techno", "Minimal",
    "Trip Hop", "Broken Beat", "Nu-Disco", "Dancehall", "Freestyle", "Electro-Funk", "Cosmic", "Experimental",
  ].map((s) => s.toLowerCase()),
);

export interface IdentifyOutput {
  path?: IdentifyPath;
  tried: { path: IdentifyPath; outcome: string }[];
  candidates: Candidate[];
  details: Map<number, FlatRelease>;
}

export async function identify(r: Resolved, currency: string): Promise<IdentifyOutput> {
  const tried: IdentifyOutput["tried"] = [];
  const details = new Map<number, FlatRelease>();

  const fetchRelease = async (id: number) => {
    if (details.has(id)) return details.get(id);
    const d = await discogs.release(id, currency);
    if (!d) return;
    const flat = discogs.flattenRelease(d);
    details.set(id, flat);
    return flat;
  };
  const fromRefs = async (refs: DiscogsRef[], path: IdentifyPath): Promise<Candidate[]> => {
    const out: Candidate[] = [];
    for (const ref of refs.slice(0, 3)) {
      let id = ref.id;
      if (ref.type === "master") {
        const m = await discogs.master(ref.id);
        if (!m?.main_release) continue;
        id = m.main_release;
      }
      const flat = await fetchRelease(id);
      if (flat) out.push(toCandidate(flat, r, path));
    }
    return out.sort((a, b) => b.score - a.score);
  };

  // a. Discogs URL right there in the YouTube description.
  if (r.discogsLinks.length) {
    const c = await fromRefs(r.discogsLinks, "youtube-description");
    const best = c[0];
    if (best && best.score >= 40) {
      tried.push({ path: "youtube-description", outcome: `hit: ${r.discogsLinks.length} link(s), best score ${best.score}` });
      return { path: "youtube-description", tried, candidates: c.slice(0, 3), details };
    }
    tried.push({ path: "youtube-description", outcome: best ? `links found but don't match the track (best score ${best.score})` : "links found but lookup failed" });
  } else if (r.platform === "youtube") {
    tried.push({ path: "youtube-description", outcome: r.description === undefined ? "skipped: no description (set YOUTUBE_API_KEY)" : "no Discogs link in description" });
  }

  // b. ISRC (or UPC) -> MusicBrainz -> Discogs URL relation.
  const mbPath: IdentifyPath | undefined = r.isrc ? "musicbrainz-isrc" : r.upc ? "musicbrainz-barcode" : undefined;
  if (mbPath) {
    const mb = r.isrc ? await discogsFromIsrc(r.isrc) : await discogsFromBarcode(r.upc!);
    if (mb.discogs.length) {
      const c = await fromRefs(mb.discogs, mbPath);
      const best = c[0];
      if (best && best.score >= 45) {
        tried.push({ path: mbPath, outcome: `hit via ${mb.calls} MB request(s) -> Discogs ${mb.discogs[0].type} ${mb.discogs[0].id}` });
        const isVinyl = best.formats.includes("Vinyl");
        const isComp = isCompilation(best);
        if ((isVinyl || best.masterId) && !isComp) return { path: mbPath, tried, candidates: c.slice(0, 3), details };
        // ISRCs identify recordings, not records: the MB-linked release may be a compilation or a
        // digital-only release. Keep it, but also search Discogs for the original single/EP.
        const s = await searchPath(r, fetchRelease, tried);
        const merged = dedupe([...c, ...s].sort((a, b) => b.score - a.score)).slice(0, 3);
        const path = merged[0] && merged[0].path === "discogs-search" ? "discogs-search" : mbPath;
        return { path, tried, candidates: merged, details };
      }
      tried.push({ path: mbPath, outcome: `Discogs link found but it doesn't match (score ${best?.score ?? "n/a"})` });
    } else {
      tried.push({ path: mbPath, outcome: mb.error ?? `no Discogs relation on ${mb.mbReleases} MB release(s) (${mb.calls} requests)` });
    }
  } else {
    tried.push({ path: "musicbrainz-isrc", outcome: "skipped: no ISRC" });
  }

  // c. Discogs database search.
  const c = await searchPath(r, fetchRelease, tried);
  return { path: c.length ? "discogs-search" : undefined, tried, candidates: c.slice(0, 3), details };
}

async function searchPath(r: Resolved, fetchRelease: (id: number) => Promise<FlatRelease | undefined>, tried: IdentifyOutput["tried"]): Promise<Candidate[]> {
  if (!discogs.hasToken()) {
    tried.push({ path: "discogs-search", outcome: "skipped: DISCOGS_TOKEN not set" });
    return [];
  }
  const artist = r.artists[0] ?? r.artist;
  const title = baseTitle(r.title);
  const queries: SearchParams[] = [];
  for (const catno of r.catnoHints.slice(0, 2)) queries.push({ catno });
  if (artist && title) {
    if (r.kind === "album") {
      queries.push({ artist, release_title: title, format: "Vinyl" }, { artist, release_title: title });
    } else {
      queries.push({ artist, track: title, format: "Vinyl" }, { artist, track: title }, { artist, release_title: title });
    }
    queries.push({ q: `${artist} ${title}` });
  } else if (title) {
    queries.push({ track: title, format: "Vinyl" }, { q: title });
  }
  if (!queries.length) {
    tried.push({ path: "discogs-search", outcome: "skipped: nothing to search for" });
    return [];
  }

  const pool = new Map<number, FlatRelease>();
  const log: string[] = [];
  for (const q of queries) {
    const { results, error } = await discogs.search(q);
    const label = Object.entries(q).map(([k, v]) => `${k}=${v}`).join("&");
    log.push(`${label} -> ${error ?? results.length}`);
    for (const res of results) if (res.type === "release" && !pool.has(res.id)) pool.set(res.id, discogs.flattenSearchResult(res));
    // Stop once a query produced something plausible for this artist (or any hit when we have no artist).
    const plausible = results.some((res) => !artist || artistSim(r, discogs.flattenSearchResult(res).artist) >= 0.7);
    if (plausible && !q.catno) break;
  }
  if (!pool.size) {
    tried.push({ path: "discogs-search", outcome: `no results (${log.join("; ")})` });
    return [];
  }

  // Pre-score from search data, keep the best release per master, then verify top groups with full details.
  const prelim = [...pool.values()].map((f) => toCandidate(f, r, "discogs-search"));
  const perGroup = new Map<string, Candidate>();
  for (const c of prelim.sort((a, b) => b.score - a.score || (a.year ?? 9999) - (b.year ?? 9999))) {
    const key = c.masterId ? `m${c.masterId}` : `r${c.releaseId}`;
    if (!perGroup.has(key)) perGroup.set(key, c);
  }
  const top = [...perGroup.values()].slice(0, 5);
  const verified: Candidate[] = [];
  for (const c of top) {
    const flat = await fetchRelease(c.releaseId);
    verified.push(flat ? toCandidate(flat, r, "discogs-search") : c);
  }
  verified.sort((a, b) => b.score - a.score);
  tried.push({ path: "discogs-search", outcome: `${pool.size} results, ${perGroup.size} distinct masters (${log.join("; ")})` });
  return verified;
}

function isCompilation(f: { formats: string[]; artist: string }) {
  return f.formats.includes("Compilation") || /^various$/i.test(f.artist.trim());
}

function dedupe(cs: Candidate[]) {
  const seen = new Set<string>();
  return cs.filter((c) => {
    const k = c.masterId ? `m${c.masterId}` : `r${c.releaseId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function artistSim(r: Resolved, discogsArtist: string | undefined): number {
  if (!discogsArtist) return 0;
  const theirs = [discogsArtist, ...splitArtists(discogsArtist)];
  const ours = r.artists.length ? r.artists : r.artist ? [r.artist] : [];
  let best = 0;
  for (const a of ours) for (const b of theirs) best = Math.max(best, similarity(a, b));
  return best;
}

/** Score a Discogs release against what we resolved. Pure: exported for tests. */
export function toCandidate(f: FlatRelease, r: Resolved, path: IdentifyPath): Candidate {
  const reasons: string[] = [];
  let score = 0;
  const title = baseTitle(r.title);

  // Title: prefer confirming the track in the tracklist.
  let matchedTrack: string | undefined;
  let trackArtists: string | undefined;
  if (f.tracklist?.length && title && r.kind !== "album") {
    let best = 0;
    for (const t of f.tracklist) {
      const s = similarity(title, baseTitle(t.title));
      if (s > best) {
        best = s;
        matchedTrack = `${t.position} ${t.title}`;
        trackArtists = t.artists;
      }
    }
    if (best >= 0.85) {
      score += 30;
      reasons.push(`track in tracklist (${matchedTrack})`);
    } else if (best >= 0.6) {
      score += Math.round(30 * best * 0.8);
      reasons.push(`similar track in tracklist (${matchedTrack}, ${best.toFixed(2)})`);
    } else {
      matchedTrack = undefined;
      reasons.push("track NOT in tracklist");
    }
  } else if (title) {
    const s = Math.max(similarity(title, f.title), r.album ? similarity(r.album, f.title) : 0);
    if (s >= 0.85) {
      score += 22;
      reasons.push("release title matches");
    } else {
      score += Math.round(15 * s);
    }
  }

  // Artist (release artist, or the matched track's artist on compilations).
  const as = Math.max(artistSim(r, f.artist), trackArtists ? artistSim(r, trackArtists) : 0);
  if (as >= 0.9) {
    score += 35;
    reasons.push("artist matches");
  } else if (as >= 0.5) {
    score += Math.round(35 * as * 0.8);
    reasons.push(`artist similar (${as.toFixed(2)})`);
  } else {
    reasons.push(`artist mismatch ("${f.artist}")`);
  }

  if (f.formats.includes("Vinyl")) {
    score += 10;
    reasons.push("vinyl");
  }
  if (f.genres.includes("Electronic")) {
    score += 8;
    reasons.push("electronic");
  } else if (f.styles.some((s) => ELECTRONIC_STYLES.has(s.toLowerCase()))) {
    score += 6;
    reasons.push("electronic-adjacent style");
  }
  const hinted = new Set(r.catnoHints.map(catnoKey));
  if (hinted.size && f.allCatnos.some((c) => hinted.has(catnoKey(c)))) {
    score += 20;
    reasons.push("catalog number matches");
  }
  if (r.label && f.label && similarity(r.label, f.label) >= 0.8) {
    score += 7;
    reasons.push("label matches");
  }
  if (r.year && f.year && Math.abs(r.year - f.year) <= 1) {
    score += 5;
    reasons.push("year matches");
  }
  const comp = r.kind !== "album" && isCompilation(f);
  if (comp) {
    score -= 10;
    reasons.push("compilation (prefer the original record)");
  }
  // A MusicBrainz/description link confirms the recording; on a compilation that says little about the record.
  if (path !== "discogs-search" && !comp) {
    score += 15;
    reasons.push(`linked via ${path}`);
  }

  score = Math.min(100, score);
  const confidence = score >= 75 ? "high" : score >= 50 ? "medium" : "low";
  return {
    releaseId: f.id,
    masterId: f.masterId,
    artist: f.artist,
    title: f.title,
    label: f.label,
    catno: f.catno,
    year: f.year,
    country: f.country,
    formats: f.formats,
    genres: f.genres,
    styles: f.styles,
    thumb: f.thumb,
    url: discogs.webUrl.release(f.id),
    matchedTrack,
    score,
    confidence,
    path,
    reasons,
  };
}
