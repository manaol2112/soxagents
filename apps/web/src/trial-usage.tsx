import {
  AI_REACHED_COPY,
  aiAllowanceReached,
  standing,
  TRIAL_ENDED_COPY,
  type TrialUsage,
  usageMeters,
} from "./trial-usage-model";
import { UiIcon } from "./ui-icon";

/**
 * Settings › Free trial (Step 6): the trial's standing, then each allowance beside what
 * the firm has used of it, every figure from the subscription route. Compact meters,
 * one card; the plans link is the only way on. Nothing here is worked out in the page.
 */
export function TrialUsageMain({
  usage,
  organizationName,
}: {
  usage: TrialUsage | null;
  organizationName: string;
}) {
  if (usage === null) {
    return (
      <div className="page">
        <section className="card tu-card">
          <h2>Your free trial</h2>
          <p className="form-hint" role="alert">
            The trial's usage could not be read. Reload the page to try again.
          </p>
        </section>
      </div>
    );
  }
  const state = standing(usage);
  const meters = usageMeters(usage);
  const ended = usage.state === "TRIAL_EXPIRED";
  const reached = !ended && aiAllowanceReached(usage);
  return (
    <div className="page">
      <section className="card tu-card" aria-labelledby="tu-title">
        <header className="tu-head">
          <div>
            <p className="page-context">{organizationName}</p>
            <h2 id="tu-title">Your free trial</h2>
          </div>
          <span className={`tu-standing tone-${state.tone}`}>
            <UiIcon name="clock" size={14} />
            <strong>{state.title}</strong>
            {state.detail !== "" ? <span>· {state.detail}</span> : null}
          </span>
        </header>
        {ended ? (
          <div className="tu-notice tone-danger" role="status">
            <div>
              <strong>{TRIAL_ENDED_COPY.title}</strong>
              <p>{TRIAL_ENDED_COPY.body}</p>
            </div>
            <a className="btn" href={TRIAL_ENDED_COPY.href}>
              {TRIAL_ENDED_COPY.action} <UiIcon name="arrow" size={13} />
            </a>
          </div>
        ) : reached ? (
          <div className="tu-notice tone-warning" role="status">
            <div>
              <strong>{AI_REACHED_COPY.title}</strong>
              <p>{AI_REACHED_COPY.body}</p>
            </div>
            <a className="btn" href={AI_REACHED_COPY.href}>
              {AI_REACHED_COPY.action} <UiIcon name="arrow" size={13} />
            </a>
          </div>
        ) : null}
        <ul className="tu-meters">
          {meters.map((item) => (
            <li key={item.key} className={`tu-meter tone-${item.tone}`}>
              <div className="tu-meter-head">
                <span className="tu-meter-label">{item.label}</span>
                <span className="tu-meter-words">{item.words}</span>
              </div>
              {item.share !== null ? (
                <div className="tu-bar" aria-hidden="true">
                  <span style={{ width: `${Math.round(item.share * 100)}%` }} />
                </div>
              ) : null}
              <p className="tu-meter-note">{item.note}</p>
            </li>
          ))}
        </ul>
        <footer className="tu-foot">
          <p>
            Figures are the server's, read when this page opened. Spend is
            estimated from the model's own prices; the trial's dates and
            allowances never change with a demo reset.
          </p>
          <a className="btn btn-secondary" href={TRIAL_ENDED_COPY.href}>
            Explore plans <UiIcon name="arrow" size={13} />
          </a>
        </footer>
      </section>
    </div>
  );
}
