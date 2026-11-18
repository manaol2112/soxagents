/**
 * Cross-site request protection (governance assessment, finding S3; owner-approved design,
 * 18 November 2026). The session cookie is SameSite=Lax, which a page on a sibling
 * subdomain of the production domain does not stop: it is the "same site", so its form post
 * would carry the session and could approve or send. Every state-changing request must
 * therefore come from this app's own origin.
 *
 * A browser names the origin of a state-changing request (Origin), or at least whether it is
 * cross-site (Sec-Fetch-Site). A server-to-server call carries neither and is not a browser
 * acting for a signed-in person, so it is let through to the route's own checks.
 */

/** Methods that change nothing, and are never refused here. */
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export const ORIGIN_REFUSED =
  "This request did not come from the workspace itself, so it was not accepted.";

export type OriginFacts = {
  method: string;
  /** The Origin header, or null when the browser sent none. */
  origin: string | null;
  /** The Sec-Fetch-Site header, or null. */
  fetchSite: string | null;
  /** The Host header: the host the browser addressed. */
  host: string | null;
  /** X-Forwarded-Host, as a reverse proxy in front of the app sets it. A cross-site page
   * cannot set it: a form cannot set headers, and a script's request with one would need a
   * CORS preflight this app never grants. */
  forwardedHost: string | null;
  /** Further origins allowed (WEB_ALLOWED_ORIGINS), each like https://app.example.com. */
  allowed: readonly string[];
};

function hostOf(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Why the request is refused, or null when it may go on to its route. */
export function originRefusal(facts: OriginFacts): string | null {
  if (SAFE.has(facts.method.toUpperCase())) {
    return null;
  }
  const origin = facts.origin?.trim() ?? "";
  if (origin !== "") {
    // "null" is the origin of a sandboxed frame or a local file: never this app.
    const from = origin === "null" ? null : hostOf(origin);
    if (from === null) {
      return ORIGIN_REFUSED;
    }
    const own = [facts.host, ...(facts.forwardedHost ?? "").split(",")]
      .map((value) => (value ?? "").trim().toLowerCase())
      .filter((value) => value !== "");
    const extra = facts.allowed
      .map((value) => hostOf(value.trim()))
      .filter((value): value is string => value !== null);
    return own.includes(from) || extra.includes(from) ? null : ORIGIN_REFUSED;
  }
  const site = facts.fetchSite?.trim().toLowerCase() ?? "";
  return site === "cross-site" || site === "same-site" ? ORIGIN_REFUSED : null;
}

/** WEB_ALLOWED_ORIGINS: a comma-separated list; empty when unset. */
export function allowedOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}
