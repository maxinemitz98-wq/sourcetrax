import type { Result, VersionRow } from "./types.ts";

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c(1);
const dim = c(2);
const green = c(32);
const yellow = c(33);
const red = c(31);

function money(p?: { value: number; currency: string }) {
  if (!p) return "";
  const sym = p.currency === "EUR" ? "€" : p.currency === "GBP" ? "£" : p.currency === "USD" ? "$" : `${p.currency} `;
  return `${sym}${p.value.toFixed(2)}`;
}

function conf(s: string) {
  return s === "high" ? green(s) : s === "medium" ? yellow(s) : red(s);
}

export function formatText(r: Result): string {
  const L: string[] = [];
  const res = r.resolved;
  L.push(bold(`━━ ${r.input}`));

  // RESOLVED
  const who = [res.artist, res.title].filter(Boolean).join(" – ") || red("(nothing resolved)");
  L.push(`${bold("RESOLVED")}    ${who}${res.mix ? ` (${res.mix})` : ""}   ${dim(`[${res.platform} ${res.kind}]`)}`);
  const facts = [
    res.isrc && `ISRC ${res.isrc}`,
    res.upc && `UPC ${res.upc}`,
    res.album && `album "${res.album}"`,
    res.label && `label ${res.label}`,
    res.year && `${res.year}`,
    res.catnoHints.length && `catno hints ${res.catnoHints.join(", ")}`,
    res.discogsLinks.length && `discogs links ${res.discogsLinks.map((d) => `${d.type}/${d.id}`).join(", ")}`,
  ].filter(Boolean);
  if (facts.length) L.push(`            ${facts.join(" · ")}`);
  if (res.rawTitle) L.push(`            ${dim(`video title: "${res.rawTitle}"`)}`);
  L.push(`            ${dim(`via ${res.sources.join(" → ") || "nothing"}`)}`);
  for (const n of res.notes) L.push(`            ${yellow("! " + n)}`);

  // IDENTIFIED
  const id = r.identify;
  L.push(`${bold("IDENTIFIED")}  ${id.path ? `via ${bold(id.path)}` : red("no match")}`);
  for (const t of id.tried) L.push(`            ${dim(`${t.path}: ${t.outcome}`)}`);
  id.candidates.forEach((cd, i) => {
    const fmt = cd.formats.filter((f) => f !== "Vinyl").slice(0, 3).join(", ");
    L.push(
      `  ${i + 1}. ${cd.artist} – ${cd.title}  ${dim("|")} ${cd.label ?? "?"} ${cd.catno ?? ""} ${dim("|")} ${cd.year ?? "?"} ${cd.country ?? ""} ${dim("|")} ${cd.formats.includes("Vinyl") ? "Vinyl" : cd.formats[0] ?? "?"}${fmt ? ` ${fmt}` : ""}`,
    );
    L.push(`     ${conf(cd.confidence)} ${cd.score}  ${cd.url}${cd.masterId ? dim(`  (master ${cd.masterId})`) : ""}`);
    L.push(`     ${dim(cd.reasons.join("; "))}`);
  });

  // VERSIONS
  const e = r.expanded;
  if (e) {
    const m = e.master;
    const head = m
      ? `${e.versionCount} vinyl version(s) of master ${m.id}${m.numForSale !== undefined ? ` · ${m.numForSale} for sale on Discogs${m.lowestPrice ? ` from ${money(m.lowestPrice)}` : ""}` : ""}`
      : `${e.versionCount} vinyl version(s) (no master)`;
    L.push(`${bold("VERSIONS")}    ${head}`);
    const shown = selectVersions(e.versions);
    for (const v of shown) L.push("  " + versionLine(v));
    if (e.versions.length > shown.length) L.push(dim(`  … ${e.versions.length - shown.length} more (see --json)`));
  }

  // WHERE TO GET IT
  L.push(bold("WHERE TO GET IT"));
  if (r.whereToGet.discogs.length) {
    L.push("  Discogs (second-hand)");
    for (const d of r.whereToGet.discogs) L.push(`    ${d.label.padEnd(48)} ${d.url}`);
  }
  if (r.whereToGet.digital.length) {
    L.push(`  Digital ${dim(`(query "${r.whereToGet.digital[0].query}")`)}`);
    for (const s of r.whereToGet.digital) L.push(`    ${s.shop.padEnd(18)} ${s.url}${s.verified === "unverified" ? dim("  [url unverified]") : ""}`);
  }
  if (r.whereToGet.vinyl.length) {
    const v0 = r.whereToGet.vinyl[0];
    L.push(`  New vinyl EU/UK ${dim(`(${v0.queryType} "${v0.query}"${v0.fallbackUrl ? ", text fallback in --json" : ""})`)}`);
    for (const s of r.whereToGet.vinyl) L.push(`    ${s.shop.padEnd(18)} ${s.url}${s.verified === "unverified" ? dim("  [url unverified]") : ""}`);
  }
  const calls = Object.entries(r.httpCalls).map(([k, n]) => `${k} ${n}`).join(", ");
  L.push(dim(`(${(r.elapsedMs / 1000).toFixed(1)}s; requests: ${calls || "none"})`));
  return L.join("\n");
}

/** Originals, anything recent, the cheapest in stock, then fill up to 12 rows. */
function selectVersions(vs: VersionRow[]): VersionRow[] {
  if (vs.length <= 12) return vs;
  const keep = new Set<VersionRow>();
  vs.filter((v) => v.isOriginal).slice(0, 4).forEach((v) => keep.add(v));
  vs.filter((v) => v.isRecent).forEach((v) => keep.add(v));
  vs.filter((v) => v.numForSale).sort((a, b) => (a.lowestPrice?.value ?? 1e9) - (b.lowestPrice?.value ?? 1e9)).slice(0, 4).forEach((v) => keep.add(v));
  for (const v of [...vs].reverse()) if (keep.size < 12) keep.add(v);
  return vs.filter((v) => keep.has(v));
}

function versionLine(v: VersionRow) {
  const tag = v.isOriginal ? green("original") : v.isRecent ? yellow("RECENT repress") : v.isReissue ? "repress/reissue" : "";
  const unofficial = /unofficial/i.test(v.format ?? "") ? red(" bootleg") : "";
  const stock = v.numForSale === undefined ? dim("stats n/a") : v.numForSale ? `${v.numForSale} for sale from ${money(v.lowestPrice)}` : dim("none for sale");
  return `${String(v.year ?? "????")} ${(v.country ?? "").padEnd(8).slice(0, 8)} ${`${v.label ?? ""} ${v.catno ?? ""}`.padEnd(30).slice(0, 30)} ${(v.format ?? "").padEnd(22).slice(0, 22)} ${(tag + unofficial).padEnd(tty ? 25 : 23)} ${stock}  ${dim(v.sellUrl)}`;
}
