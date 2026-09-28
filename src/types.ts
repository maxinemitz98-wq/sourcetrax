export type Platform = "spotify" | "apple" | "youtube" | "deezer" | "unknown";

/** What we learned about the input link, before touching Discogs. */
export interface Resolved {
  input: string;
  platform: Platform;
  kind: "track" | "album" | "video" | "unknown";
  artist?: string;
  /** All credited artists, primary first. */
  artists: string[];
  title?: string;
  /** Mix / version name, e.g. "Original Mix", "Vocal", "12'' Version". */
  mix?: string;
  album?: string;
  label?: string;
  year?: number;
  isrc?: string;
  upc?: string;
  /** Catalog-number-like strings found in titles or descriptions. */
  catnoHints: string[];
  /** Discogs release/master links found in a YouTube description. */
  discogsLinks: DiscogsRef[];
  /** Which resolvers contributed, in order (e.g. "odesli", "deezer", "youtube-oembed"). */
  sources: string[];
  /** Non-fatal problems (rate limits, missing keys, fallbacks taken). */
  notes: string[];
  rawTitle?: string;
  description?: string;
  /** Direct streaming/store links Odesli returned, keyed by platform. */
  platformLinks: Record<string, string>;
}

export interface DiscogsRef {
  type: "release" | "master";
  id: number;
}

export type IdentifyPath =
  | "youtube-description"
  | "musicbrainz-isrc"
  | "musicbrainz-barcode"
  | "discogs-search";

export interface Candidate {
  releaseId: number;
  masterId?: number;
  artist: string;
  title: string;
  label?: string;
  catno?: string;
  year?: number;
  country?: string;
  formats: string[];
  genres: string[];
  styles: string[];
  thumb?: string;
  url: string;
  /** Track on the release that matched the input title, if the tracklist was checked. */
  matchedTrack?: string;
  score: number;
  confidence: "high" | "medium" | "low";
  path: IdentifyPath;
  reasons: string[];
}

export interface VersionRow {
  releaseId: number;
  year?: number;
  country?: string;
  label?: string;
  catno?: string;
  format?: string;
  title?: string;
  isOriginal: boolean;
  /** Pressed later than the original. */
  isReissue: boolean;
  /** Pressed in the last two years: most likely to still be in stock at shops. */
  isRecent: boolean;
  numForSale?: number;
  lowestPrice?: { value: number; currency: string };
  sellUrl: string;
  url: string;
}

export interface ShopLink {
  shop: string;
  kind: "digital" | "vinyl";
  region: string;
  query: string;
  queryType: "catno" | "text";
  url: string;
  /** Text-query link when the primary one is a catalog-number search. */
  fallbackUrl?: string;
  verified: string;
}

export interface Expanded {
  release: Candidate;
  tracklist: { position: string; title: string; artists?: string }[];
  master?: {
    id: number;
    title: string;
    year?: number;
    numForSale?: number;
    lowestPrice?: { value: number; currency: string };
    url: string;
    marketplaceUrl: string;
  };
  versions: VersionRow[];
  /** How many vinyl versions exist in total (versions may be truncated for stats). */
  versionCount: number;
}

export interface Result {
  input: string;
  resolved: Resolved;
  identify: {
    path?: IdentifyPath;
    tried: { path: IdentifyPath; outcome: string }[];
    candidates: Candidate[];
  };
  expanded?: Expanded;
  whereToGet: {
    discogs: { label: string; url: string }[];
    digital: ShopLink[];
    vinyl: ShopLink[];
  };
  httpCalls: Record<string, number>;
  elapsedMs: number;
}
