"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import {
  FOCUS_KEY,
  FOCUS_NARROW,
  rememberedFocus,
  rememberFocus,
} from "./step-focus-model";

/*
 * Focus mode's state (product owner, 16 November 2026: focus mode, option A): the person's
 * choice, kept in this browser (step-focus-model's FOCUS_KEY) and shared by every part of
 * the page that reads it, with no address change and no request. The panel (WorkflowPanel)
 * sets `data-step-focus` on the root while it is in focus, so the navigation folds to its
 * icons (control-workflow.css); the review notes read the side column from FocusSide.
 */

const listeners = new Set<() => void>();
let chosen: boolean | null = null;

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function onStorage(event: StorageEvent) {
  // Another tab changed the choice: read it again.
  if (event.key === FOCUS_KEY) {
    chosen = null;
    notify();
  }
}

function subscribeChoice(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("storage", onStorage);
    }
  };
}

function choice(): boolean {
  if (chosen === null) {
    chosen = rememberedFocus(() => window.localStorage);
  }
  return chosen;
}

function subscribeWidth(change: () => void) {
  const query = window.matchMedia(FOCUS_NARROW);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
}

const never = () => false;

/** How long the root is marked as moving after a toggle: the width animates only then,
 * not when a page opens already in focus (control-workflow.css). */
const MOVING_MS = 260;
let moving = 0;

/** Turns focus on or off, keeps the choice, and lets the width animate once. */
export function setStepFocus(on: boolean): void {
  if (choice() === on) {
    return;
  }
  chosen = on;
  rememberFocus(() => window.localStorage, on);
  const root = document.documentElement;
  root.dataset.stepFocusMoving = "";
  window.clearTimeout(moving);
  moving = window.setTimeout(() => {
    delete root.dataset.stepFocusMoving;
  }, MOVING_MS);
  notify();
}

/**
 * The person's choice and whether it applies here: `wide` is false at 1100 px and under,
 * where the panel is already full width (no toggle, no icon rail); `focus` is the choice
 * where it applies. On the server, and in the first render after it, both are off.
 */
export function useStepFocus(): {
  chosen: boolean;
  wide: boolean;
  focus: boolean;
} {
  const on = useSyncExternalStore(subscribeChoice, choice, never);
  const wide = useSyncExternalStore(
    subscribeWidth,
    () => !window.matchMedia(FOCUS_NARROW).matches,
    never,
  );
  return { chosen: on, wide, focus: on && wide };
}

/** The focused panel's side column, at its right edge, for the review notes' strip and
 * their rail; null outside focus, where the notes stay beside the document as before. */
export const FocusSide = createContext<HTMLElement | null>(null);

export function useFocusSide(): HTMLElement | null {
  return useContext(FocusSide);
}
