import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { apiBaseUrl, apiGet, sessionToken } from "../../src/load-workspace";
import {
  parseSignInNotice,
  parseSignInProviders,
} from "../../src/sign-in-model";
import { SignInPage } from "../../src/sign-in-view";
import "../sign-in.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sign in — AI Workforce",
};

type SignInProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Offers the configured providers. A signed-in member goes straight to the workspace. */
export default async function SignIn({ searchParams }: SignInProps) {
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  if (session !== undefined) {
    const me = await apiGet("/auth/me", session);
    if (me.status === 200) {
      redirect("/");
    }
  }
  const params = await searchParams;
  const raw = params.notice;
  const notice = parseSignInNotice(
    typeof raw === "string"
      ? raw
      : Array.isArray(raw)
        ? (raw[0] ?? null)
        : null,
  );
  const listed = await apiGet("/auth/providers", undefined);
  const providers =
    listed.status === 200 ? parseSignInProviders(listed.body) : null;
  return (
    <SignInPage providers={providers} notice={notice} apiBase={apiBaseUrl()} />
  );
}
