import type { Candidate, Result, ShopLink, VersionRow } from "../types.ts";

/** One row of the results table: a place to get the record. */
export interface Row {
  place: string;
  type: "vinyl" | "digital";
  /** "12\" · original 1987 press", "Search by artist and title", … */
  what: string;
  avail: string;
  /** Known price (Discogs only, per the UX spec: shops show "Check price"). */
  price?: { value: number; currency: string; from: boolean };
  url: string;
}

const SIZE_ORDER = ['12"', '10"', '7"', "LP", "EP"];

/** The physical size to print ("12\"", "LP") from Discogs format descriptions. */
export function formatLabel(formats: string[] | string | undefined): string {
  const text = Array.isArray(formats) ? formats.join(", ") : formats ?? "";
  for (const f of SIZE_ORDER) if (text.includes(f)) return f;
  return "Vinyl";
}

function minPrice(vs: VersionRow[]) {
  let best: { value: number; currency: string } | undefined;
  for (const v of vs) if (v.lowestPrice && (!best || v.lowestPrice.value < best.value)) best = v.lowestPrice;
  return best;
}

/** "14 copies for sale", "14+ copies" when some versions weren't priced, "Stock not checked" when none were. */
function availability(vs: VersionRow[]) {
  const priced = vs.filter((v) => v.numForSale !== undefined);
  if (!priced.length) return "Stock not checked";
  const n = priced.reduce((sum, v) => sum + (v.numForSale ?? 0), 0);
  const plus = priced.length < vs.length ? "+" : "";
  if (n === 0 && !plus) return "None for sale right now";
  return `${n}${plus} ${n === 1 && !plus ? "copy" : "copies"} for sale`;
}

function discogsRows(r: Result, chosen: Candidate | undefined): Row[] {
  const e = r.expanded;
  if (!e || !e.versions.length) return [];
  const rows: Row[] = [];
  const bootleg = (v: VersionRow) => /unofficial/i.test(v.format ?? "");
  const originals = e.versions.filter((v) => v.isOriginal && !bootleg(v));
  const later = e.versions.filter((v) => !v.isOriginal && !bootleg(v));
  const bootlegs = e.versions.filter(bootleg);
  const size = formatLabel(chosen?.formats ?? originals[0]?.format);
  const cheapestUrl = (vs: VersionRow[]) =>
    vs.length === 1 ? vs[0].sellUrl : ([...vs].filter((v) => v.lowestPrice).sort((a, b) => a.lowestPrice!.value - b.lowestPrice!.value)[0]?.sellUrl ?? e.master?.marketplaceUrl ?? vs[0].sellUrl);

  if (originals.length) {
    const year = originals[0].year;
    const p = minPrice(originals);
    rows.push({
      place: "Discogs",
      type: "vinyl",
      what: `${size} · original ${year ? `${year} ` : ""}press`,
      avail: availability(originals),
      price: p ? { ...p, from: true } : undefined,
      url: cheapestUrl(originals),
    });
  }
  if (later.length) {
    const newest = Math.max(...later.map((v) => v.year ?? 0));
    const recent = later.some((v) => v.isRecent);
    const p = minPrice(later);
    rows.push({
      place: "Discogs",
      type: "vinyl",
      what: `${size} · ${later.length === 1 ? "later pressing" : `${later.length} later pressings`}${recent && newest ? `, newest ${newest}` : ""}`,
      avail: availability(later),
      price: p ? { ...p, from: true } : undefined,
      url: later.length === 1 ? later[0].sellUrl : e.master?.marketplaceUrl ?? cheapestUrl(later),
    });
  }
  if (bootlegs.length) {
    const p = minPrice(bootlegs);
    rows.push({
      place: "Discogs",
      type: "vinyl",
      what: `${size} · ${bootlegs.length === 1 ? "unofficial pressing" : `${bootlegs.length} unofficial pressings`} (bootleg)`,
      avail: availability(bootlegs),
      price: p ? { ...p, from: true } : undefined,
      url: cheapestUrl(bootlegs),
    });
  }
  return rows;
}

function shopRow(l: ShopLink, size: string): Row {
  const what =
    l.kind === "vinyl"
      ? `${size} · ${l.queryType === "catno" ? `catalog no. ${l.query}` : "artist and title search"}`
      : "Artist and title search";
  return { place: l.shop, type: l.kind, what, avail: "Stock not checked", url: l.url };
}

/** Rows ordered by place (A–Z); the page can re-sort by price and filter by type. */
export function buildRows(r: Result): Row[] {
  const chosen = r.identify.candidates.find((c) => c.releaseId === r.identify.chosenReleaseId) ?? r.identify.candidates[0];
  const size = chosen ? formatLabel(chosen.formats) : "Vinyl";
  const rows = [
    ...discogsRows(r, chosen),
    ...r.whereToGet.vinyl.map((l) => shopRow(l, size)),
    ...r.whereToGet.digital.map((l) => shopRow(l, size)),
  ];
  return rows.sort((a, b) => a.place.localeCompare(b.place));
}

export function money(p: { value: number; currency: string }) {
  const sym = p.currency === "EUR" ? "€" : p.currency === "GBP" ? "£" : p.currency === "USD" ? "$" : `${p.currency} `;
  return `${sym}${p.value.toFixed(2)}`;
}
