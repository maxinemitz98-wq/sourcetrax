# sourcetrax (spike)

Paste a track link (Spotify, Apple Music or YouTube). The tool finds the record on Discogs and shows where to get it: digital downloads, the original vinyl second-hand, and any represses or reissues. It covers electronic and electronic-adjacent music, with EU/UK shops.

This is **step 1**, a CLI spike that tests whether the matching holds up. There is no UI yet. See [REPORT.md](REPORT.md) for results.

## Setup

Requires [Bun](https://bun.sh) ≥ 1.1.

```sh
bun install            # dev deps only (types + tsc); the script has no runtime dependencies
cp .env.example .env   # then fill in DISCOGS_TOKEN
```

| Variable | Needed? | What it does |
|---|---|---|
| `DISCOGS_TOKEN` | **required** | Personal access token from https://www.discogs.com/settings/developers. Discogs search needs auth. Rate limit is ~60 req/min. |
| `YOUTUBE_API_KEY` | optional, recommended | YouTube Data API v3 key. Without it only the video *title* is read (oEmbed). With it the *description* is also read: Discogs links, `Cat#:` lines, and "Provided to YouTube by …" metadata. |
| `ODESLI_KEY` | optional | Raises Odesli's ~10 req/min anonymous limit. |
| `SOURCETRAX_CONTACT` | optional | URL or email for the User-Agent. MusicBrainz asks clients for one. |

Bun loads `.env` automatically.

**Network:** the script needs outbound HTTPS to `api.song.link`, `api.deezer.com`, `itunes.apple.com`, `musicbrainz.org`, `api.discogs.com`, `www.youtube.com` and `www.googleapis.com`. `--check-shops` also needs each shop's domain.

## Usage

```sh
bun run find.ts <url> [<url> ...]
bun run find.ts --file testset.txt          # the spike's test set
bun run find.ts <url> --json                # machine-readable output
bun run find.ts <url> --currency GBP        # Discogs marketplace prices in GBP (default EUR)
bun run find.ts <url> -v                    # log every HTTP request to stderr
bun run find.ts --check-shops ["query"]     # verify each shop's search-URL pattern
bun test                                    # offline unit + mocked end-to-end tests
```

For each URL the output shows:

- **RESOLVED**: artist, title, mix, ISRC, label and catno hints, which resolvers contributed, and any warnings.
- **IDENTIFIED**: which path produced the match, what every path returned, and the top 3 Discogs candidates. Each candidate is a distinct master, with a score, a confidence level and the reasons for both.
- **VERSIONS**: every vinyl version of the master, oldest first. Each is flagged `original`, `repress/reissue`, `RECENT repress` (last two years) or `bootleg`, with Discogs for-sale count and lowest price.
- **WHERE TO GET IT**: Discogs marketplace links, digital shop searches, and new-vinyl EU/UK shop searches.

Responses are cached on disk for 24 h in `.cache/` so reruns don't burn rate limits. Use `--no-cache` to bypass the cache.

## Pipeline

```
link ─► RESOLVE ─────────────────────────► IDENTIFY (stop at first solid hit) ─► EXPAND ─► WHERE TO GET IT
        Odesli ─► Deezer (ISRC, label, UPC)   a. Discogs URL in YT description      master + all vinyl     Discogs sell links
        iTunes Lookup (Apple fallback)        b. ISRC/UPC ─► MusicBrainz ─► Discogs  versions + marketplace digital shop search
        YouTube oEmbed / Data API             c. Discogs database search + scoring   stats                  vinyl shop search (catno)
```

- **Resolve** (`src/resolve.ts`). Every step is optional. Failures (429, 410, timeouts, missing keys) are recorded in `notes` and the next step runs. Spotify links go through Odesli only; the Spotify Web API is not used. For YouTube, Odesli's cross-platform match is only trusted when its title agrees with the video title, because Odesli matches videos by fuzzy search and lands on the wrong song for vinyl rips.
- **Identify** (`src/identify.ts`). The scoring (0–100) is:

  | Signal | Points |
  |---|---|
  | Artist match | 35 |
  | Track found in the Discogs tracklist (or release title match) | 30 |
  | Catalog number match | +20 |
  | Linked via MusicBrainz / description | +15 |
  | Vinyl | +10 |
  | Electronic genre / electronic-adjacent style | +8 |
  | Label match | +7 |
  | Year match | +5 |
  | Compilation | −10 |

  Search results are grouped by master before the top 5 are verified against full release details. The top 3 are therefore different records, not three pressings of one record. Confidence is high at ≥ 75 and medium at ≥ 50.
- **Expand** (`src/expand.ts`). The original is the earliest-year vinyl version(s). Anything later, or tagged `RE`/`RP`/`Reissue`, is a repress/reissue candidate. The API can't list marketplace listings, so the tool fetches `/marketplace/stats` per version. It caps these calls at `--stats` (default 15) in this order: the identified release, originals, then newest first.
- **Shops** (`src/shops.ts`). All shops live in one `SHOPS` array. Vinyl shops are searched by the newest vinyl pressing's catno, because that is what's in stock and catno is the best cross-shop key. Each catno link has an `artist title` text fallback in `--json`. Digital shops are searched by `artist title`.

### Shop URL patterns

Every shop domain was blocked in the environment this was built in, so no search URL could be fetched there. Each pattern is tagged with how far it could be checked. Run `bun run check-shops` somewhere with open network to confirm them all. It fetches each search URL and checks that it returns a results page.

| Shop | Pattern | Status |
|---|---|---|
| Traxsource | `traxsource.com/search?term=` | indexed: live URL seen in a web index |
| Juno Records | `juno.co.uk/search/?q[all][]=…&solrorder=relevancy` | indexed: `q[<field>][]` form seen |
| Decks.de | `decks.de/decks/workfloor/search_db.php?such=…&wosuch=all&wassuch=atl&where=1st` | indexed |
| Redeye | `redeyerecords.co.uk/search/?keywords=` | indexed |
| Clone | `clone.nl/search?instock=0&query=` | indexed |
| Rush Hour | `rushhour.nl/search?query=` | indexed |
| Bandcamp, Beatport | `bandcamp.com/search?q=`, `beatport.com/search?q=` | platform: long-standing public search |
| Juno Download | same engine as Juno Records | platform |
| Yoyaku, Bordello A Parigi | `/?s=…&post_type=product` | platform: both are WooCommerce sites |
| Deejay.de | `deejay.de/<query>` | **unverified** |
| HHV | `hhv.de/en-US/search?q=` | **unverified** |
| Hard Wax | `hardwax.com/?search=` | **unverified** |
| Phonica | `phonicarecords.com/search/<query>` | **unverified**: `/search/` exists, parameter unknown |

## Layout

```
find.ts               CLI entry
src/resolve.ts        link -> artist/title/ISRC (Odesli, Deezer, iTunes, YouTube)
src/identify.ts       -> Discogs candidates (description link, MusicBrainz, search) + scoring
src/expand.ts         -> master versions, repress flags, marketplace stats
src/shops.ts          shop config + search-link builder
src/discogs.ts, src/musicbrainz.ts   API clients
src/http.ts           fetch wrapper: per-API rate limits, retry-once on 429/503, timeouts, disk cache
src/text.ts           normalisation, fuzzy match, YouTube title/description parsing, catnos
src/format.ts         text output
test/                 bun tests (unit + mocked end-to-end)
```

## Designed to keep open (not built)

- **Web UI.** `run()` in `src/pipeline.ts` returns one serialisable `Result` (the same object `--json` prints). A page can call it and render the steps: confirm the candidate (the candidate already carries thumb, label, catno and year), then show results.
- **Real stock/price checks.** `ShopLink` is where a per-shop checker plugs in. Check each shop's ToS before scraping publicly.
- **Watch for represses or price drops.** Versions are keyed by Discogs master, so a watcher can diff `masterVersions()` for new release ids, and `marketplaceStats()` against a price threshold.
- **Affiliate links.** All shop URLs come from `Shop.search()`, which is the single place to wrap them.
