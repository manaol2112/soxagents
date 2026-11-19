/**
 * Browser checks on seeded synthetic review states (testing assessment, 19 November 2026,
 * step 5). Lifted from the scratch screenshot harness, which measured these things and
 * printed them for an agent to read; here they are asserted.
 *
 * Needs a running scratch stack on a seeded database:
 *   python scripts/seed_review_states.py create --db ai_workforce_states_ui1
 *   python scripts/scratch_stack.py start --db ai_workforce_states_ui1 --api-port 8030 --web-port 3030
 *   node --test --test-concurrency=1 tests/browser/*.browser.ts
 * REVIEW_DB names the database (default: the only session file in tmp/review-states),
 * REVIEW_SESSION a session file, REVIEW_WEB the web server (default http://127.0.0.1:3030).
 * The system Chrome is used (playwright-core, channel "chrome"); no browser is downloaded.
 *
 * Output, in test-results/browser/ (git-ignored): one compact JSON line per check on stdout,
 * <spec>.json with every check's measurements, screenshots in shots/, and <spec>.changed.txt
 * listing the screenshots that differ from the last reviewed set (reviewed.json): those
 * are what the design reviewer looks at. BROWSER_ACCEPT=1 records the current screenshots
 * as reviewed.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from "playwright-core";
import {
  type Box,
  consoleProblem,
  copyFindings,
  layoutFindings,
  type Measured,
  PHONE,
  spanFindings,
  storyFindings,
} from "./rules.ts";

export type Theme = "light" | "dark";
export type Combo = { theme: Theme; width: number };
export const COMBOS: readonly Combo[] = [
  { theme: "light", width: 1440 },
  { theme: "dark", width: 1440 },
  { theme: "light", width: 390 },
  { theme: "dark", width: 390 },
];

export type State = { url: string; [fact: string]: unknown };
export type Session = {
  db: string;
  organization: string;
  project: string;
  owner: string;
  cookie: string;
  states: Record<string, State>;
};

const ROOT = new URL("../../", import.meta.url);
const OUT = new URL("test-results/browser/", ROOT);
const SHOTS = new URL("shots/", OUT);
export const WEB = process.env.REVIEW_WEB ?? "http://127.0.0.1:3030";

export function loadSession(): Session {
  const folder = new URL("tmp/review-states/", ROOT);
  let file = process.env.REVIEW_SESSION;
  if (file === undefined) {
    const named = process.env.REVIEW_DB;
    const found = existsSync(folder)
      ? readdirSync(folder).filter((name) => name.endsWith(".json"))
      : [];
    const pick =
      named === undefined ? found : found.filter((n) => n === `${named}.json`);
    if (pick.length !== 1) {
      throw new Error(
        `name the seeded database with REVIEW_DB (session files: ${found.join(", ") || "none"}; ` +
          "seed one with scripts/seed_review_states.py)",
      );
    }
    file = fileURLToPath(new URL(pick[0] as string, folder));
  }
  const session = JSON.parse(readFileSync(file, "utf8")) as Session;
  checkTarget(session);
  return session;
}

/** The web server the checks drive must be this machine's scratch server for the
 * session's own database: 127.0.0.1, never the development stack's ports, and a
 * scratch_stack.py record of this checkout serving that database on that port. */
export function checkTarget(session: Session, web: string = WEB): void {
  const url = new URL(web);
  if (url.hostname !== "127.0.0.1") {
    throw new Error(
      `REVIEW_WEB must be http://127.0.0.1:<port>, not ${url.host}`,
    );
  }
  if (url.port === "" || url.port === "3000" || url.port === "8000") {
    throw new Error(`port ${url.port || "80"} is not a scratch server's port`);
  }
  const record = new URL(`tmp/scratch-stack/web-${url.port}.json`, ROOT);
  if (!existsSync(record)) {
    throw new Error(
      `no scratch web server is recorded on :${url.port} (scripts/scratch_stack.py start)`,
    );
  }
  const served = (JSON.parse(readFileSync(record, "utf8")) as { db?: string })
    .db;
  if (served !== session.db) {
    throw new Error(
      `:${url.port} serves ${served ?? "no recorded database"}, the session is for ${session.db}`,
    );
  }
}

