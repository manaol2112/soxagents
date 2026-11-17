import { Geist } from "next/font/google";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import "./globals.css";
import "./controls.css";
import "./controls-register.css";
import "./control-workspace.css";
import "./evidence-center.css";
import "./loading.css";
import "./console.css";
import "./engagements.css";
import "./portal.css";
import "./planning.css";
import "./library.css";
import "./controls-setup.css";
import "./controls-page.css";
import "./control-plan.css";
import "./client-walkthrough.css";
import "./evidence-requests.css";
import "./process-flow.css";
import "./procedure-board.css";
import "./trial.css";
import "./methodology.css";
import "./control-workflow.css";
import "./step-panels.css";
import "./demo.css";
import "./evidence-intelligence.css";
import "./evidence-dialog.css";
import "./control-tabs.css";
import "./control-setup.css";
import "./agent-avatar.css";
import "./attribute-list.css";
import "./design-requests.css";
import "./design-evidence.css";
import "./check-digest.css";
import "./evidence-wizard.css";
import "./design-workpaper.css";
import "./review-notes.css";
import "./evidence-annotations.css";
// Last: the glass layer sits over the modules' own surfaces.
import "./glass.css";

import { parseTheme, THEME_COOKIE } from "../src/theme";

/** The workspace's one typeface (shadcn/ui, product owner, 17 November 2026). */
const sans = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

// The serif is retired in the workspace (shadcn/ui, 17 November 2026). The public landing
// page loads its own (app/welcome/page.tsx), so no workspace page downloads it.

export const metadata = {
  title: "AI Employee Workforce",
  description: "Engagement workspace for IT audit delivery",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  // The theme is set on the first paint, so a page never flashes the other one.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="en"
      className={sans.variable}
      data-theme={theme}
    >
      <body>{children}</body>
    </html>
  );
}
