#!/usr/bin/env bun
/**
 * sourcetrax spike: track link -> Discogs release -> where to get it.
 *
 *   bun run find.ts <url> [<url> ...] [--json] [--currency EUR|GBP] [--stats N] [--no-cache] [-v]
 *   bun run find.ts --file testset.txt
 *   bun run find.ts --check-shops [query]
 */
import { readFileSync } from "node:fs";
import { run } from "./src/pipeline.ts";
import { formatText } from "./src/format.ts";
import { setCacheEnabled, setVerbose } from "./src/http.ts";
import { checkShops } from "./src/check-shops.ts";
import { hasToken } from "./src/discogs.ts";

const USAGE = `usage: bun run find.ts <url> [<url> ...] [options]

options:
  --json             print results as JSON
  --file <path>      read URLs from a file (one per line, # comments allowed)
  --currency <EUR|GBP|USD>  marketplace currency (default EUR)
  --stats <n>        max Discogs marketplace-stats calls per track (default 15)
  --no-cache         bypass the 24h on-disk HTTP cache (.cache/)
  -v, --verbose      log every HTTP request to stderr
  --check-shops [q]  test every shop search URL pattern (default query "Basic Channel")
`;

async function main() {
  const args = process.argv.slice(2);
  const urls: string[] = [];
  let json = false;
  let currency = "EUR";
  let statsLimit = 15;
  let checkShopsQuery: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") json = true;
    else if (a === "--no-cache") setCacheEnabled(false);
    else if (a === "-v" || a === "--verbose") setVerbose(true);
    else if (a === "--currency") currency = (args[++i] ?? "EUR").toUpperCase();
    else if (a === "--stats") statsLimit = Number(args[++i] ?? 15);
    else if (a === "--file") {
      const lines = readFileSync(args[++i], "utf8").split(/\r?\n/);
      urls.push(...lines.map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean));
    } else if (a === "--check-shops") {
      checkShopsQuery = args[i + 1] && !args[i + 1].startsWith("-") ? args[++i] : "Basic Channel";
    } else if (a === "-h" || a === "--help") {
      console.log(USAGE);
      return;
    } else if (a.startsWith("-")) {
      console.error(`unknown option ${a}\n\n${USAGE}`);
      process.exit(2);
    } else urls.push(a);
  }

  if (checkShopsQuery !== undefined) {
    await checkShops(checkShopsQuery, json);
    return;
  }
  if (!urls.length) {
    console.error(USAGE);
    process.exit(2);
  }
  if (!hasToken()) console.error("warning: DISCOGS_TOKEN not set; Discogs search/marketplace calls will fail (see .env.example)\n");

  const results = [];
  for (const url of urls) {
    const r = await run(url, { currency, statsLimit });
    results.push(r);
    if (!json) console.log(formatText(r) + "\n");
  }
  if (json) console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
