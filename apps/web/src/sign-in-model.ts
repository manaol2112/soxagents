// The sign-in page: which providers the API offers, and what a failed attempt says.

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

export type SignInNotice = "failed" | "unlinked" | "disabled" | "unavailable";

export const SIGN_IN_NOTICES: Record<SignInNotice, string> = {
  failed: "Sign-in did not complete. Try again.",
  unlinked:
    "This email is already linked to a different account with that provider. Sign in with the account you used before.",
  disabled: "This account is disabled. Ask an owner of your workspace.",
  unavailable: "Sign-in is not available right now. Try again in a moment.",
};

export function parseSignInNotice(value: string | null): SignInNotice | null {
  if (
    value === "failed" ||
    value === "unlinked" ||
    value === "disabled" ||
    value === "unavailable"
  ) {
    return value;
  }
  return null;
}
