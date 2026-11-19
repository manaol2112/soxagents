import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { apiBaseUrl, apiGet, sessionToken } from "../../src/load-workspace";
import {
  parseSignInNotice,
  parseSignInProviders,
  RETURN_PARAM,
  returnAddress,
} from "../../src/sign-in-model";
import { SignInPage } from "../../src/sign-in-view";
import "../sign-in.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sign in — Audit Workforce",
};

type SignInProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Offers the configured providers. A signed-in member goes straight to the workspace, or
 * to the workspace address they were sent here from (`next`, checked by returnAddress). */
export default async function SignIn({ searchParams }: SignInProps) {
  const params = await searchParams;
  const returnTo = returnAddress(first(params[RETURN_PARAM]));
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  if (session !== undefined) {
    const me = await apiGet("/auth/me", session);
    if (me.status === 200) {
      redirect(returnTo ?? "/");
    }
  }
  const notice = parseSignInNotice(first(params.notice));
  const listed = await apiGet("/auth/providers", undefined);
  const providers =
    listed.status === 200 ? parseSignInProviders(listed.body) : null;
  return (
    <SignInPage
      providers={providers}
      notice={notice}
      apiBase={apiBaseUrl()}
      returnTo={returnTo}
    />
  );
}

function first(value: string | string[] | undefined): string | null {
  return typeof value === "string"
    ? value
    : Array.isArray(value)
      ? (value[0] ?? null)
      : null;
}
