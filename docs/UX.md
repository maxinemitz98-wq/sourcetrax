# Web UI spec (agreed 2026-09-28)

Mockup: https://claude.ai/artifact/MWopupFTmPfQ7ViHzPoEmY (private to the owner).

## Flow

1. **Input page.** Centred on the page: the headline "Play it out. / Lossless or on wax." (second line in red), a one-line subline ("Paste a link and see every shop that sells it: lossless downloads, new pressings and second-hand vinyl."), then one large link field with the **Go** button, then a small box listing accepted sources (Spotify, Apple Music, YouTube). The logo sits top left. There is no tagline.
2. **Results page.** The matched record at the top: cover, title, artist, label, year, format. No confidence level is shown. Next to the record is a "Not this record? N other matches" button (charcoal pill; red on hover) that opens the other candidates. Below it, a table of places to get the record.

## Results table

- One row per place, ordered by place (A–Z) by default. Price order and an All / Vinyl / Digital filter are also available.
- **Vinyl rows are dark** (charcoal, light text). **Digital rows are light** (off-white, dark text).
- **The place name is the link** to that page: "Discogs" opens the record's page on Discogs, "Bandcamp" opens the Bandcamp search. The name is white on dark rows and black on light rows, with a light red glow.
- Columns: place · what you get · availability · price.
- **Prices (option A):**
  - Discogs rows show real prices from the API, in up to three rows: the original press, later pressings, and bootlegs (unofficial pressings, kept apart so their prices don't pass for real represses). Each row shows copies for sale and the lowest price.
  - Shop rows (new vinyl and digital) show **"Check price"**, linking to the shop's search. Their stock isn't checked, since that needs per-shop page scraping, with each shop's terms of use checked first.
  - When sorting by price, rows without a price go last.

## Look

- A minimal nightclub in the morning sun: an off-white / light grey background (`#ECEBE7`) with soft diagonal bands of window light.
- Red (`#C8101E`) is the accent. **Only the Go button glows** (a neon red glow, stronger on hover), plus the light red glow on place names. The logo and headline are red with no glow.
- Charcoal `#1A191C` for text and the vinyl rows.
- Type: Unbounded (light) for display, Instrument Sans for body, JetBrains Mono for prices and catalog numbers.
- No footer or legend fine print.
