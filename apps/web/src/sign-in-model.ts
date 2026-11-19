// The sign-in page: which providers the API offers, what a failed attempt says, and where
// signing in brings the person back to.

import { localPath } from "./browser-url.ts";

export type ProviderId = "google" | "entra";

export type SignInProvider = {
  id: ProviderId;
  label: string;
  loginPath: string;
};

export type SignInProviders = {
  providers: SignInProvider[];
  preview: boolean;
};

const PROVIDER_IDS: ReadonlySet<string> = new Set(["google", "entra"]);
const LOGIN_PATH = /^\/auth\/[a-z/-]+$/;

/** Reads `GET /auth/providers`. Anything malformed means the list is unknown. */
export function parseSignInProviders(body: unknown): SignInProviders | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.providers) || typeof record.preview !== "boolean") {
    return null;
  }
  const providers: SignInProvider[] = [];
  for (const item of record.providers) {
    if (typeof item !== "object" || item === null) {
      return null;
    }
    const entry = item as Record<string, unknown>;
    if (
      typeof entry.id !== "string" ||
      !PROVIDER_IDS.has(entry.id) ||
      typeof entry.label !== "string" ||
      entry.label.trim() === "" ||
      typeof entry.login_path !== "string" ||
      !LOGIN_PATH.test(entry.login_path)
    ) {
      return null;
    }
    providers.push({
      id: entry.id as ProviderId,
      label: entry.label,
      loginPath: entry.login_path,
    });
  }
  return { providers, preview: record.preview };
}

/** The sign-in link for one provider, or null when the API does not offer it. */
export function providerHref(
  apiBase: string,
  providers: SignInProviders | null,
  id: ProviderId,
): string | null {
  const match = providers?.providers.find((provider) => provider.id === id);
  return match === undefined ? null : `${apiBase}${match.loginPath}`;
}

/** The parameter that carries the return address, here and on the API's sign-in starts. */
export const RETURN_PARAM = "next";

// A workspace address: "/" or "/?..." in printable ASCII with no backslash. The API keeps
// the same rule (services/api/ai_workforce_api/auth.py, return_path).
const WORKSPACE_ADDRESS = /^\/(?:\?[\x21-\x5b\x5d-\x7e]*)?$/;

/**
 * Where signing in brings the person back to, or null for the workspace home: only a
 * workspace address on this app, at most 2000 characters (localPath). Anything that could
 * leave the app ("//host", a scheme, a backslash, whitespace, a control character) or open
 * another page is dropped, never followed (19 November 2026).
 */
export function returnAddress(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    localPath(value) === null ||
    !WORKSPACE_ADDRESS.test(value)
  ) {
    return null;
  }
  return value;
}

/** The sign-in page for a signed-out visitor, carrying the page they asked for and, when
 * there is one, the notice that says why they are there. */
export function signInAddress(
  path: string | null,
  notice: SignInNotice | null = null,
): string {
  const query = new URLSearchParams();
  if (notice !== null) {
    query.set("notice", notice);
  }
  const kept = returnAddress(path);
  if (kept !== null && kept !== "/") {
    query.set(RETURN_PARAM, kept);
  }
  const text = query.toString();
  return text === "" ? "/sign-in" : `/sign-in?${text}`;
}

/** A sign-in start (a provider or the preview, on the API) that comes back to `path`. The
 * workspace home needs no return: it is where a sign-in lands anyway. */
export function withReturn(href: string, path: string | null): string {
  const kept = returnAddress(path);
  if (kept === null || kept === "/") {
    return href;
  }
  return `${href}?${new URLSearchParams({ [RETURN_PARAM]: kept }).toString()}`;
}

export type SignInNotice =
  | "failed"
  | "unlinked"
  | "disabled"
  | "unavailable"
  | "throttled"
  | "expired";

export const SIGN_IN_NOTICES: Record<SignInNotice, string> = {
  failed: "Sign-in did not complete. Try again.",
  unlinked:
    "This email is already linked to a different account with that provider. Sign in with the account you used before.",
  disabled: "This account is disabled. Ask an owner of your workspace.",
  throttled:
    "Too many sign-in attempts from this network. Wait a few minutes and try again.",
  unavailable: "Sign-in is not available right now. Try again in a moment.",
  expired: "Your session has ended.",
};

/** The sign-in card's lead line: where signing in returns to for a member sent here from
 * the workspace, or the newcomer's line. A session that ended is never a newcomer. */
export const SIGN_IN_LEADS = {
  page: "You will return to the page you were on.",
  workspace: "You will return to your workspace.",
  newcomer:
    "New here? Continue with your account and your workspace is created in the same step. No password to set.",
} as const;

export function signInLead(
  returnTo: string | null,
  notice: SignInNotice | null,
): keyof typeof SIGN_IN_LEADS {
  if (returnTo !== null && returnTo !== "/") {
    return "page";
  }
  return notice === "expired" ? "workspace" : "newcomer";
}

export function parseSignInNotice(value: string | null): SignInNotice | null {
  if (
    value === "failed" ||
    value === "unlinked" ||
    value === "disabled" ||
    value === "throttled" ||
    value === "unavailable" ||
    value === "expired"
  ) {
    return value;
  }
  return null;
}

/**
 * Where the workspace sends a visitor it cannot serve, or null to render it. A signed-out
 * visitor never sees the workspace's frame (product owner, 19 November 2026): they sign in
 * and come back to `path`. A first visit to the bare address, with no session at all, is a
 * newcomer, who sees the landing page as before (docs/development.md). A session cookie the
 * API no longer knows is a session that ended (expired or revoked: signing out removes the
 * cookie), and the sign-in page says so. A member who is signed in and denied (403) still
 * sees the workspace's own message.
 */
export function signedOutRedirect(input: {
  signedOut: boolean;
  hasSession: boolean;
  path: string;
}): string | null {
  if (!input.signedOut) {
    return null;
  }
  if (!input.hasSession && input.path === "/") {
    return "/welcome";
  }
  return signInAddress(input.path, input.hasSession ? "expired" : null);
}
