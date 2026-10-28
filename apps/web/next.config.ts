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

const config: NextConfig = {
  // A second build (a review server beside `make web`) writes to its own folder, so it
  // never replaces the files the running dev server compiled (27 October 2026).
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: devOrigins(),
};

export default config;
