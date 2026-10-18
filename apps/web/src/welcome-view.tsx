import { GoogleMark } from "./provider-marks";
import { UiIcon } from "./ui-icon";
import { WelcomeDemo } from "./welcome-demo";
import {
  type LibrarySummary,
  WELCOME_NOTICES,
  type WelcomeNotice,
} from "./welcome-model";
import { WelcomeReveal } from "./welcome-reveal";

const STEPS = [
  {
    n: "01",
    title: "Set up in an afternoon, not a quarter",
    text: "Upload the client's RCM in their own format or start from the reviewed library. The planner drafts the scope, the period, the request cadence, and a kickoff plan. You confirm.",
  },
  {
    n: "02",
    title: "Evidence arrives and is filed itself",
    text: "The evidence coordinator drafts every request, reads what comes back, classifies it, files it to the right control and application, and chases what is late.",
  },
  {
    n: "03",
    title: "Every sample tested, every result cited",
    text: "Testers select samples, test each one against the control's attributes, and cite the exact passage they relied on, boxed on the screenshot. Exceptions become drafted deficiencies.",
  },
  {
    n: "04",
    title: "An independent reviewer, then your sign-off",
    text: "A second agent re-performs the testing without seeing the first result and raises notes. A person with the reviewer role decides every note and signs off. Nobody reviews their own work.",
  },
] as const;

const FEATURES = [
  {
    icon: "sparkles",
    title: "Agent console",
    text: "Ask in plain language. Routine work runs at once; anything that reaches a client or signs off waits for your approval, step by step.",
  },
  {
    icon: "inbox",
    title: "Evidence that files itself",
    text: "Drop a folder. Each file is read, classified, matched to its control, tagged with the application it shows, and tested against the open request.",
  },
  {
    icon: "copy",
    title: "Citations you can click",
    text: "Every answer and every test result points at the file, page, and words it rests on. A quote that is not in the file is dropped before you ever see it.",
  },
  {
    icon: "table",
    title: "Testing engine",
    text: "Seeded random samples, population checks, attributes tested per sample with zero tolerance, and a conclusion derived from the results, never typed.",
  },
  {
    icon: "shield",
    title: "Independent review",
    text: "The reviewer agent re-performs the testing and checks the sample, the workpapers, and the deficiency decision. Must-fix notes reopen the work.",
  },
  {
    icon: "grid",
    title: "Workpapers, ready to export",
    text: "One workbook per control, with design, interim testing, and roll-forward tabs, filled from the records, versioned on every change, prepared with a sign-off, and exported as a binder.",
  },
] as const;

const ROSTER = [
  ["Engagement planner", "Turns scope into a plan"],
  ["Evidence coordinator", "Requests, reads, files, chases"],
  ["ITGC tester · access", "Provisioning, privileged access, reviews"],
  ["ITGC tester · change", "Requests, testing, approvals, emergency changes"],
  ["ITGC tester · operations", "Jobs, backups, incidents"],
  ["Business process tester", "Entity-level, cycles, ITACs, key reports"],
  ["Independent reviewer", "Re-performs, raises notes"],
  ["Reporting analyst", "Drafts findings and the report"],
] as const;

const FAQ = [
  {
    q: "Do the agents email our clients?",
    a: "Not unless you turn it on. Live email stays off until it is deliberately configured, and even then every message is drafted, submitted, and approved by a person before it leaves.",
  },
  {
    q: "Can an agent sign anything off?",
    a: "No. Agents propose. Sign-offs on testing, workpapers, reviews, and deficiencies are made by named people, and the reviewer can never be the person who did the work.",
  },
  {
    q: "How do I know a citation is real?",
    a: "Each quote is looked up in the stored text of that file, in this engagement only, before it is kept. The preview opens the file on that page with the passage outlined.",
  },
  {
    q: "Where does our data live?",
    a: "Business records live in PostgreSQL; files live in S3-compatible storage with an immutable custody record. Development uses mock providers and synthetic data, never client evidence.",
  },
  {
    q: "Can we use our own RCM and templates?",
    a: "Yes. Upload the client's RCM in any column layout, confirm the mapping, and keep their terms next to the standard ones. Workpaper templates are previewed with a real control before you confirm them.",
  },
] as const;