export function state(session: Session, name: string): State {
  const found = session.states[name];
  if (found === undefined) {
    throw new Error(
      `the seeded database has no state ${name} (reseed from this checkout)`,
    );
  }
  return found;
}

export function launch(): Promise<Browser> {
  return chromium.launch({ channel: "chrome", headless: true });
}

export type Opened = { context: BrowserContext; page: Page; errors: string[] };

/** What the page reports going wrong, as it happens: uncaught errors, console errors and
 * React's defect warnings (rules.ts consoleProblem, with its allowlist). Each fails the
 * check's row it arrives before. */
export function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) =>
    errors.push(`page error: ${String(error).slice(0, 200)}`),
  );
  page.on("console", (message) => {
    const problem = consoleProblem(message.type(), message.text());
    if (problem !== null) errors.push(problem);
  });
  return errors;
}

/** How long a page is given to open its guide (ms). */
const GUIDE_WAIT = 2500;
/** A page has settled when none of its requests is open for this long (ms). */
const QUIET = 600;
const SETTLE_LIMIT = 30_000;
const pending = new WeakMap<Page, Set<unknown>>();

/** Wait until the page has no request open for QUIET ms (a refetch after an action, a
 * section that loads on its own), with the pointer moved off whatever it last clicked.
 * A page that never settles fails the check rather than being measured half loaded. */
export async function settle(page: Page): Promise<void> {
  const inflight = pending.get(page);
  if (inflight === undefined) {
    throw new Error("settle() needs a page made by open()");
  }
  await page.mouse.move(2, 2);
  const deadline = Date.now() + SETTLE_LIMIT;
  let quietSince = Date.now();
  while (Date.now() - quietSince < QUIET) {
    if (Date.now() > deadline) {
      throw new Error(`the page did not settle within ${SETTLE_LIMIT} ms`);
    }
    if (inflight.size > 0) {
      quietSince = Date.now();
    }
    await page.waitForTimeout(100);
  }
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      ),
  );
}

/** A state's page at one theme and width, signed in as the engagement's owner, loaded
 * until `ready` shows; the guide is skipped and the dev-server badge hidden. */
