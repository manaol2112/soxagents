"use client";

import { useState } from "react";

import { THEME_LABELS, THEMES, type Theme, themeCookie } from "./theme.ts";

/** Light or dark, in the account menu: applied at once, kept for the next visit. */
export function ThemeSwitch({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const choose = (next: Theme) => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    // biome-ignore lint/suspicious/noDocumentCookie: a display preference, read by the server on the next render.
    document.cookie = themeCookie(next);
  };
  return (
    <fieldset className="theme-switch">
      <legend>Theme</legend>
      <div className="theme-switch-options">
        {THEMES.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={theme === item}
            onClick={() => choose(item)}
          >
            {THEME_LABELS[item]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
