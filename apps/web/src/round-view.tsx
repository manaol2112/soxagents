import { formatDate } from "./format";
import {
  basisWords,
  ofRound,
  ROUND_STATUS,
  roundNext,
  roundTitle,
  type TestRound,
} from "./round-model";
import type { TestSheet } from "./sheet-model";
import { TestSheetCard } from "./sheet-view";
import type { ControlTest } from "./testing-model";
import { TestPlanCard } from "./testing-view";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string; controlId: string };

/** The rounds after interim testing: roll-forward and remediation retests. */
export function TestRounds({
  rounds,
  tests,
  sheets,
  ids,
  canAct,
  today,
}: {
  rounds: TestRound[];
  tests: readonly ControlTest[] | null;
  sheets: readonly TestSheet[] | null;
  ids: Ids;
  canAct: boolean;
  today: string;
}) {
  if (rounds.length === 0) {
    return null;
  }
  return (
    <section className="test-rounds" aria-label="Roll-forward and retests">
      <h4>
        After interim testing
        <span className="view-count">{rounds.length}</span>
      </h4>
      {rounds.map((round) => {
        const test = ofRound(tests, round.id);
        const sheet = ofRound(sheets, round.id);
        const status = ROUND_STATUS[round.status];
        const open = round.status === "REQUESTED" || round.status === "TESTING";
        return (
          <article
            key={round.id}
            className={`card round-card round-${round.kind.toLowerCase()} ${open ? "" : "round-closed"}`}
          >
            <header className="round-head">
              <span className="round-mark" aria-hidden="true">
                <UiIcon
                  name={round.kind === "ROLLFORWARD" ? "arrow" : "retry"}
                  size={15}
                />
              </span>
              <div>
                <p className="round-kind">
                  {round.kind === "ROLLFORWARD" ? "Roll-forward" : "Retest"}
                </p>
                <h3>{roundTitle(round)}</h3>
              </div>
              <span className={`pill pill-dot ${status.tone}`}>
                {round.conclusion !== null
                  ? round.conclusion === "EFFECTIVE"
                    ? "Effective"
                    : "Not effective"
                  : status.label}
              </span>
            </header>
            <dl className="round-facts">
              <div>
                <dt>
                  {round.kind === "ROLLFORWARD" ? "Covers" : "After the fix"}
                </dt>
                <dd>
                  {formatDate(round.windowStart)} to{" "}
                  {formatDate(round.windowEnd)}
                </dd>
              </div>
              {round.kind === "RETEST" &&
              round.testFrom !== round.windowStart ? (
                <div>
                  <dt>Testable from</dt>
                  <dd>{formatDate(round.testFrom)}</dd>
                </div>
              ) : null}
              <div>
                <dt>Sample</dt>
                <dd>
                  {round.method === "TEST_OF_ONE"
                    ? "Tested once, from current evidence"
                    : `${round.sampleSize} item${round.sampleSize === 1 ? "" : "s"}`}
                </dd>
              </div>
              <div className="round-basis">
                <dt>Testing basis</dt>
                <dd>
                  {basisWords(round.basis)}
                  {open && round.basis?.stale === true && canAct ? (
                    <form
                      method="post"
                      action="/workspace/round-basis"
                      autoComplete="off"
                      className="round-basis-form"
                    >
                      <input
                        type="hidden"
                        name="organization_id"
                        value={ids.organizationId}
                      />
                      <input
                        type="hidden"
                        name="project_id"
                        value={ids.projectId}
                      />
                      <input
                        type="hidden"
                        name="control_id"
                        value={ids.controlId}
                      />
                      <input type="hidden" name="round_id" value={round.id} />
                      <input
                        type="hidden"
                        name="version"
                        value={round.version}
                      />
                      <label>
                        Why the round tests against the plan as approved now
                        <input
                          type="text"
                          name="reason"
                          maxLength={500}
                          placeholder="What changed in the plan, and why the round follows it"
                        />
                      </label>
                      <button
                        type="submit"
                        className="btn btn-secondary btn-sm"
                      >
                        Confirm the testing basis
                        {round.basis.currentPlanRevision !== null
                          ? ` (revision ${round.basis.currentPlanRevision})`
                          : ""}
                      </button>
                    </form>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>Request</dt>
                <dd>
                  {round.requestId === null ? (
                    "None drafted"
                  ) : (
                    <a
                      href={`/?organization=${ids.organizationId}&project=${ids.projectId}&section=evidence&tab=requests`}
                    >
                      {(round.requestStatus ?? "Draft")
                        .replace(/_/g, " ")
                        .toLowerCase()}
                    </a>
                  )}
                </dd>
              </div>
            </dl>
            <p className="round-next">
              <UiIcon name="info" size={13} /> {roundNext(round, today)}
            </p>
            {open && round.method === "SAMPLE" && test !== null ? (
              <div className="round-body">
                <TestPlanCard
                  test={test}
                  notice={null}
                  organizationId={ids.organizationId}
                  projectId={ids.projectId}
                  controlId={ids.controlId}
                  canAct={canAct}
                  sampled
                />
              </div>
            ) : null}
            {sheet !== null ? (
              <div className="round-body">
                <TestSheetCard
                  sheet={sheet}
                  notice={null}
                  ids={ids}
                  canAct={canAct}
                />
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
