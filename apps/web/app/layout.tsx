import { Inter } from "next/font/google";
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

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata = {
  title: "AI Employee Workforce",
  description: "Engagement workspace for IT audit delivery",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
