import type { AgentSays as Says } from "./agent-says-model";
import { UiIcon } from "./ui-icon";

/**
 * The one agent block of the control workspace: what the agents did on this step, what
 * they propose and why, the records that support it, and whether a person's decision is
 * pending. A proposal is never shown as done; when the records give no basis, that is
 * said in place of a recommendation.
 */
export function AgentSays({ says }: { says: Says }) {
  const hasSomething =
    says.did.length > 0 ||
    says.recommends !== null ||
    says.decision !== null ||
    says.insufficient !== null;
  if (!hasSomething) {
    return null;
  }
  return (
    <section className="cw-agent" aria-labelledby="cw-agent-title">
      <p className="cw-agent-kicker" id="cw-agent-title">
        <UiIcon name="sparkles" size={13} />
        Agent says
      </p>
      <dl className="cw-agent-grid">
        {says.did.length > 0 ? (
          <>
            <dt>Did</dt>
            <dd>
              <ul>
                {says.did.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </dd>
          </>
        ) : null}
        {says.recommends !== null ? (
          <>
            <dt>Proposes</dt>
            <dd>
              <strong>{says.recommends}</strong>
              {says.because !== "" ? (
                <span className="cw-agent-because">
                  {" "}
                  because {says.because}
                </span>
              ) : (
                <span className="cw-agent-because">
                  {" "}
                  with no recorded reason.
                </span>
              )}
            </dd>
          </>
        ) : null}
        {says.insufficient !== null ? (
          <>
            <dt>{says.recommends === null ? "No proposal" : "Caveat"}</dt>
            <dd className="cw-agent-insufficient">{says.insufficient}</dd>
          </>
        ) : null}
        {says.supports.length > 0 ? (
          <>
            <dt>Based on</dt>
            <dd>
              <ul className="cw-agent-refs">
                {says.supports.map((ref) =>
                  ref.href !== null ? (
                    <li key={ref.label}>
                      <a href={ref.href}>{ref.label}</a>
                    </li>
                  ) : (
                    <li key={ref.label}>{ref.label}</li>
                  ),
                )}
              </ul>
            </dd>
          </>
        ) : null}
        {says.decision !== null ? (
          <>
            <dt>Decision</dt>
            <dd className="cw-agent-decision">{says.decision}</dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}