export async function open(
  browser: Browser,
  session: Session,
  name: string,
  combo: Combo,
  ready: string,
): Promise<Opened> {
  const context = await browser.newContext({
    viewport: { width: combo.width, height: combo.width < PHONE ? 844 : 900 },
    colorScheme: combo.theme,
    reducedMotion: "reduce",
  });
  await context.addCookies([
    { name: session.cookie, value: session.owner, url: WEB },
    { name: "aw_theme", value: combo.theme, url: WEB },
  ]);
  const page = await context.newPage();
  const errors = watch(page);
  const inflight = new Set<unknown>();
  page.on("request", (request) => inflight.add(request));
  page.on("requestfinished", (request) => inflight.delete(request));
  page.on("requestfailed", (request) => inflight.delete(request));
  pending.set(page, inflight);
  await page.goto(`${WEB}${state(session, name).url}`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .locator(ready)
    .first()
    .waitFor({ state: "visible", timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  // A first visit opens the page's guide a moment after the page shows; it is skipped as
  // a person would. Pages without a guide wait the moment and go on.
  const skip = page.getByRole("button", { name: /^Skip the guide/ }).first();
  const guided = await skip
    .waitFor({ state: "visible", timeout: GUIDE_WAIT })
    .then(() => true)
    .catch((error: unknown) => {
      if (error instanceof Error && error.name === "TimeoutError") return false;
      throw error;
    });
  if (guided) {
    await skip.click();
    await skip.waitFor({ state: "hidden" });
  }
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.mouse.move(2, 2);
  return { context, page, errors };
}

/** Where the keyboard focus is: "body" when nowhere. */
export function focusAt(page: Page): Promise<string> {
  return page.evaluate(() => {
    const a = document.activeElement;
    if (a === null || a === document.body) return "body";
    const label = (a.getAttribute("aria-label") || a.textContent || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 60);
    return `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ""} "${label}"`;
  });
}

/** The layout measurements: the page's width; what crosses the gutter; the containers
 * that scroll sideways though not declared to; what is wider than the container that clips
 * it (no ellipsis), and words in a table or label given no width. */
export async function measure(
  page: Page,
  scope: string,
  scrollers: readonly string[],
  focus: boolean,
): Promise<Measured> {
  const width = page.viewportSize()?.width ?? 0;
  const found = await page.evaluate(
    ({ scope, scrollers, gutter }) => {
      const declared = (n: Element) =>
        scrollers.some((s) => n.closest(s) !== null);
      const name = (n: Element) =>
        `${n.tagName.toLowerCase()}${[...n.classList]
          .slice(0, 2)
          .map((c) => `.${c}`)
          .join("")}`;
      const scrolls = (n: Element) => {
        const o = getComputedStyle(n).overflowX;
        return (
          (o === "auto" || o === "scroll" || o === "hidden") &&
          n.scrollWidth > n.clientWidth + 1
        );
      };
      const field = (n: Element) =>
        ["INPUT", "TEXTAREA", "SELECT"].includes(n.tagName);
      const undeclared: string[] = [];
      for (const n of document.querySelectorAll("body *")) {
        if (n.clientWidth === 0 || field(n) || n.closest(".react-flow"))
          continue;
        const o = getComputedStyle(n).overflowX;
        const sideways =
          n.scrollLeft > 0 ||
          ((o === "auto" || o === "scroll") &&
            n.scrollWidth > n.clientWidth + 1);
        if (sideways && !declared(n)) {
          undeclared.push(`${name(n)} ${n.scrollWidth}/${n.clientWidth}`);
        }
      }
      const vw = document.documentElement.clientWidth;
      const breaks: string[] = [];
      const clipped: string[] = [];
      const root = document.querySelector(scope) ?? document.body;
      const leaves = root.querySelectorAll(
        "p, li, h1, h2, h3, h4, label, button, summary, span, strong, small, a, textarea, input, dd, dt, td, th",
      );
      const said = (n: Element) =>
        `"${(n.textContent || "").trim().slice(0, 40)}"`;
      for (const n of leaves) {
        const r = n.getBoundingClientRect();
        const cs = getComputedStyle(n);
        // Not shown: hidden, or the body of a closed <details> (content-visibility).
        if (!n.checkVisibility({ visibilityProperty: true })) continue;
        if (n.closest(".react-flow, .sr-only, [aria-hidden=true]")) continue;
        const text = (n.textContent || "").trim();
        // A cell or label that holds words but was given no width: what it says is lost.
        if (
          text !== "" &&
          r.height > 0 &&
          r.width < 1 &&
          n.closest("table, label") !== null
        ) {
          const outer = n.parentElement?.getBoundingClientRect();
          if (outer === undefined || outer.width >= 1) {
            clipped.push(`${name(n)} is 0 px wide ${said(n)}`);
          }
          continue;
        }
        if (r.width === 0 || r.height === 0 || cs.position === "fixed")
          continue;
        // The first container that scrolls sideways holds what is wider than it (the
        // scroller is asserted on its own); a container that clips must hold all of it,
        // unless the text is cut with an ellipsis that actually shows. An ellipsis shows
        // only on the box whose own text overflows it (text-overflow on that box, with
        // its overflow clipped), or on a clipping box whose overflowing text is inline:
        // a block child's overflowing text is cut bare (19 November 2026: the withdrawn
        // reason, cut mid-word at 1440 under a cell that declared an ellipsis).
        const selfClips = cs.overflowX === "hidden" || cs.overflowX === "clip";
        let cut: Element | null = null;
        if (
          selfClips &&
          n.scrollWidth > n.clientWidth + 1 &&
          cs.textOverflow !== "ellipsis"
        ) {
          cut = n;
        }
        // How far the element's own content reaches (its text may overflow its box).
        const reach = selfClips
          ? r.right
          : r.left + Math.max(r.width, n.scrollWidth);
        // An absolutely positioned box (a menu panel) is clipped and scrolled only by its
        // containing block (offsetParent) and that block's ancestors, not by the boxes in
        // between: those are passed over until the containing block is reached.
        const escapes = (e: Element) =>
          getComputedStyle(e).position === "absolute" &&
          e instanceof HTMLElement;
        let until: Element | null = escapes(n)
          ? (n as HTMLElement).offsetParent
          : null;
        let a = n.parentElement;
        let scroller = false;
        while (a !== null && a !== document.body) {
          if (until !== null && a !== until) {
            if (escapes(a)) until = (a as HTMLElement).offsetParent;
            a = a.parentElement;
            continue;
          }
          until = null;
          if (escapes(a)) until = (a as HTMLElement).offsetParent;
          if (
            scrolls(a) &&
            ["auto", "scroll"].includes(getComputedStyle(a).overflowX)
          ) {
            scroller = true;
            break;
          }
          const o = getComputedStyle(a).overflowX;
          if (cut === null && (o === "hidden" || o === "clip")) {
            const b = a.getBoundingClientRect();
            const left = b.left + a.clientLeft;
            const right = left + a.clientWidth;
            const ellipsis =
              getComputedStyle(a).textOverflow === "ellipsis" &&
              cs.display === "inline";
            if ((reach > right + 1 || r.left < left - 1) && !ellipsis) cut = a;
          }
          a = a.parentElement;
        }
        if (scroller) continue;
        // A declared scroller may scroll sideways; what is inside it may still not be cut.
        if (cut !== null) {
          const b = cut.getBoundingClientRect();
          clipped.push(
            `${name(n)} [${Math.round(r.left)}-${Math.round(r.right)}] cut by ${name(cut)} [${Math.round(b.left)}-${Math.round(b.right)}] ${said(n)}`,
          );
          continue;
        }
        if (declared(n)) continue;
        if (r.left < gutter - 0.5 || r.right > vw - gutter + 0.5) {
          breaks.push(
            `${name(n)} [${Math.round(r.left)}-${Math.round(r.right)}] ${said(n)}`,
          );
        }
      }
      return {
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
        gutterBreaks: breaks.slice(0, 40),
        undeclaredScrollers: undeclared.slice(0, 40),
        clipped: clipped.slice(0, 40),
      };
    },
    { scope, scrollers: [...scrollers], gutter: 16 },
  );
  return { width, ...found, focus: focus ? await focusAt(page) : null };
}

/** The left and right edges of an element and of its container's content box. */
export function spans(
  page: Page,
  row: string,
  container: string,
): Promise<{ row: Box | null; inner: Box | null }> {
  return page.evaluate(
    ({ row, container }) => {
      const r = document.querySelector(row);
      const c = r?.closest(container) ?? document.querySelector(container);
      const edge = (left: number, right: number) => ({
        left: Math.round(left),
        right: Math.round(right),
        width: Math.round(right - left),
      });
      if (r === null || c === null || c === undefined)
        return { row: null, inner: null };
      const rb = r.getBoundingClientRect();
      const cb = c.getBoundingClientRect();
      const cs = getComputedStyle(c);
      return {
        row: edge(rb.left, rb.right),
        inner: edge(
          cb.left +
            Number.parseFloat(cs.paddingLeft) +
            Number.parseFloat(cs.borderLeftWidth),
          cb.right -
            Number.parseFloat(cs.paddingRight) -
            Number.parseFloat(cs.borderRightWidth),
        ),
      };
    },
    { row, container },
  );
}

/** The workspace shell's own sideways scroller: at phone width the sidebar's navigation
 * becomes one row that scrolls. Every other scroller is declared by the check. */
export const SHELL_SCROLLERS: readonly string[] = [
  '.sidebar nav[aria-label="Workspace"]',
];

/** What a check declares about one screen. */
export type Declared = {
  /** Where the copy is read and the gutter measured (default "main"). */
  scope?: string;
  /** Containers allowed to scroll sideways, such as a wide table's own scroller. */
  scrollers?: readonly string[];
  /** Rows that must span their container's full width, as [row, container] selectors. */
  spans?: readonly (readonly [string, string])[];
  /** One screen, one story: texts this screen shows, and texts that would contradict it,
   * read in storyScope (default: scope). */
  shows?: readonly (string | RegExp)[];
  never?: readonly (string | RegExp)[];
  storyScope?: string;
  /** Failures the check found itself (such as two counts that disagree). */
  extra?: readonly string[];
  /** A scripted action was just taken: the focus must not be left on the page body. */
  afterAction?: boolean;
};

export type Row = {
  spec: string;
  state: string;
  step: string;
  theme: Theme;
  width: number;
  shot: string;
  ok: boolean;
  failures: string[];
  measured: Measured;
  errors: string[];
};

/** Collects one spec file's checks and writes its summary, screenshots and changed list. */
export class Recorder {
  readonly rows: Row[] = [];
  readonly spec: string;
  constructor(spec: string) {
    this.spec = spec;
    mkdirSync(SHOTS, { recursive: true });
  }

  /** Measure the screen as declared, screenshot it, record the row; the failures. */
  async check(
    opened: Opened,
    name: string,
    step: string,
    combo: Combo,
    declared: Declared = {},
  ): Promise<string[]> {
    const { page } = opened;
    await settle(page);
    const scope = declared.scope ?? "main";
    const measured = await measure(
      page,
      scope,
      [...SHELL_SCROLLERS, ...(declared.scrollers ?? [])],
      declared.afterAction === true,
    );
    const text = await page.locator(scope).first().innerText();
    const actions = await page
      .locator(scope)
      .first()
      .locator("button, a, summary, [role=button], [role=tab], [role=menuitem]")
      .allInnerTexts();
    const story =
      declared.storyScope === undefined
        ? text
        : await page.locator(declared.storyScope).first().innerText();
    const failures = [
      ...layoutFindings(measured),
      ...copyFindings(text, actions),
      ...storyFindings(story, declared.shows ?? [], declared.never ?? []),
      ...(declared.extra ?? []),
      ...opened.errors,
    ];
    for (const [row, container] of declared.spans ?? []) {
      const edges = await spans(page, row, container);
      failures.push(...spanFindings(row, edges.row, edges.inner));
    }
    const shot = `${name}-${step}-${combo.theme}-${combo.width}.png`;
    await page.screenshot({
      path: fileURLToPath(new URL(shot, SHOTS)),
      fullPage: true,
      animations: "disabled",
      caret: "hide",
    });
    const row: Row = {
      spec: this.spec,
      state: name,
      step,
      theme: combo.theme,
      width: combo.width,
      shot,
      ok: failures.length === 0,
      // Its own copies: the caller adds later steps' failures to the array it gets back,
      // and a page's errors keep arriving after this step.
      failures: [...failures],
      measured,
      errors: [...opened.errors],
    };
    this.rows.push(row);
    console.log(
      JSON.stringify({
        check: `${name}/${step}`,
        at: `${combo.theme}-${combo.width}`,
        ok: row.ok,
        ...(row.ok ? {} : { failures }),
      }),
    );
    return failures;
  }

  /** Write <spec>.json and <spec>.changed.txt; with BROWSER_ACCEPT=1, mark them reviewed. */
  flush(): void {
    const path = (name: string) => fileURLToPath(new URL(name, OUT));
    const reviewedPath = path("reviewed.json");
    const reviewed: Record<string, string> = existsSync(reviewedPath)
      ? (JSON.parse(readFileSync(reviewedPath, "utf8")) as Record<
          string,
          string
        >)
      : {};
    const hashes: Record<string, string> = {};
    for (const row of this.rows) {
      const bytes = readFileSync(path(`shots/${row.shot}`));
      hashes[row.shot] = createHash("sha256").update(bytes).digest("hex");
    }
    const changed = Object.keys(hashes).filter(
      (shot) => reviewed[shot] !== hashes[shot],
    );
    writeFileSync(
      path(`${this.spec}.json`),
      `${JSON.stringify({ spec: this.spec, checks: this.rows.length, failed: this.rows.filter((r) => !r.ok).length, changed, rows: this.rows }, null, 2)}\n`,
    );
    writeFileSync(
      path(`${this.spec}.changed.txt`),
      changed.map((s) => `shots/${s}\n`).join(""),
    );
    if (process.env.BROWSER_ACCEPT === "1") {
      writeFileSync(
        reviewedPath,
        `${JSON.stringify({ ...reviewed, ...hashes }, null, 2)}\n`,
      );
    }
    console.log(
      JSON.stringify({
        spec: this.spec,
        checks: this.rows.length,
        failed: this.rows.filter((r) => !r.ok).length,
        changedShots: changed.length,
      }),
    );
  }
}
