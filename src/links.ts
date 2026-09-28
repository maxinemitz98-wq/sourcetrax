import type { Platform } from "./types.ts";

export interface ParsedLink {
  platform: Platform;
  kind: "track" | "album" | "video" | "unknown";
  id?: string;
  /** Apple: album id when the link is album?i=track. */
  albumId?: string;
  /** Apple storefront country, e.g. "gb". */
  country?: string;
}

export function parseLink(input: string): ParsedLink {
  const sp = input.match(/^spotify:(track|album):([A-Za-z0-9]+)/);
  if (sp) return { platform: "spotify", kind: sp[1] as "track" | "album", id: sp[2] };

  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return { platform: "unknown", kind: "unknown" };
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const parts = u.pathname.split("/").filter(Boolean);

  if (host === "open.spotify.com" || host === "play.spotify.com") {
    const i = parts.findIndex((p) => p === "track" || p === "album");
    if (i >= 0) return { platform: "spotify", kind: parts[i] as "track" | "album", id: parts[i + 1] };
    return { platform: "spotify", kind: "unknown" };
  }

  if (host === "music.apple.com" || host === "itunes.apple.com" || host === "geo.music.apple.com") {
    const country = parts[0]?.length === 2 ? parts[0] : undefined;
    const trackParam = u.searchParams.get("i");
    const idFrom = (seg: string) => {
      const i = parts.indexOf(seg);
      return i >= 0 ? parts[parts.length - 1]?.replace(/^id/, "") : undefined;
    };
    if (parts.includes("song")) return { platform: "apple", kind: "track", id: idFrom("song"), country };
    if (parts.includes("album")) {
      const albumId = idFrom("album");
      if (trackParam) return { platform: "apple", kind: "track", id: trackParam, albumId, country };
      return { platform: "apple", kind: "album", id: albumId, country };
    }
    return { platform: "apple", kind: "unknown", country };
  }

  if (host === "youtube.com" || host === "music.youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
    let id: string | undefined;
    if (host === "youtu.be") id = parts[0];
    else if (u.searchParams.get("v")) id = u.searchParams.get("v")!;
    else if (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live") id = parts[1];
    return { platform: "youtube", kind: id ? "video" : "unknown", id };
  }

  if (host === "deezer.com" || host.endsWith(".deezer.com")) {
    const i = parts.findIndex((p) => p === "track" || p === "album");
    if (i >= 0) return { platform: "deezer", kind: parts[i] as "track" | "album", id: parts[i + 1] };
  }

  return { platform: "unknown", kind: "unknown" };
}

/** Canonical watch URL (drops tracking params like &pp= / &si=). */
export function canonicalYouTube(id: string) {
  return `https://www.youtube.com/watch?v=${id}`;
}
