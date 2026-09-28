import { get } from "./http.ts";
import type { DiscogsRef } from "./types.ts";
import { extractDiscogsLinks } from "./text.ts";

const MB = "https://musicbrainz.org/ws/2";
const opts = { bucket: "musicbrainz", maxRetryWaitMs: 3_000 };

export interface MbLookup {
  discogs: DiscogsRef[];
  mbReleases: number;
  calls: number;
  error?: string;
}

/**
 * ISRC -> MusicBrainz recordings -> releases -> Discogs URL relations.
 * Tries release-level links first (-> Discogs release), then release-group links (-> Discogs master).
 * Stops as soon as something is found; capped at ~8 requests (MB allows 1 req/s).
 */
export async function discogsFromIsrc(isrc: string): Promise<MbLookup> {
  const res = await get(`${MB}/isrc/${encodeURIComponent(isrc)}?inc=releases&fmt=json`, opts);
  if (!res.ok) return { discogs: [], mbReleases: 0, calls: 1, error: res.status === 404 ? "ISRC not in MusicBrainz" : `HTTP ${res.status || res.error}` };
  const releases: any[] = [];
  for (const rec of res.data?.recordings ?? []) releases.push(...(rec.releases ?? []));
  return discogsFromMbReleases(releases, 1);
}

/** UPC/EAN barcode -> MusicBrainz releases -> Discogs. */
export async function discogsFromBarcode(barcode: string): Promise<MbLookup> {
  const res = await get(`${MB}/release?query=barcode:${encodeURIComponent(barcode)}&fmt=json`, opts);
  if (!res.ok) return { discogs: [], mbReleases: 0, calls: 1, error: `HTTP ${res.status || res.error}` };
  const releases = (res.data?.releases ?? []).filter((r: any) => (r.score ?? 100) >= 90);
  return discogsFromMbReleases(releases, 1);
}

async function discogsFromMbReleases(releases: any[], calls: number): Promise<MbLookup> {
  // Official releases first, then oldest first (the original is the most likely to be linked).
  const uniq = [...new Map(releases.map((r) => [r.id, r])).values()].sort(
    (a, b) => Number(b.status === "Official") - Number(a.status === "Official") || String(a.date ?? "9999").localeCompare(String(b.date ?? "9999")),
  );
  const found: DiscogsRef[] = [];
  const groups: string[] = [];
  for (const rel of uniq.slice(0, 5)) {
    const r = await get(`${MB}/release/${rel.id}?inc=url-rels+release-groups&fmt=json`, opts);
    calls++;
    if (!r.ok) continue;
    for (const rr of r.data?.relations ?? []) {
      if (rr.type === "discogs" && rr.url?.resource) found.push(...extractDiscogsLinks(rr.url.resource));
    }
    const rg = r.data?.["release-group"]?.id;
    if (rg && !groups.includes(rg)) groups.push(rg);
    if (found.length) break;
  }
  if (!found.length) {
    for (const rg of groups.slice(0, 3)) {
      const r = await get(`${MB}/release-group/${rg}?inc=url-rels&fmt=json`, opts);
      calls++;
      if (!r.ok) continue;
      for (const rr of r.data?.relations ?? []) {
        if (rr.type === "discogs" && rr.url?.resource) found.push(...extractDiscogsLinks(rr.url.resource));
      }
      if (found.length) break;
    }
  }
  return { discogs: found, mbReleases: uniq.length, calls };
}
