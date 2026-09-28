import { callCounts, resetCounts } from "./http.ts";
import { resolve } from "./resolve.ts";
import { identify, toCandidate } from "./identify.ts";
import { expand, shopCatno } from "./expand.ts";
import { buildShopLinks } from "./shops.ts";
import { flattenRelease, release, webUrl } from "./discogs.ts";
import { baseTitle } from "./text.ts";
import type { Candidate, Result } from "./types.ts";

export interface RunOpts {
  currency: string;
  statsLimit: number;
  /** Expand this Discogs release instead of the top candidate ("Not this record?"). */
  releaseId?: number;
}

export async function run(input: string, opts: RunOpts): Promise<Result> {
  const t0 = Date.now();
  resetCounts();
  const resolved = await resolve(input);
  const id = await identify(resolved, opts.currency);
  let best: Candidate | undefined = id.candidates[0];
  if (opts.releaseId && opts.releaseId !== best?.releaseId) {
    let picked = id.candidates.find((c) => c.releaseId === opts.releaseId);
    if (!picked) {
      const d = await release(opts.releaseId, opts.currency);
      if (d) {
        const flat = flattenRelease(d);
        id.details.set(flat.id, flat);
        picked = toCandidate(flat, resolved, id.path ?? "discogs-search");
        id.candidates.push(picked);
      }
    }
    best = picked ?? best;
  }
  const expanded = best ? await expand(best, id.details, { currency: opts.currency, statsLimit: opts.statsLimit }) : undefined;

  const discogsLinks: { label: string; url: string }[] = [];
  if (expanded?.master) discogsLinks.push({ label: `All vinyl versions for sale (master ${expanded.master.id})`, url: expanded.master.marketplaceUrl });
  if (best) discogsLinks.push({ label: `Identified release ${best.releaseId} for sale`, url: webUrl.sellRelease(best.releaseId) });
  for (const v of expanded?.versions.filter((v) => v.isRecent) ?? []) {
    discogsLinks.push({ label: `Recent repress ${v.year} ${v.label ?? ""} ${v.catno ?? ""}`.replace(/\s+/g, " ").trim(), url: v.sellUrl });
  }

  const digital = buildShopLinks({ artist: resolved.artist ?? best?.artist, title: baseTitle(resolved.title) ?? best?.title }).filter((l) => l.kind === "digital");
  const vinyl = buildShopLinks({
    artist: best?.artist ?? resolved.artist,
    // Vinyl shops list the record (EP/LP title), not the track.
    title: best?.title ?? resolved.album ?? baseTitle(resolved.title),
    catno: shopCatno(expanded, best),
  }).filter((l) => l.kind === "vinyl");

  return {
    input,
    resolved,
    identify: { path: id.path, tried: id.tried, candidates: id.candidates, chosenReleaseId: best?.releaseId },
    expanded,
    whereToGet: { discogs: discogsLinks, digital, vinyl },
    httpCalls: { ...callCounts },
    elapsedMs: Date.now() - t0,
  };
}
