/**
 * The workspace theme (decided by the product owner): dark by default, light on request.
 * The choice is kept in a cookie so the server renders the right theme on the first
 * paint; the client portal and the public pages stay light whatever it says.
 */

export const THEMES = ["dark", "light"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_COOKIE = "aw_theme";

export const THEME_LABELS: Record<Theme, string> = {
  dark: "Dark",
  light: "Light",
};

/** The theme a stored value names; anything else is the default, dark. */
export function parseTheme(value: string | null | undefined): Theme {
  return value === "light" ? "light" : "dark";
}

/** The cookie that keeps a choice for a year on this browser. */
export function themeCookie(theme: Theme): string {
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
