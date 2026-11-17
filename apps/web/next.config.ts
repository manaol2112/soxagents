import type { NextConfig } from "next";

// In development, Next.js serves its scripts only to this machine unless another host is
// allowed: the host of PUBLIC_BASE_URL (the machine's address on the local network).
function devOrigins(): string[] {
  try {
    const url = process.env.PUBLIC_BASE_URL ?? "";
    return url === "" ? [] : [new URL(url).hostname];
  } catch {
    return [];
  }
}

// The routes that answer with a Content-Security-Policy of their own (a preview shown in a
// sandbox). Next.js keeps a header set here over the route's own one of the same name, so
// the app-wide policy below is not given to them: they forbid framing in their own policy.
const OWN_POLICY =
  "workspace/evidence-files/[^/]+/preview|workspace/policy-file|workspace/request-attachment";

/**
 * Security headers on every response (security review, 17 November 2026). The app frames
 * none of its own pages (the one iframe, the email preview, is a sandboxed srcdoc), so no
 * page may be framed at all: frame-ancestors 'none' and, for older browsers, DENY. No
 * script-src policy is set: it would block the inline scripts Next.js writes into each page
 * unless every one carried a nonce, which is a change of its own.
 */
export const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
];
export const FRAME_POLICY = {
  key: "Content-Security-Policy",
  value: "frame-ancestors 'none'",
};

export async function headers() {
  return [
    { source: "/:path*", headers: SECURITY_HEADERS },
    {
      source: `/:path((?!(?:${OWN_POLICY})(?:/|$)).*)`,
      headers: [FRAME_POLICY],
    },
  ];
}

const config: NextConfig = {
  // A second build (a review server beside `make web`) writes to its own folder, so it
  // never replaces the files the running dev server compiled (27 October 2026).
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: devOrigins(),
  headers,
};

export default config;
