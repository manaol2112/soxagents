// A host name with an optional port, or a bracketed IPv6 address with one.
const HOST = /^(?:[A-Za-z0-9.-]{1,253}|\[[0-9A-Fa-f:.]{2,45}\])(?::\d{1,5})?$/;

/**
 * An address on this app as the browser reached it, for redirects. The server's own
 * request URL names the address it listens on, which is 0.0.0.0 when the dev server
 * listens on the network, and a browser cannot be sent there. The browser's Host header
 * (or a proxy's forwarded host) is what it asked for. A malformed value is ignored.
 */
export function browserUrl(path: string, request: Request): URL {
  const own = new URL(request.url);
  const asked = (
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    ""
  )
    .split(",")[0]
    ?.trim();
  const host = asked !== undefined && HOST.test(asked) ? asked : own.host;
  const forwarded = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const scheme =
    forwarded === "http" || forwarded === "https"
      ? `${forwarded}:`
      : own.protocol;
  // Built whole, so a host without a port does not keep the server's port.
  return new URL(path, `${scheme}//${host}`);
}
