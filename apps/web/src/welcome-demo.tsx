"use client";

import { useEffect, useState } from "react";

import { UiIcon } from "./ui-icon";

/**
 * A scripted conversation that plays on the landing page: the question is typed, the
 * lead agent works, the answer lands with its citations, and a step waits for approval.
 * It loops, and it pauses when the person prefers reduced motion.
 */
const QUESTION =
  "Which Active Directory password settings fall short of our standard?";

const STAGES = [
  "typing",
  "thinking",
  "answer",
  "citations",
  "step",
  "approved",
  "rest",
] as const;
type Stage = (typeof STAGES)[number];

/** Each stage's dwell. Typing waits for the question to finish, then pauses this long. */
const DURATION: Record<Stage, number> = {
  typing: 600,
  thinking: 1800,
  answer: 1400,
  citations: 1600,
  step: 2600,
  approved: 2400,
  rest: 1200,
};

export function WelcomeDemo() {
  const [stage, setStage] = useState<Stage>("typing");
  const [typed, setTyped] = useState(0);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setStill(media.matches);
    const onChange = () => setStill(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (still) {
      setStage("step");
      setTyped(QUESTION.length);
      return;
    }
    if (stage === "typing" && typed < QUESTION.length) {
      return;
    }
    const timer = window.setTimeout(() => {
      const index = STAGES.indexOf(stage);
      const next = STAGES[(index + 1) % STAGES.length] ?? "typing";
      if (next === "typing") {
        setTyped(0);
      }
      setStage(next);
    }, DURATION[stage]);
    return () => window.clearTimeout(timer);
  }, [stage, typed, still]);

  useEffect(() => {
    if (stage !== "typing" || still) {
      return;
    }
    if (typed >= QUESTION.length) {
      return;
    }
    const timer = window.setTimeout(() => setTyped(typed + 1), 34);
    return () => window.clearTimeout(timer);
  }, [stage, typed, still]);

  const at = STAGES.indexOf(stage);
  const after = (name: Stage) => at >= STAGES.indexOf(name) && stage !== "rest";
  return (
    <div className="lp-demo" aria-hidden="true">
      <div className="lp-demo-head">
        <span className="lp-demo-orb">
          <UiIcon name="sparkles" size={13} />
        </span>
        <span>
          <strong>Lead agent</strong>
          <small>
            <i
              className={
                after("thinking") && !after("answer") ? "is-working" : ""
              }
            />
            {after("thinking") && !after("answer") ? "working" : "ready"}
          </small>
        </span>
        <span className="lp-demo-pill">SOX FY27 · ITGC</span>
      </div>
      <div className="lp-demo-body">
        <div className="lp-demo-user">
          {QUESTION.slice(0, typed)}
          {stage === "typing" ? <span className="lp-caret" /> : null}
        </div>
        {after("thinking") ? (
          <div className="lp-demo-agent">
            <span className="lp-demo-avatar">
              <UiIcon name="sparkles" size={11} />
            </span>
            <div>
              {!after("answer") ? (
                <p className="lp-demo-thinking">
                  <i />
                  <i />
                  <i />
                  Reading the policy and both screenshots
                </p>
              ) : (
                <>
                  <p>
                    Two fine-grained policies don't meet the standard. The
                    default domain policy does.{" "}
                    <span className="lp-cite">1</span>
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th>Attribute</th>
                        <th>Standard</th>
                        <th>Found</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Minimum length</td>
                        <td>12</td>
                        <td>
                          8 <span className="lp-cite">2</span>
                        </td>
                      </tr>
                      <tr>
                        <td>Maximum age</td>
                        <td>90 days</td>
                        <td>
                          180 days <span className="lp-cite">3</span>
                        </td>
                      </tr>
                      <tr>
                        <td>Lockout threshold</td>
                        <td>≤ 5</td>
                        <td>
                          0 <span className="lp-cite">4</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  {after("citations") ? (
                    <p className="lp-demo-sources">
                      <span>Sources</span>
                      <span className="lp-source">
                        <b>1</b> ISS-07_Password_Standard.pdf
                      </span>
                      <span className="lp-source">
                        <b>2 3 4</b> PWD-02_Fine_Grained_Policies.png
                      </span>
                    </p>
                  ) : null}
                  {after("step") ? (
                    <div
                      className={`lp-demo-step${after("approved") ? " is-done" : ""}`}
                    >
                      <span className="lp-demo-step-icon">
                        <UiIcon
                          name={after("approved") ? "check" : "risk"}
                          size={14}
                        />
                      </span>
                      <span>
                        <strong>Log a deficiency on ITGC-AC-05</strong>
                        <small>
                          {after("approved")
                            ? "Done · approved by you"
                            : "Waits for your approval"}
                        </small>
                      </span>
                      {after("approved") ? null : (
                        <span className="lp-demo-approve">Approve</span>
                      )}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
      <div className="lp-demo-foot">
        <span>Ask anything, or tell the agents what to do</span>
        <span className="lp-demo-send">
          <UiIcon name="arrow" size={14} />
        </span>
      </div>
    </div>
  );
}
