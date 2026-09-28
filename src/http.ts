import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const CONTACT = process.env.SOURCETRAX_CONTACT || "https://github.com/maxinemitz98-wq/sourcetrax";
export const USER_AGENT = `sourcetrax/0.1 ( ${CONTACT} )`;

export interface HttpResult<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  text?: string;
  error?: string;
  headers?: Headers;
  fromCache?: boolean;
}

export interface RequestOpts {
  /** Rate-limit bucket; requests in the same bucket are spaced by `minIntervalMs`. */
  bucket: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Retry once on 429/503 if the wait is at most this long. */
  maxRetryWaitMs?: number;
  /** Return body as text instead of JSON. */
  text?: boolean;
  cache?: boolean;
}

/** Minimum spacing between requests per API, from each API's documented limits. */
const MIN_INTERVAL_MS: Record<string, number> = {
  odesli: 6_500, // ~10 req/min anonymous
  musicbrainz: 1_100, // 1 req/s
  discogs: 1_050, // 60 req/min authenticated
  deezer: 150, // 50 req / 5 s
  itunes: 3_000, // ~20 req/min
  youtube: 100,
  shop: 1_000,
};

const lastCall = new Map<string, Promise<void>>();
let throttleEnabled = true;
/** Tests only: disable request spacing. */
export function setThrottleEnabled(v: boolean) {
  throttleEnabled = v;
}

async function throttle(bucket: string) {
  if (!throttleEnabled) return;
  const interval = MIN_INTERVAL_MS[bucket] ?? 0;
  const prev = lastCall.get(bucket) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  lastCall.set(bucket, prev.then(() => mine));
  await prev;
  setTimeout(release, interval);
}

// ---- call counting / tracing -------------------------------------------------

export const callCounts: Record<string, number> = {};
export const trace: string[] = [];
let verbose = false;
export function setVerbose(v: boolean) {
  verbose = v;
}
function log(line: string) {
  trace.push(line);
  if (verbose) console.error(`  · ${line}`);
}
export function resetCounts() {
  for (const k of Object.keys(callCounts)) delete callCounts[k];
}

// ---- tiny on-disk cache (keeps us inside rate limits while iterating) --------

const CACHE_DIR = join(process.cwd(), ".cache", "http");
const CACHE_TTL_MS = 24 * 3600 * 1000;
let cacheEnabled = true;
export function setCacheEnabled(v: boolean) {
  cacheEnabled = v;
}
function cacheKey(url: string, headers?: Record<string, string>) {
  // Auth headers are part of the key's input only; they are never written to disk.
  return createHash("sha1").update(url + JSON.stringify(headers ?? {})).digest("hex");
}
function cacheGet(key: string): HttpResult | undefined {
  const f = join(CACHE_DIR, key + ".json");
  if (!existsSync(f)) return;
  try {
    const entry = JSON.parse(readFileSync(f, "utf8"));
    if (Date.now() - entry.ts > CACHE_TTL_MS) return;
    return { ok: true, status: 200, data: entry.data, text: entry.text, fromCache: true };
  } catch {
    return;
  }
}
function cachePut(key: string, r: HttpResult) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(join(CACHE_DIR, key + ".json"), JSON.stringify({ ts: Date.now(), data: r.data, text: r.text }));
  } catch {
    /* cache is best-effort */
  }
}

// ---- fetch (swappable for tests) ---------------------------------------------

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: FetchFn = (url, init) => fetch(url, init);
export function setFetch(fn: FetchFn) {
  fetchImpl = fn;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Redact API keys/tokens from URLs before they are logged. */
function redact(url: string) {
  return url.replace(/([?&](?:key|token)=)[^&]+/gi, "$1***");
}

/**
 * GET a URL and never throw: failures come back as { ok: false, status, error } so
 * callers can fall through to the next strategy.
 */
export async function get<T = any>(url: string, opts: RequestOpts): Promise<HttpResult<T>> {
  const headers = { "User-Agent": USER_AGENT, Accept: opts.text ? "text/html,*/*" : "application/json", ...opts.headers };
  const useCache = cacheEnabled && opts.cache !== false;
  const key = cacheKey(url, headers);
  if (useCache) {
    const hit = cacheGet(key);
    if (hit) {
      log(`cache ${opts.bucket} ${redact(url)}`);
      return hit as HttpResult<T>;
    }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    await throttle(opts.bucket);
    callCounts[opts.bucket] = (callCounts[opts.bucket] ?? 0) + 1;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
    let res: Response;
    try {
      res = await fetchImpl(url, { headers, signal: ctrl.signal, redirect: "follow" });
    } catch (e: any) {
      clearTimeout(timer);
      const error = e?.name === "AbortError" ? "timeout" : String(e?.message ?? e);
      log(`ERR  ${opts.bucket} ${redact(url)} -> ${error}`);
      return { ok: false, status: 0, error };
    }
    clearTimeout(timer);
    log(`${res.status}  ${opts.bucket} ${redact(url)}`);

    if ((res.status === 429 || res.status === 503) && attempt === 0) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 3_000;
      if (wait <= (opts.maxRetryWaitMs ?? 5_000)) {
        await sleep(wait);
        continue;
      }
    }

    let body: string;
    try {
      body = await res.text();
    } catch (e: any) {
      return { ok: false, status: res.status, error: String(e?.message ?? e) };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: body.slice(0, 200), headers: res.headers };
    }
    let result: HttpResult<T>;
    if (opts.text) {
      result = { ok: true, status: res.status, text: body, headers: res.headers };
    } else {
      try {
        result = { ok: true, status: res.status, data: JSON.parse(body), headers: res.headers };
      } catch {
        return { ok: false, status: res.status, error: "invalid JSON" };
      }
    }
    if (useCache) cachePut(key, result);
    return result;
  }
  return { ok: false, status: 429, error: "rate limited" };
}
