import { Source_Serif_4 } from "next/font/google";
import { apiBaseUrl, apiGet } from "../../src/load-workspace";
import { parseSignInProviders, providerHref } from "../../src/sign-in-model";
import {
  parseLibrarySummary,
  parseWelcomeNotice,
} from "../../src/welcome-model";
import { WelcomePage } from "../../src/welcome-view";
import "../welcome.css";

export const dynamic = "force-dynamic";

// The landing page's display serif (the product owner's references, 27 October 2026);
// the workspace keeps Inter alone.
const serif = Source_Serif_4({
  subsets: ["latin"],
  display: "swap",
  axes: ["opsz"],
  variable: "--font-serif",
});

export const metadata = {
  title: "Audit Workforce — the agentic audit workspace",
  description:
    "A coordinated team of AI agents plans, requests, tests, challenges and documents every control, with the auditor in command. For every auditor, from a one-person practice to a global firm.",
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
    <div className={serif.variable}>
      <WelcomePage
        notice={notice}
        googleHref={providerHref(apiBaseUrl(), providers, "google")}
        library={
          summary.status === 200 ? parseLibrarySummary(summary.body) : null
        }
      />
    </div>
  );
}
