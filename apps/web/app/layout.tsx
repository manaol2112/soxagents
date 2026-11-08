import { Inter, Source_Serif_4 } from "next/font/google";
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
import "./demo.css";
import "./evidence-intelligence.css";
import "./evidence-dialog.css";
import "./control-tabs.css";
import "./control-setup.css";
import "./agent-avatar.css";
import "./attribute-list.css";
// Last: the glass layer sits over the modules' own surfaces.
import "./glass.css";

import { parseTheme, THEME_COOKIE } from "../src/theme";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

/** A display serif for the few headlines the owner's references set in one (the setup
 * introduction, 2 November 2026). */
const serif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
  variable: "--font-serif",
});

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
      className={`${inter.variable} ${serif.variable}`}
      data-theme={theme}
    >
      <body>{children}</body>
    </html>
  );
}
