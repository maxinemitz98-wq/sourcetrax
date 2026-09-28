import { get, type HttpResult } from "./http.ts";

const API = "https://api.discogs.com";

function headers(): Record<string, string> {
  const token = process.env.DISCOGS_TOKEN;
  return token ? { Authorization: `Discogs token=${token}` } : {};
}

export function hasToken() {
  return Boolean(process.env.DISCOGS_TOKEN);
}

async function dget(path: string, params: Record<string, string | number | undefined> = {}): Promise<HttpResult> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const url = `${API}${path}${qs.size ? `?${qs}` : ""}`;
  // Discogs asks clients to back off on 429; one retry after up to 15 s.
  return get(url, { bucket: "discogs", headers: headers(), maxRetryWaitMs: 15_000 });
}

export interface SearchParams {
  q?: string;
  artist?: string;
  track?: string;
  release_title?: string;
  catno?: string;
  label?: string;
  format?: string;
  type?: "release" | "master";
  per_page?: number;
}

/** GET /database/search (requires a token). Returns [] on any failure. */
export async function search(p: SearchParams): Promise<{ results: any[]; error?: string }> {
  if (!hasToken()) return { results: [], error: "DISCOGS_TOKEN not set" };
  const r = await dget("/database/search", { type: "release", per_page: 25, ...p });
  if (!r.ok) return { results: [], error: `HTTP ${r.status} ${r.error ?? ""}`.trim() };
  return { results: r.data?.results ?? [] };
}

export async function release(id: number, currency = "EUR") {
  const r = await dget(`/releases/${id}`, { curr_abbr: currency });
  return r.ok ? r.data : undefined;
}

export async function master(id: number) {
  const r = await dget(`/masters/${id}`);
  return r.ok ? r.data : undefined;
}

/** All vinyl versions of a master, oldest first. Pages through up to `maxPages` × 100. */
export async function masterVersions(id: number, maxPages = 5): Promise<{ versions: any[]; total: number }> {
  const out: any[] = [];
  let total = 0;
  for (let page = 1; page <= maxPages; page++) {
    const r = await dget(`/masters/${id}/versions`, {
      format: "Vinyl",
      sort: "released",
      sort_order: "asc",
      per_page: 100,
      page,
    });
    if (!r.ok) break;
    total = r.data?.pagination?.items ?? out.length;
    out.push(...(r.data?.versions ?? []));
    if (page >= (r.data?.pagination?.pages ?? 1)) break;
  }
  return { versions: out, total: Math.max(total, out.length) };
}

export async function marketplaceStats(id: number, currency = "EUR") {
  const r = await dget(`/marketplace/stats/${id}`, { curr_abbr: currency });
  return r.ok ? r.data : undefined;
}

export const webUrl = {
  release: (id: number) => `https://www.discogs.com/release/${id}`,
  master: (id: number) => `https://www.discogs.com/master/${id}`,
  sellRelease: (id: number) => `https://www.discogs.com/sell/release/${id}`,
  sellMaster: (id: number) => `https://www.discogs.com/sell/list?master_id=${id}&format=Vinyl`,
};

export interface FlatRelease {
  id: number;
  masterId?: number;
  artist: string;
  title: string;
  label?: string;
  catno?: string;
  allCatnos: string[];
  year?: number;
  country?: string;
  formats: string[];
  genres: string[];
  styles: string[];
  /** Only present when fetched from /releases (not from search results). */
  tracklist?: { position: string; title: string; artists?: string }[];
  thumb?: string;
  numForSale?: number;
  lowestPrice?: number;
}

/** Discogs release JSON -> flat fields used for scoring and display. */
export function flattenRelease(d: any): FlatRelease {
  const artists: string = d.artists_sort ?? (d.artists ?? []).map((a: any) => a.anv || a.name).join(", ");
  const formats: string[] = [];
  for (const f of d.formats ?? []) {
    formats.push(f.name, ...(f.descriptions ?? []));
    if (f.text) formats.push(f.text);
  }
  return {
    id: d.id as number,
    masterId: (d.master_id || undefined) as number | undefined,
    artist: artists,
    title: d.title as string,
    label: d.labels?.[0]?.name as string | undefined,
    catno: d.labels?.[0]?.catno as string | undefined,
    allCatnos: (d.labels ?? []).map((l: any) => l.catno as string).filter(Boolean) as string[],
    year: (d.year || undefined) as number | undefined,
    country: d.country as string | undefined,
    formats,
    genres: (d.genres ?? []) as string[],
    styles: (d.styles ?? []) as string[],
    tracklist: ((d.tracklist ?? []) as any[])
      .filter((t) => t.type_ !== "heading")
      .map((t) => ({
        position: t.position as string,
        title: t.title as string,
        artists: t.artists?.map((a: any) => a.anv || a.name).join(", ") as string | undefined,
      })),
    thumb: (d.thumb || d.images?.[0]?.uri150) as string | undefined,
    numForSale: d.num_for_sale as number | undefined,
    lowestPrice: d.lowest_price as number | undefined,
  };
}

/** Discogs search result -> same shape (no tracklist; "Artist - Title" split). */
export function flattenSearchResult(d: any): FlatRelease {
  const [artist, ...rest] = String(d.title ?? "").split(" - ");
  return {
    id: d.id as number,
    masterId: (d.master_id || undefined) as number | undefined,
    artist,
    title: rest.join(" - ") || artist,
    label: d.label?.[0] as string | undefined,
    catno: d.catno as string | undefined,
    allCatnos: d.catno ? [d.catno as string] : [],
    year: d.year ? Number(d.year) : undefined,
    country: d.country as string | undefined,
    formats: (d.format ?? []) as string[],
    genres: (d.genre ?? []) as string[],
    styles: (d.style ?? []) as string[],
    thumb: (d.thumb || d.cover_image) as string | undefined,
  };
}
