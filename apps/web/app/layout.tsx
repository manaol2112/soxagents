import type { ReactNode } from "react";

import "./globals.css";
import "./modern.css";

export const metadata = {
  title: "AI Employee Workforce",
  description: "Engagement workspace for IT audit delivery",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
