# Spike report: does link → Discogs matching hold up?

**Status: not answered yet.** The live test run could not happen. The cloud environment this was built in blocks every API the pipeline calls. The egress proxy answered `403` for api.song.link, api.deezer.com, itunes.apple.com, musicbrainz.org, api.discogs.com and www.youtube.com, and for every shop domain. No `DISCOGS_TOKEN` was configured either. So this report covers:

1. What *was* verified: the code paths, with offline tests.
2. The test set, with an expected identification path and predicted failure point per link. These are predictions to check, not results.
3. How to produce the real report: one command once the network is open.

## 1. What was verified

- **31 offline tests pass** (`bun test`).
  - **Title parsing** on real YouTube titles from the test set: `Artist – 'Title' (Official Audio)`, `(Transmat | 1987)`, `(Vocal) Rare Italo Disco 1984`, `[KDJ 26]`, `(Raw Grooves EP)` and format/genre noise such as `(Vinyl, 12'') (Italo-Disco, Euro-Disco)`.
  - **Link parsing**, catno normalisation, fuzzy matching, Discogs links in descriptions, and YouTube "Provided to YouTube by" auto-descriptions.
  - **Mocked end-to-end runs** of every identification path and fall-through, using synthetic API payloads in each API's documented shape:
    - Spotify → Odesli → Deezer ISRC → MusicBrainz → Discogs master → vinyl versions with original/repress/recent/bootleg flags.
    - Odesli `429` → YouTube oEmbed → title parse → Discogs search, where the original outranks a compilation that contains the same track.
    - A Discogs link in the YouTube description (`youtube-description` path, no search needed).
    - Odesli mapping a vinyl rip to an unrelated Deezer track: detected and ignored.
    - An ISRC that MusicBrainz links to a *compilation*: the tool also searches Discogs and prefers the original record.
    - No `DISCOGS_TOKEN`: a clear "skipped" reason.
- **Live run in the blocked sandbox**: every request failed with 403, and the tool degraded cleanly. It reported `odesli failed (403); falling back`, `youtube oembed failed (403)`, and `discogs-search: skipped: DISCOGS_TOKEN not set`. It did not crash.

The mocked tests show that the *logic* does what it is designed to do. They say nothing about real-world match quality. That is what the test set is for.

## 2. Test set and predictions

The links are in [`testset.txt`](testset.txt). All were found via web search on 2026-09-28.

| # | Link | Expected path | Prediction / where it may break |
|---|---|---|---|
| 1 | Spotify: Fred again.., Skrillex, Four Tet *Baby again..* (2026) | Odesli → Deezer ISRC → MB (likely no Discogs relation yet for a new release) → **discogs-search** | Probably matches a digital (File) Discogs release. There may be no vinyl, so VERSIONS would be empty and vinyl-shop links fall back to a text search. The three-artist credit is searched with the first artist only. |
| 2 | Apple Music: Kerri Chandler *Track 1 (Remaster)* | Odesli → Deezer ISRC (remaster ISRC) → MB unlikely → **discogs-search** | **Highest risk.** "Track 1" is a generic title and the artist has a huge catalogue. The "remaster" ISRC and label point at the reissue, not the original. The top candidate may be the wrong Kerri Chandler record. |
| 3 | YouTube official: Floating Points *'Ablaze'* (Official Audio) | Odesli should map the official upload to Deezer; the title-agreement check passes → ISRC → MB or **discogs-search** | Should work. The quoted title and "(Official Audio)" are handled. |
| 4 | YouTube rip: P.R.D. *I Want To... (Vocal)*, 1984 Italo | Odesli likely nothing (or a wrong match, which is ignored) → oEmbed title parse → **discogs-search** | Title parse is tested: artist `P.R.D.`, title `I Want To...`, mix `Vocal`. Risk: Discogs search on a dotted artist name and a trailing "...". Without `YOUTUBE_API_KEY` there is no catno from the description. With it, a `TL 004`-style catno would make the match near-certain. |
| 5 | YouTube: Rhythim Is Rhythim *Strings Of Life* (Transmat \| 1987) | Odesli may map to Deezer (on streaming) → ISRC → MB; else title parse (label Transmat, year 1987 extracted) → **discogs-search** | Many masters share the name ("Strings Of Life", remix 12"s, compilations). Grouping by master, the label/year bonus and the compilation penalty should put the 1987 master first. Expect dozens of versions. Only 15 get marketplace stats (`--stats`). |
| 5b | Spotify: Mr. Fingers *Can You Feel It* | Odesli → Deezer ISRC → MB → **musicbrainz-isrc** | The ISRC may belong to a compilation or remaster release. That case is now handled: search also runs and the compilation is penalised. Mr. Fingers has several masters for this title (Vocal, Instrumental, remixes), so the top 3 are worth checking by hand. |
| + | YouTube: Kerri Chandler *Four (Raw Grooves EP)* | title parse → **discogs-search** (`artist + track=Four`) | Tests "track ≠ release title": `Four` must be found in the *Raw Grooves* tracklist. `(Raw Grooves EP)` is captured as the album hint. |

## 3. Producing the real report

1. Allow network access to the hosts listed in the README, and add `DISCOGS_TOKEN` (optionally `YOUTUBE_API_KEY`). In a Claude Code cloud environment, do this in the environment's settings: *Network access* and secrets.
2. Run:
   ```sh
   bun run find.ts --file testset.txt > run.txt
   bun run find.ts --file testset.txt --json > run.json
   bun run check-shops
   ```
3. For each link, record the following. The first three come straight from the output's `IDENTIFIED` block and `tried` list:
   - the path that succeeded
   - what each earlier path returned
   - the top candidate
   - whether that candidate is right: compare it against Discogs by hand

## Known gaps (found while building)

- **Spotify depends entirely on Odesli.** When Odesli is down, a Spotify link resolves to nothing. The Web API is excluded by design. A cheap fallback is Spotify's oEmbed endpoint (`open.spotify.com/oembed`). It returns the track title but not the artist, so it would need a different search strategy. Not built.
- **Generic titles** ("Track 1", "Untitled", "A1") need catno or label signals. Artist + title alone is weak for them.
- **Marketplace stats cost one API call per version.** At 60 req/min, a record with 100+ versions can't be fully priced per lookup. The master's own `num_for_sale`/`lowest_price` is shown as the summary.
- **Discogs `sell/list?master_id=…` link** (all versions for sale) is a pattern from the Discogs website, not the API. It is unverified here, like the four shop URLs marked unverified in the README.
