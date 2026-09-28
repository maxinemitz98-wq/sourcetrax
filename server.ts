#!/usr/bin/env bun
/**
 * sourcetrax web UI (spec: docs/UX.md).
 *
 *   bun run server.ts            # http://localhost:3000
 *   PORT=8080 bun run server.ts
 *   SOURCETRAX_DEMO=1 bun run server.ts   # offline demo with synthetic data, no API access needed
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run, type RunOpts } from "./src/pipeline.ts";
import { parseLink } from "./src/links.ts";
import { APP_JS, renderHome, renderResults } from "./src/web/pages.ts";
import type { Result } from "./src/types.ts";

const CSS = readFileSync(join(import.meta.dir, "src/web/styles.css"), "utf8");

type Runner = (url: string, opts: RunOpts) => Promise<Result>;

const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

/** Request handler; `runner` is injectable for tests. */
export function makeHandler(runner: Runner = run, defaults: Omit<RunOpts, "releaseId"> = { currency: "EUR", statsLimit: 15 }) {
  return async function handle(req: Request): Promise<Response> {
    const u = new URL(req.url);
    if (u.pathname === "/") return html(renderHome());
    if (u.pathname === "/styles.css") return new Response(CSS, { headers: { "content-type": "text/css; charset=utf-8" } });
    if (u.pathname === "/app.js") return new Response(APP_JS, { headers: { "content-type": "text/javascript; charset=utf-8" } });

    if (u.pathname === "/find" || u.pathname === "/api/find") {
      const input = (u.searchParams.get("url") ?? "").trim();
      const api = u.pathname === "/api/find";
      const bad = (msg: string) => (api ? Response.json({ error: msg }, { status: 400 }) : html(renderHome({ value: input, error: msg }), 400));
      if (!input) return bad("Paste a link first.");
      const link = parseLink(input);
      if (link.platform === "unknown" || link.platform === "deezer") return bad("That link isn't from Spotify, Apple Music or YouTube.");
      if (link.kind === "unknown") return bad("That looks like a profile or playlist. Paste a link to a single track or video.");
      const release = Number(u.searchParams.get("release")) || undefined;
      const currency = (u.searchParams.get("currency") ?? defaults.currency).toUpperCase();
      try {
        const result = await runner(input, { ...defaults, currency: ["EUR", "GBP", "USD"].includes(currency) ? currency : defaults.currency, releaseId: release });
        return api ? Response.json(result) : html(renderResults(result));
      } catch (e) {
        console.error(e);
        return api ? Response.json({ error: "lookup failed" }, { status: 500 }) : html(renderHome({ value: input, error: "Something went wrong looking that up. Try again in a minute." }), 500);
      }
    }
    return html(renderHome({ error: "Page not found." }), 404);
  };
}

if (import.meta.main) {
  if (process.env.SOURCETRAX_DEMO) {
    const { installDemo } = await import("./test/fixtures/demo.ts");
    installDemo();
    console.log("demo mode: synthetic API responses, any Spotify/Apple/YouTube link returns the demo record");
  } else if (!process.env.DISCOGS_TOKEN) {
    console.warn("warning: DISCOGS_TOKEN not set; Discogs search and prices won't work (see .env.example)");
  }
  const port = Number(process.env.PORT ?? 3000);
  Bun.serve({ port, fetch: makeHandler(), idleTimeout: 120 });
  console.log(`sourcetrax on http://localhost:${port}`);
}
