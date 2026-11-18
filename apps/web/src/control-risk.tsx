import { PHASE_SHORT } from "./control-tabs-model";
import { type IconName, UiIcon } from "./ui-icon";

/** Each phase's mark on Why each phase applies. */
const PHASE_ICON: Record<string, IconName> = {
  DESIGN: "star",
  INTERIM: "activity",
  ROLLFORWARD: "retry",
};

type Fact = { label: string; value: string };

/** The tab's main column: the risk and objective, the scope, and why each phase applies. */
export function RiskScoping({
  risk,
  objective,
  statement,
  scope,
  phases,
}: {
  risk: string;
  objective: string;
  statement: string;
  /** The scope's facts, column by column. */
  scope: Fact[][];
  phases: ReadonlyArray<{ phase: string; label: string; rationale: string }>;
}) {
  const reasons = phases.filter((phase) => phase.rationale !== "");
  return (
    <>
      <section className="rs-card" aria-labelledby="rs-risk">
        <h2 id="rs-risk">
          <UiIcon name="shield" size={20} />
          Risk and objective
        </h2>
        <dl className="rs-rows">
          <div>
            <dt>Risk addressed</dt>
            <dd>{risk || "No risk is recorded for this control."}</dd>
          </div>
          <div>
            <dt>Control objective</dt>
            <dd>
              {objective ||
                "No objective yet. The planning agent drafts it with the test plan."}
            </dd>
          </div>
          <div>
            <dt>Control statement</dt>
            <dd>{statement || "No statement is recorded yet."}</dd>
          </div>
        </dl>
      </section>

      <section className="rs-card" aria-labelledby="rs-scope">
        <h2 id="rs-scope">
          <UiIcon name="layers" size={20} />
          Scope
        </h2>
        <div className="rs-scope">
          {scope.map((column) => (
            <dl key={column.map((fact) => fact.label).join("-")}>
              {column.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          ))}
        </div>
      </section>

      {reasons.length > 0 ? (
        <section className="rs-card" aria-labelledby="rs-why">
          <h2 id="rs-why">
            <UiIcon name="list" size={20} />
            Why each phase applies
          </h2>
          <ul className="rs-why">
            {reasons.map((phase) => (
              <li key={phase.phase}>
                <span className="rs-phase">
                  <UiIcon name={PHASE_ICON[phase.phase] ?? "star"} size={15} />
                  {phase.label || PHASE_SHORT[phase.phase] || phase.phase}
                </span>
                <span className="rs-reason">{phase.rationale}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
