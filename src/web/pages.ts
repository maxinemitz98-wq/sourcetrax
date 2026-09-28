import type { Candidate, Result } from "../types.ts";
import { buildRows, formatLabel, money, type Row } from "./rows.ts";

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ARROW_RIGHT = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>`;
const ARROW_OUT = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>`;
const CHEVRON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;

function layout(title: string, body: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@300;500&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
<script src="/app.js" defer></script>
</head>
<body>
<div class="light" aria-hidden="true"><span></span><span></span><span></span></div>
${process.env.SOURCETRAX_DEMO ? `<div class="demo-badge">Demo data</div>` : ""}
${body}
</body>
</html>`;
}

// ---- page 1 ------------------------------------------------------------------

export function renderHome(opts: { value?: string; error?: string } = {}) {
  return layout(
    "sourcetrax",
    `<div class="home">
<a class="logo" href="/">sourcetrax</a>
<main>
<h1>Play it out.<br><span>Lossless or on wax.</span></h1>
<p class="sub">Paste a link and see every shop that sells it: lossless downloads, new pressings and second-hand vinyl.</p>
<form action="/find" method="get" data-busy>
<label class="eyebrow" for="url">Paste a track link</label>
<div class="field-row">
<input id="url" name="url" type="url" required value="${esc(opts.value)}" placeholder="https://open.spotify.com/track/…" autocomplete="off"${opts.error ? ` aria-invalid="true" aria-describedby="url-error"` : ""}>
<button class="go" type="submit">Go${ARROW_RIGHT}</button>
</div>
${opts.error ? `<p class="error" id="url-error" role="alert">${esc(opts.error)}</p>` : ""}
</form>
<div class="accepts">
<strong>Links we accept</strong>
<div class="chips"><span>Spotify</span><span>Apple Music</span><span>YouTube</span></div>
<p>A track or video link. YouTube rips of records that aren't on streaming work too.</p>
</div>
</main>
</div>`,
  );
}

// ---- page 2 ------------------------------------------------------------------

function topbar() {
  return `<header class="topbar">
<a class="logo" href="/">sourcetrax</a>
<form action="/find" method="get" data-busy>
<label class="sr-only" for="again">Paste another track link</label>
<input id="again" name="url" type="url" required placeholder="Paste another link…" autocomplete="off">
<button class="go" type="submit">Go</button>
</form>
</header>`;
}

function recordBlock(r: Result, chosen: Candidate | undefined) {
  const others = r.identify.candidates.filter((c) => c.releaseId !== chosen?.releaseId);
  const res = r.resolved;
  const title = chosen?.title ?? res.title ?? "Unknown track";
  const artist = chosen?.artist ?? res.artist ?? "";
  const facts = chosen
    ? [chosen.label, chosen.catno && !/^none$/i.test(chosen.catno) ? chosen.catno : undefined, chosen.year, chosen.formats.includes("Vinyl") ? `${formatLabel(chosen.formats)} vinyl` : chosen.formats[0], chosen.styles[0] ?? chosen.genres[0]]
    : [res.label, res.year];
  const note = chosen
    ? ""
    : `<p class="note">${res.title ? "We couldn't pin this to a record on Discogs. The shop searches below use the artist and title." : "We couldn't read this link. Check it's a Spotify, Apple Music or YouTube track."}</p>`;
  const cover = chosen?.thumb ? `<img src="${esc(chosen.thumb)}" alt="">` : `<div class="disc"></div>`;
  const alt = others.length
    ? `<details class="alt">
<summary>Not this record? ${others.length} other ${others.length === 1 ? "match" : "matches"}${CHEVRON}</summary>
<ul>
${others
  .map(
    (c) => `<li><a href="/find?url=${encodeURIComponent(r.input)}&amp;release=${c.releaseId}">${c.thumb ? `<img src="${esc(c.thumb)}" alt="">` : `<span class="thumb"></span>`}<span><b>${esc(c.artist)} – ${esc(c.title)}</b><small>${esc([c.label, c.catno, c.year, formatLabel(c.formats)].filter(Boolean).join(" · "))}</small></span></a></li>`,
  )
  .join("\n")}
</ul>
</details>`
    : "";
  return `<section class="record" aria-label="Matched record">
<div class="cover">${cover}</div>
<div class="meta">
<h1>${esc(title)}</h1>
${artist ? `<div class="artist">${esc(artist)}</div>` : ""}
<div class="facts">${facts.filter(Boolean).map((f) => `<span>${esc(f)}</span>`).join("")}</div>
${note}
</div>
${alt}
</section>`;
}

function rowHtml(row: Row) {
  const price = row.price
    ? `<span class="amount">${row.price.from ? "from " : ""}${esc(money(row.price))}</span>`
    : `<a class="check" href="${esc(row.url)}" target="_blank" rel="noopener">Check price</a>`;
  const kind = row.type === "vinyl" ? (row.place === "Discogs" ? "Vinyl · second-hand" : "Vinyl · new") : "Digital · download";
  return `<div class="row ${row.type}" data-type="${row.type}" data-place="${esc(row.place)}" data-price="${row.price?.value ?? ""}">
<a class="place" href="${esc(row.url)}" target="_blank" rel="noopener">${esc(row.place)}${ARROW_OUT}</a>
<div class="what"><span>${esc(row.what)}</span><small>${kind}</small></div>
<span class="avail">${esc(row.avail)}</span>
<div class="price">${price}</div>
</div>`;
}

export function renderResults(r: Result) {
  const chosen = r.identify.candidates.find((c) => c.releaseId === r.identify.chosenReleaseId) ?? r.identify.candidates[0];
  const rows = buildRows(r);
  const title = chosen ? `${chosen.artist} – ${chosen.title}` : r.resolved.title ?? "No match";
  return layout(
    `${title} · sourcetrax`,
    `<div class="results">
${topbar()}
${recordBlock(r, chosen)}
<div class="controls" data-controls hidden>
<div class="group" role="group" aria-label="Show">
<span class="eyebrow">Show</span>
<button type="button" class="pill" data-filter="all" aria-pressed="true">All</button>
<button type="button" class="pill" data-filter="vinyl" aria-pressed="false">Vinyl</button>
<button type="button" class="pill" data-filter="digital" aria-pressed="false">Digital</button>
</div>
<div class="group" role="group" aria-label="Order by">
<span class="eyebrow">Order by</span>
<button type="button" class="pill" data-sort="place" aria-pressed="true">Place</button>
<button type="button" class="pill" data-sort="price" aria-pressed="false">Price</button>
</div>
</div>
<section class="table" aria-label="Where to get it">
<div class="row head" aria-hidden="true"><span>Place</span><span>What you get</span><span>Availability</span><span class="price">Price</span></div>
<div data-rows>
${rows.length ? rows.map(rowHtml).join("\n") : `<div class="empty">Nothing to search for yet.</div>`}
</div>
</section>
</div>`,
  );
}

/** Client script: busy state on Go, filter + sort on the results table. */
export const APP_JS = `
document.querySelectorAll("form[data-busy]").forEach(function (f) {
  f.addEventListener("submit", function () {
    var b = f.querySelector(".go");
    if (b) { b.setAttribute("aria-busy", "true"); b.firstChild.nodeValue = "Finding… "; }
  });
});
var box = document.querySelector("[data-rows]");
var controls = document.querySelector("[data-controls]");
if (box && controls) {
  controls.hidden = false;
  var state = { filter: "all", sort: "place" };
  var rows = Array.prototype.slice.call(box.querySelectorAll(".row"));
  function apply() {
    var sorted = rows.slice().sort(function (a, b) {
      if (state.sort === "price") {
        var pa = a.dataset.price === "" ? Infinity : +a.dataset.price;
        var pb = b.dataset.price === "" ? Infinity : +b.dataset.price;
        if (pa !== pb) return pa - pb;
      }
      return a.dataset.place.localeCompare(b.dataset.place);
    });
    sorted.forEach(function (r) {
      r.hidden = state.filter !== "all" && r.dataset.type !== state.filter;
      box.appendChild(r);
    });
    controls.querySelectorAll("[data-filter]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.filter === state.filter)); });
    controls.querySelectorAll("[data-sort]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.sort === state.sort)); });
  }
  controls.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.filter) state.filter = b.dataset.filter;
    if (b.dataset.sort) state.sort = b.dataset.sort;
    apply();
  });
}
`;
