import * as discogs from "./discogs.ts";
import type { FlatRelease } from "./discogs.ts";
import type { Candidate, Expanded, VersionRow } from "./types.ts";

const REISSUE_RE = /\b(reissue|repress|re|rp|remastered|unofficial release)\b/i;

function isVinylVersion(v: any) {
  return (v.major_formats ?? []).includes("Vinyl") || /vinyl|\blp\b|12"|10"|7"/i.test(v.format ?? "");
}

function yearOf(released: unknown): number | undefined {
  const m = String(released ?? "").match(/^(\d{4})/);
  const y = m ? Number(m[1]) : undefined;
  return y && y > 1900 ? y : undefined;
}

export interface ExpandOpts {
  currency: string;
  /** Max number of marketplace/stats calls (one per version; Discogs allows ~60/min). */
  statsLimit: number;
  now?: Date;
}

export async function expand(c: Candidate, details: Map<number, FlatRelease>, opts: ExpandOpts): Promise<Expanded> {
  const thisYear = (opts.now ?? new Date()).getFullYear();
  let flat = details.get(c.releaseId);
  if (!flat) {
    const d = await discogs.release(c.releaseId, opts.currency);
    if (d) flat = discogs.flattenRelease(d);
  }
  const tracklist = flat?.tracklist ?? [];

  let versions: VersionRow[] = [];
  let versionCount = 0;
  let masterInfo: Expanded["master"];

  if (c.masterId) {
    const m = await discogs.master(c.masterId);
    const { versions: raw, total } = await discogs.masterVersions(c.masterId);
    const vinyl = raw.filter(isVinylVersion);
    versionCount = vinyl.length === raw.length ? total : vinyl.length;
    const years = vinyl.map((v) => yearOf(v.released)).filter((y): y is number => !!y);
    const originalYear = years.length ? Math.min(...years) : m?.year || undefined;
    versions = vinyl.map((v) => {
      const year = yearOf(v.released);
      const isOriginal = !!year && year === originalYear && !REISSUE_RE.test(v.format ?? "");
      const isReissue = !isOriginal && ((year !== undefined && originalYear !== undefined && year > originalYear) || REISSUE_RE.test(v.format ?? ""));
      return {
        releaseId: v.id,
        year,
        country: v.country || undefined,
        label: v.label || undefined,
        catno: v.catno || undefined,
        format: v.format || undefined,
        title: v.title || undefined,
        isOriginal,
        isReissue,
        isRecent: isReissue && !!year && year >= thisYear - 2,
        sellUrl: discogs.webUrl.sellRelease(v.id),
        url: discogs.webUrl.release(v.id),
      };
    });
    if (m) {
      masterInfo = {
        id: m.id,
        title: m.title,
        year: m.year || undefined,
        numForSale: m.num_for_sale,
        lowestPrice: typeof m.lowest_price === "number" ? { value: m.lowest_price, currency: opts.currency } : undefined,
        url: discogs.webUrl.master(m.id),
        marketplaceUrl: discogs.webUrl.sellMaster(m.id),
      };
    }
  }

  if (!versions.length && flat) {
    // No master (or the master has no vinyl versions): the identified release is the only version we know.
    const isVinyl = flat.formats.includes("Vinyl");
    versionCount = isVinyl ? 1 : 0;
    if (isVinyl) {
      versions = [
        {
          releaseId: flat.id,
          year: flat.year,
          country: flat.country,
          label: flat.label,
          catno: flat.catno,
          format: flat.formats.join(", "),
          title: flat.title,
          isOriginal: true,
          isReissue: false,
          isRecent: false,
          sellUrl: discogs.webUrl.sellRelease(flat.id),
          url: discogs.webUrl.release(flat.id),
        },
      ];
    }
  }

  // Marketplace stats: identified release, originals, then newest first (represses are what shops stock).
  const priority = [
    ...versions.filter((v) => v.releaseId === c.releaseId),
    ...versions.filter((v) => v.isOriginal),
    ...[...versions].sort((a, b) => (b.year ?? 0) - (a.year ?? 0)),
  ];
  const picked = [...new Set(priority)].slice(0, opts.statsLimit);
  for (const v of picked) {
    const s = await discogs.marketplaceStats(v.releaseId, opts.currency);
    if (!s) continue;
    v.numForSale = s.num_for_sale ?? 0;
    if (s.lowest_price) v.lowestPrice = { value: s.lowest_price.value, currency: s.lowest_price.currency };
  }

  return { release: c, tracklist, master: masterInfo, versions, versionCount };
}

/**
 * Which catalog number to search shops with: the newest vinyl pressing's catno
 * (a repress is what's in stock), falling back to the identified release's.
 */
export function shopCatno(e: Expanded | undefined, c: Candidate | undefined): string | undefined {
  const usable = (x?: string) => (x && !/^none$/i.test(x.trim()) ? x.trim() : undefined);
  const newest = [...(e?.versions ?? [])].filter((v) => usable(v.catno)).sort((a, b) => (b.year ?? 0) - (a.year ?? 0))[0];
  return usable(newest?.catno) ?? usable(c?.catno);
}
