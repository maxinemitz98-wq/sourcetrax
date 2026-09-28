import { get } from "./http.ts";
import { SHOPS } from "./shops.ts";

/**
 * Verify each shop's search URL pattern: fetch a search for a record every
 * electronic shop is likely to list, and check the page is a results page
 * (HTTP 200 and the query appears in the HTML). This is not a stock check.
 */
export async function checkShops(query = "Basic Channel", json = false) {
  const rows: { shop: string; url: string; status: number; queryInPage: boolean; verdict: string }[] = [];
  for (const s of SHOPS) {
    const url = s.search(query);
    const r = await get(url, { bucket: "shop", text: true, cache: false, timeoutMs: 15_000 });
    const html = r.text ?? r.error ?? "";
    const queryInPage = html.toLowerCase().includes(query.toLowerCase());
    const verdict = !r.ok
      ? `FAIL (${r.status || r.error})`
      : queryInPage
        ? "OK: looks like a results page"
        : "?: 200 but query not in page (JS-rendered or wrong pattern)";
    rows.push({ shop: s.name, url, status: r.status, queryInPage, verdict });
    if (!json) console.log(`${s.name.padEnd(18)} ${verdict}\n${"".padEnd(18)} ${url}`);
  }
  if (json) console.log(JSON.stringify(rows, null, 2));
  return rows;
}