export function WelcomePage({
  notice,
  googleHref,
  library,
}: {
  notice: WelcomeNotice | null;
  /** The Google sign-in link, or null when Google sign-in is not configured. */
  googleHref: string | null;
  /** The library's figures from the API; the strip leaves them out when unknown. */
  library: LibrarySummary | null;
}) {
  return (
    <div className="lp">
      <WelcomeReveal />
      <a className="skip" href="#product">
        Skip to content
      </a>
      <header className="lp-nav">
        <a className="lp-brand" href="/welcome">
          <span className="lp-logo" aria-hidden="true">
            <UiIcon name="logo" size={18} />
          </span>
          AI Workforce
        </a>
        <nav className="lp-nav-links" aria-label="Page">
          <a href="#product">Product</a>
          <a href="#how">How it works</a>
          <a href="#trust">Trust</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="lp-nav-actions">
          <a className="lp-btn lp-btn-ghost" href="/sign-in">
            Sign in
          </a>
          <a className="lp-btn lp-btn-primary" href="#demo">
            Request a demo
          </a>
        </div>
      </header>

      <section className="lp-hero" id="top">
        <div className="lp-aurora" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="lp-grid" aria-hidden="true" />
        <div className="lp-hero-inner">
          <div className="lp-hero-copy" data-reveal>
            <p className="lp-eyebrow">
              <span className="lp-eyebrow-dot" />
              Now with independent review by agents
            </p>
            <h1>
              Your SOX audit, delivered by an{" "}
              <span className="lp-gradient">AI workforce</span>.
            </h1>
            <p className="lp-lead">
              Agents request the evidence, test every control, cite the exact
              passage they relied on, and bring every sign-off back to a person.
              You run the engagement. They do the work.
            </p>
            <div className="lp-hero-actions">
              <a className="lp-btn lp-btn-primary lp-btn-lg" href="#demo">
                Request a demo
                <UiIcon name="arrow" size={16} />
              </a>
              {googleHref !== null ? (
                <a className="lp-btn lp-btn-white lp-btn-lg" href={googleHref}>
                  <GoogleMark size={18} />
                  Sign up with Google
                </a>
              ) : (
                <a className="lp-btn lp-btn-glass lp-btn-lg" href="#how">
                  See how it works
                </a>
              )}
            </div>
            <ul className="lp-hero-proof">
              <li>
                <UiIcon name="check" size={13} />
                Human approval on every client-facing step
              </li>
              <li>
                <UiIcon name="check" size={13} />
                Every citation checked against the file
              </li>
              <li>
                <UiIcon name="check" size={13} />A full audit trail, by design
              </li>
            </ul>
          </div>
          <div className="lp-hero-demo" data-reveal>
            <WelcomeDemo />
            <div className="lp-float lp-float-a">
              <span className="lp-float-icon">
                <UiIcon name="shield" size={14} />
              </span>
              <span>
                <strong>Independent review</strong>
                <small>3 notes proposed · 1 must fix</small>
              </span>
            </div>
            <div className="lp-float lp-float-b">
              <span className="lp-float-icon is-green">
                <UiIcon name="check" size={14} />
              </span>
              <span>
                <strong>Citation checked</strong>
                <small>Page 1 · “at least 12 characters”</small>
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-strip" aria-label="What is inside">
        <ul>
          {library !== null ? (
            <>
              <li>
                <strong>{library.controls}</strong>
                <span>reviewed controls in the library</span>
              </li>
              <li>
                <strong>{library.areas}</strong>
                <span>control areas, ITGC to business cycles</span>
              </li>
              <li>
                <strong>{library.agents}</strong>
                <span>agents, each with a bounded job</span>
              </li>
            </>
          ) : null}
          <li>
            <strong>100%</strong>
            <span>of citations checked before they are shown</span>
          </li>
        </ul>
      </section>

      <section className="lp-section" id="product">
        <div className="lp-section-head" data-reveal>
          <p className="lp-kicker">The product</p>
          <h2>Everything an audit team does, with the busywork handed over.</h2>
          <p>
            Built for IT SOX and IT audit first: planning, evidence requests,
            testing, independent review, and workpapers in one place, with
            people deciding what matters.
          </p>
        </div>
        <ul className="lp-features">
          {FEATURES.map((feature, index) => (
            <li
              key={feature.title}
              data-reveal
              style={{ transitionDelay: `${index * 60}ms` }}
            >
              <span className="lp-feature-icon">
                <UiIcon name={feature.icon} size={18} />
              </span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="lp-section lp-section-tint" id="how">
        <div className="lp-section-head" data-reveal>
          <p className="lp-kicker">How it works</p>
          <h2>From kickoff to sign-off, four moves.</h2>
        </div>
        <ol className="lp-steps">
          {STEPS.map((step, index) => (
            <li
              key={step.n}
              data-reveal
              style={{ transitionDelay: `${index * 80}ms` }}
            >
              <span className="lp-step-n">{step.n}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="lp-section lp-section-dark" id="trust">
        <div className="lp-aurora is-soft" aria-hidden="true">
          <span />
          <span />
        </div>
        <div className="lp-section-head" data-reveal>
          <p className="lp-kicker">Built for trust</p>
          <h2>Agents propose. People decide.</h2>
          <p>
            Every consequential action is a step a named person confirms, every
            claim points at its evidence, and every change is on the record.
          </p>
        </div>
        <ul className="lp-trust">
          <li data-reveal>
            <span className="lp-trust-icon">
              <UiIcon name="check" size={18} />
            </span>
            <h3>Approval on every step that matters</h3>
            <p>
              Sending a request, approving samples, signing off testing, logging
              a deficiency: the agent proposes the step and it runs as you,
              through the same checks as the page, only when you confirm.
            </p>
          </li>
          <li data-reveal style={{ transitionDelay: "80ms" }}>
            <span className="lp-trust-icon">
              <UiIcon name="copy" size={18} />
            </span>
            <h3>Citations that are checked, not trusted</h3>
            <p>
              A quote is kept only if the words are in the file's stored text. A
              screenshot citation needs a box inside the image. What you see is
              what the file says.
            </p>
          </li>
          <li data-reveal style={{ transitionDelay: "160ms" }}>
            <span className="lp-trust-icon">
              <UiIcon name="shield" size={18} />
            </span>
            <h3>Segregation of duties, enforced</h3>
            <p>
              The reviewer never signs off work they prepared. Severe
              deficiencies need the reviewer. Nobody approves their own request.
              The audit trail records who, what, and when.
            </p>
          </li>
        </ul>
      </section>

      <section className="lp-section" id="workforce">
        <div className="lp-section-head" data-reveal>
          <p className="lp-kicker">The workforce</p>
          <h2>
            Eight agents. Each with one job and a short list of allowed actions.
          </h2>
          <p>
            No agent can change its own permissions, run an unregistered tool,
            or send mail outside the firm. Listing an action does not bypass
            policy.
          </p>
        </div>
        <ul className="lp-roster">
          {ROSTER.map(([name, job], index) => (
            <li
              key={name}
              data-reveal
              style={{ transitionDelay: `${index * 40}ms` }}
            >
              <span className="lp-roster-mark" aria-hidden="true">
                {name
                  .split(/[\s·]+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((word) => word[0]?.toUpperCase())
                  .join("")}
              </span>
              <strong>{name}</strong>
              <span>{job}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="lp-section lp-section-tint" id="faq">
        <div className="lp-section-head" data-reveal>
          <p className="lp-kicker">Questions</p>
          <h2>The ones every audit partner asks first.</h2>
        </div>
        <div className="lp-faq" data-reveal>
          {FAQ.map((item) => (
            <details key={item.q}>
              <summary>
                {item.q}
                <UiIcon name="chevron" size={16} />
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="lp-section lp-cta" id="demo">
        <div className="lp-cta-inner" data-reveal>
          <div className="lp-cta-copy">
            <p className="lp-kicker">See it on your own controls</p>
            <h2>Request a demo.</h2>
            <p>
              Bring a real RCM. We'll set up an engagement with you, run the
              agents on synthetic evidence, and walk through testing, review,
              and workpapers end to end.
            </p>
            <ul className="lp-cta-points">
              <li>
                <UiIcon name="check" size={14} /> 45 minutes, your team's
                questions
              </li>
              <li>
                <UiIcon name="check" size={14} /> No client data needed
              </li>
              <li>
                <UiIcon name="check" size={14} /> A reply within two working
                days
              </li>
            </ul>
          </div>
          <form className="lp-form" method="post" action="/welcome/demo">
            {notice !== null ? (
              <p
                className={`lp-form-notice${notice === "sent" ? " is-good" : " is-warn"}`}
                role="status"
              >
                <UiIcon name={notice === "sent" ? "check" : "info"} size={14} />
                {WELCOME_NOTICES[notice]}
              </p>
            ) : null}
            <div className="lp-form-row">
              <label>
                Name
                <input
                  name="name"
                  required
                  maxLength={200}
                  autoComplete="name"
                />
              </label>
              <label>
                Work email
                <input
                  name="email"
                  type="email"
                  required
                  maxLength={200}
                  autoComplete="email"
                />
              </label>
            </div>
            <label>
              Firm
              <input name="firm" maxLength={200} autoComplete="organization" />
            </label>
            <label>
              What are you auditing?
              <textarea
                name="message"
                rows={3}
                maxLength={2000}
                placeholder="Systems, number of engagements, what slows you down today"
              />
            </label>
            <div className="lp-honey" aria-hidden="true">
              <label>
                Website
                <input name="website" tabIndex={-1} autoComplete="off" />
              </label>
            </div>
            <button type="submit" className="lp-btn lp-btn-primary lp-btn-lg">
              Request a demo
              <UiIcon name="arrow" size={16} />
            </button>
            <p className="lp-form-fine">
              We only use this to reply. No credentials, no client data.
            </p>
            {googleHref !== null ? (
              <p className="lp-form-alt">
                Prefer to try it now?{" "}
                <a href={googleHref}>
                  <GoogleMark size={14} />
                  Sign up with Google
                </a>{" "}
                and your workspace is ready in a minute.
              </p>
            ) : null}
          </form>
        </div>
      </section>

      <footer className="lp-footer">
        <div>
          <span className="lp-logo" aria-hidden="true">
            <UiIcon name="logo" size={16} />
          </span>
          <span>AI Workforce</span>
        </div>
        <p>AI employees for SOX and IT audit delivery.</p>
        <nav aria-label="Footer">
          <a href="#product">Product</a>
          <a href="#trust">Trust</a>
          <a href="#faq">FAQ</a>
          <a href="/sign-in">Sign in</a>
        </nav>
      </footer>
    </div>
  );
}
