import { apiBaseUrl, apiGet } from "../../src/load-workspace";
import { parseSignInProviders, providerHref } from "../../src/sign-in-model";
import {
  parseLibrarySummary,
  parseWelcomeNotice,
} from "../../src/welcome-model";
import { WelcomePage } from "../../src/welcome-view";
import "../welcome.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "AI Workforce — AI employees for SOX and IT audit",
  description:
    "Agents request the evidence, test every control, cite the exact passage they relied on, and bring every sign-off back to a person.",
};

type WelcomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** The public landing page. Visitors who are not signed in land here from the root. */
export default async function Welcome({ searchParams }: WelcomeProps) {
  const params = await searchParams;
  const raw = params.notice;
  const notice = parseWelcomeNotice(
    typeof raw === "string"
      ? raw
      : Array.isArray(raw)
        ? (raw[0] ?? null)
        : null,
  );
  const [listed, summary] = await Promise.all([
    apiGet("/auth/providers", undefined),
    apiGet("/public/library-summary", undefined),
  ]);
  const providers =
    listed.status === 200 ? parseSignInProviders(listed.body) : null;
  return (
    <WelcomePage
      notice={notice}
      googleHref={providerHref(apiBaseUrl(), providers, "google")}
      library={
        summary.status === 200 ? parseLibrarySummary(summary.body) : null
      }
    />
  );
}
