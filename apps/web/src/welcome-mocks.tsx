import { UiIcon } from "./ui-icon";

// The landing page's product views, drawn in code from the workspace's own concepts (the
// product owner's references, 27 October 2026). Every name and figure is synthetic; each
// view is captioned as an illustration. Nothing here claims a feature the product lacks:
// the agents, the steps, the citation check, the independent re-performance and the
// person's sign-off are all the product's.

type Agent = "planner" | "coordinator" | "tester" | "reviewer";

/** An agent's mark: a faceted gem in the agent's colour. */
export function Gem({ agent, size = 36 }: { agent: Agent; size?: number }) {
  return (
    <span
      className={`lp-gem is-${agent}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

/** The hero's artwork: the five steps of a control as orbs around the workpaper (the
 * product owner's reference, 27 October 2026). Each label is wired to its orb; every
 * point is in the artwork's own pixels (1472 × 941), so the labels, the lines and the orbs
 * stay aligned at every size. A label on the left side ends at its point. */
export const CYCLE = { width: 1472, height: 941 } as const;

/** The cycle drawn in code behind the artwork, in its pixels: the ring's arcs from one orb
 * to the next (Plan, Request evidence, Test, Independent review, Human sign-off, and back),
 * the spokes from the workpaper to each orb, and the outer orbit with its points. */
export const CYCLE_RING = {
  center: [736, 512],
  // Each orb's centre, for its glow; the workpaper's, for the core.
  orbs: [
    [735, 165],
    [1056, 403],
    [988, 754],
    [483, 753],
    [415, 403],
  ],
  core: [732, 521],
  // The green seal on the workpaper, which bursts at sign-off.
  seal: [812, 615],
  arcs: [
    "M864.5 190.7 A346 346 0 0 1 999.9 288.2",
    "M1081.3 534.3 A346 346 0 0 1 1057.3 640.5",
    "M877.8 827.6 A346 346 0 0 1 595.3 828.1",
    "M415.2 641.6 A346 346 0 0 1 390.7 533.7",
    "M472.5 287.8 A346 346 0 0 1 605.3 191.6",
  ],
  spokes: [
    "M735.4 336.0 L735.2 288.0",
    "M903.1 456.7 L948.7 441.7",
    "M863.0 633.8 L897.7 667.0",
    "M609.4 634.3 L574.9 667.6",
    "M569.0 456.4 L523.5 441.3",
  ],
  dots: [
    [972.3, 184.3],
    [1120.9, 634.8],
    [807.5, 909.6],
    [335.9, 568.2],
    [500.8, 183.5],
  ],
} as const;

export const CYCLE_STEPS = [
  {
    key: "plan",
    label: "Plan",
    lines: ["Plan"],
    side: "right",
    wire: { from: [868, 110], to: [935, 110] },
    tone: "is-blue",
  },
  {
    key: "request",
    label: "Request evidence",
    lines: ["Request", "evidence"],
    side: "right",
    wire: { from: [1188, 375], to: [1245, 375] },
    tone: "is-blue",
  },
  {
    key: "test",
    label: "Test",
    lines: ["Test"],
    side: "right",
    wire: { from: [1120, 755], to: [1185, 755] },
    tone: "is-green",
  },
  {
    key: "review",
    label: "Independent review",
    lines: ["Independent", "review"],
    side: "left",
    wire: { from: [352, 770], to: [292, 770] },
    tone: "is-violet",
  },
  {
    key: "signoff",
    label: "Human sign-off",
    lines: ["Human", "sign-off"],
    side: "left",
    wire: { from: [282, 395], to: [222, 395] },
    tone: "is-green",
  },
] as const;

/** Mission control: the engagement's plan, the agents at work, and each control's state. */
export function MissionControl() {
  const plan = [
    ["Scope the engagement", "Systems, processes and controls", "done"],
    ["Plan every control", "Procedures, attributes and evidence", "done"],
    ["Request the evidence", "Grouped by owner and phase", "now"],
    ["Test and challenge", "Every sample, re-performed", "next"],
    ["Conclude and sign off", "A person signs every step", "next"],
  ] as const;
  const activity = [
    [
      "planner",
      "Engagement planner",
      "Drafting the plan for ITGC-CM-02",
      62,
      "2 min ago",
    ],
    [
      "tester",
      "ITGC tester",
      "Testing 25 samples on ITGC-AC-01",
      74,
      "4 min ago",
    ],
    [
      "reviewer",
      "Independent reviewer",
      "Re-performing ITGC-AC-02",
      38,
      "6 min ago",
    ],
  ] as const;
  const controls = [
    [
      "ITGC-AC-01",
      "New access is approved",
      "Key control · Operating",
      "Testing",
      "is-green",
    ],
    [
      "ITGC-AC-02",
      "Leavers removed on time",
      "Key control · Operating",
      "In review",
      "is-blue",
    ],
    [
      "ITGC-CM-01",
      "Changes are approved",
      "Key control · Design",
      "Testing",
      "is-green",
    ],
    [
      "ITGC-OP-01",
      "Backups are monitored",
      "Operating",
      "Not started",
      "is-idle",
    ],
    [
      "ITAC-01",
      "Three-way match",
      "Application control",
      "Not started",
      "is-idle",
    ],
  ] as const;
  return (
    <div className="lp-app lp-mission">
      <aside className="lp-app-side" aria-hidden="true">
        <span className="lp-app-logo">
          <UiIcon name="logo" size={15} />
        </span>
        {(
          [
            ["grid", "Mission control"],
            ["file", "Test plans"],
            ["shield", "Controls"],
            ["inbox", "Requests"],
            ["table", "Testing"],
            ["layers", "Evidence"],
            ["agents", "Review"],
            ["copy", "Reports"],
          ] as const
        ).map(([icon, label], index) => (
          <span key={label} className={index === 0 ? "is-on" : ""}>
            <UiIcon name={icon} size={14} />
            {label}
          </span>
        ))}
      </aside>
      <div className="lp-app-main">
        <div className="lp-app-top">
          <div>
            <small>Audit agents</small>
            <strong>Mission control</strong>
          </div>
          <span className="lp-app-select">
            SOX FY27 engagement
            <UiIcon name="chevron" size={12} />
          </span>
          <span className="lp-app-live">
            <i />
            In progress
          </span>
        </div>
        <div className="lp-app-panels">
          <section>
            <h4>
              <UiIcon name="file" size={14} />
              Audit plan
            </h4>
            <ol className="lp-mc-plan">
              {plan.map(([title, detail, state]) => (
                <li key={title} className={`is-${state}`}>
                  <span className="lp-mc-dot">
                    {state === "done" ? (
                      <UiIcon name="check" size={11} />
                    ) : null}
                  </span>
                  <span>
                    <b>{title}</b>
                    <small>{detail}</small>
                  </span>
                </li>
              ))}
            </ol>
          </section>
          <section>
            <h4>
              <UiIcon name="activity" size={14} />
              Agent activity
            </h4>
            <ul className="lp-mc-activity">
              {activity.map(([agent, name, task, done, when]) => (
                <li key={name}>
                  <Gem agent={agent} size={34} />
                  <span>
                    <b>
                      {name}
                      <small>{when}</small>
                    </b>
                    <small>{task}</small>
                    <i className={`lp-bar is-${agent}`}>
                      <i style={{ width: `${done}%` }} />
                    </i>
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h4>
              <UiIcon name="shield" size={14} />
              Control status
            </h4>
            <ul className="lp-mc-controls">
              {controls.map(([ref, title, kind, state, tone]) => (
                <li key={ref}>
                  <span>
                    <b>
                      {ref} · {title}
                    </b>
                    <small>{kind}</small>
                  </span>
                  <em className={tone}>
                    <i />
                    {state}
                  </em>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

/** One control in the workspace: its test sheet, and the agents' conversation beside it,
 * where the independent reviewer challenges a result. */
export function ControlRun() {
  const attributes = [
    ["file", "A request names the user and the access granted"],
    ["user", "The user's manager approved the request"],
    ["clock", "Approval is dated on or before the grant"],
    ["check", "Access granted matches the access approved"],
    ["shield", "The approver is not the person granted access"],
  ] as const;
  // Each sample's result per attribute: "ok", or "review" where the reviewer challenged.
  const samples: ReadonlyArray<
    readonly [string, ReadonlyArray<"ok" | "review">]
  > = [
    ["S-07", ["ok", "ok", "ok", "ok", "ok"]],
    ["S-14", ["ok", "ok", "review", "ok", "ok"]],
    ["S-21", ["ok", "ok", "ok", "ok", "ok"]],
  ];
  const controls = [
    ["AC-01", "New access is approved before it is granted"],
    ["AC-02", "Leavers are removed within two days"],
    ["AC-03", "Privileged access is reviewed quarterly"],
    ["CM-01", "Changes are approved before release"],
    ["CM-02", "Emergency changes are reviewed after"],
    ["OP-01", "Backups are monitored and restored"],
  ] as const;
  return (
    <div className="lp-app lp-run">
      <aside className="lp-run-list" aria-hidden="true">
        <p>
          Controls
          <UiIcon name="search" size={13} />
        </p>
        {controls.map(([ref, title], index) => (
          <span key={ref} className={index === 0 ? "is-on" : ""}>
            <i />
            <b>{ref}</b>
            {title}
          </span>
        ))}
      </aside>
      <div className="lp-run-main">
        <p className="lp-run-crumb">Controls / ITGC-AC-01</p>
        <div className="lp-run-title">
          <h4>New access is approved before it is granted</h4>
          <span className="lp-app-live">
            <i />
            In progress
          </span>
        </div>
        <p className="lp-run-desc">
          New or changed access to the ERP is requested in a ticket and approved
          by the user's manager before an administrator grants it.
        </p>
        <div className="lp-run-tabs" aria-hidden="true">
          <span className="is-on">Test sheet</span>
          <span>Test plan</span>
          <span>Evidence</span>
          <span>History</span>
        </div>
        <div className="lp-run-sheet">
          <div className="lp-run-sheet-head">
            <span>
              <b>Sample test results</b>
              <small>25 grants selected with a recorded seed from 412</small>
            </span>
            <em>3 of 25 shown</em>
          </div>
          <table>
            <thead>
              <tr>
                <th>Attribute</th>
                {samples.map(([id]) => (
                  <th key={id}>{id}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {attributes.map(([icon, text], row) => (
                <tr key={text}>
                  <td>
                    <UiIcon name={icon} size={13} />
                    <span>
                      <b>A{row + 1}</b> {text}
                    </span>
                  </td>
                  {samples.map(([id, results]) => (
                    <td key={id}>
                      <span
                        className={`lp-mark is-${results[row]}`}
                        role="img"
                        aria-label={
                          results[row] === "ok" ? "Pass" : "Needs review"
                        }
                      >
                        {results[row] === "ok" ? (
                          <UiIcon name="check" size={11} />
                        ) : (
                          "?"
                        )}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="lp-run-samples">
            {samples.map(([id, results]) => {
              const review = results.includes("review");
              return (
                <li key={id}>
                  <span>
                    <b>{id}</b>
                    <small>Access grant</small>
                  </span>
                  <em className={review ? "is-amber" : "is-green"}>
                    <i />
                    {review ? "Needs review" : "Passed"}
                  </em>
                  <a href="#trust" tabIndex={-1}>
                    View evidence
                    <UiIcon name="arrow" size={11} />
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <div className="lp-run-chat" data-reveal>
        <p className="lp-run-chat-head">
          Agent conversation
          <span className="lp-app-live">
            <i />
            Live
          </span>
        </p>
        <ol>
          <li>
            <Gem agent="coordinator" size={30} />
            <div>
              <p>
                <b>Evidence coordinator</b>
                <time>10:14</time>
              </p>
              <p>
                Filed 2 files from the process owner against request R-02 and
                checked the population against the system listing.
              </p>
              <span className="lp-file">
                <UiIcon name="table" size={13} />
                <span>
                  <b>access_grants_FY27.csv</b>
                  <small>System listing · 412 rows</small>
                </span>
              </span>
              <span className="lp-file">
                <UiIcon name="file" size={13} />
                <span>
                  <b>access_tickets_S01-S25.pdf</b>
                  <small>Ticket export · 25 tickets</small>
                </span>
              </span>
            </div>
          </li>
          <li>
            <Gem agent="tester" size={30} />
            <div>
              <p>
                <b>ITGC tester</b>
                <time>10:16</time>
              </p>
              <p>
                Tested 25 samples against 5 attributes, each result citing its
                passage. 24 pass; S-14 needs review on A3.
              </p>
              <span className="lp-file">
                <UiIcon name="copy" size={13} />
                <span>
                  <b>“Approved 14 Mar 2027 · Granted 12 Mar 2027”</b>
                  <small>
                    Cited in the S-14 ticket · checked against the file
                  </small>
                </span>
              </span>
            </div>
          </li>
          <li className="is-challenge">
            <Gem agent="reviewer" size={30} />
            <div>
              <p>
                <b>Independent reviewer</b>
                <time>10:18</time>
                <em>Challenged</em>
              </p>
              <p>
                Re-performed from the evidence. S-14: access was granted two
                days before it was approved. Must fix before sign-off.
              </p>
              <span className="lp-file">
                <UiIcon name="file" size={13} />
                <span>
                  <b>Review note RN-3</b>
                  <small>Evidence and reasoning · waits for a person</small>
                </span>
              </span>
            </div>
          </li>
        </ol>
        <p className="lp-run-ask">
          Ask a question or request more analysis…
          <span>
            <UiIcon name="arrow" size={13} />
          </span>
        </p>
      </div>
    </div>
  );
}

/** A workpaper as the reviewer reads it: objective, procedure, the cited evidence, the
 * results, and the review trail from the agent's work to a person's sign-off. */
export function Workpaper() {
  const evidence = [
    [
      "Access request ticket · S-14",
      "PDF · 2 pages",
      "“Approved by line manager on 14 Mar 2027”",
    ],
    [
      "System grant log",
      "CSV · 412 rows",
      "“granted 12 Mar 2027 09:42 by sysadmin”",
    ],
    [
      "Access management standard",
      "PDF · 6 pages",
      "“approval must precede any grant of access”",
    ],
  ] as const;
  const trail = [
    [
      "tester",
      "ITGC tester completed the procedure",
      "Agent · 20 Oct, 10:16",
      "Samples selected, evidence cited, results recorded.",
    ],
    [
      "reviewer",
      "Independent agent review",
      "Agent · 20 Oct, 11:02",
      "Re-performed every sample, validated the citations and the sampling.",
    ],
    [
      "person",
      "Human review",
      "Reviewer · 20 Oct, 14:37",
      "Decided 2 notes; the must-fix note reopened S-14.",
    ],
    [
      "signed",
      "Signed off",
      "Engagement lead · 21 Oct, 09:15",
      "Testing signed off, version 2.",
    ],
  ] as const;
  return (
    <div className="lp-app lp-wp">
      <div className="lp-wp-main">
        <div className="lp-wp-head">
          <span className="lp-wp-ref">ITGC-AC-01</span>
          <span className="lp-app-done">
            <UiIcon name="check" size={11} />
            Signed off
          </span>
        </div>
        <h4>New access is approved before it is granted</h4>
        <div className="lp-run-tabs" aria-hidden="true">
          <span className="is-on">Workpaper</span>
          <span>Evidence</span>
          <span>Results</span>
          <span>Review trail</span>
        </div>
        <div className="lp-wp-block">
          <UiIcon name="info" size={15} />
          <div>
            <b>Objective</b>
            <p>
              Access to the ERP is granted only after an authorised approval, so
              no one holds access the business did not intend.
            </p>
          </div>
        </div>
        <div className="lp-wp-block">
          <UiIcon name="table" size={15} />
          <div>
            <b>Procedure</b>
            <p>
              For each of 25 grants selected from the system's listing, inspect
              the ticket and confirm a manager approved it before the grant.
            </p>
          </div>
        </div>
        <div className="lp-wp-block">
          <UiIcon name="copy" size={15} />
          <div>
            <b>Cited evidence</b>
            <ul className="lp-wp-evidence">
              {evidence.map(([title, kind, quote]) => (
                <li key={title}>
                  <span>
                    <UiIcon name="file" size={13} />
                    <span>
                      <b>{title}</b>
                      <small>{kind}</small>
                    </span>
                  </span>
                  <q>{quote}</q>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <div className="lp-wp-trail">
        <p>Independent review trail</p>
        <ol>
          {trail.map(([kind, title, who, text]) => (
            <li key={title} className={`is-${kind}`}>
              <span className="lp-wp-node">
                {kind === "signed" ? (
                  <UiIcon name="check" size={12} />
                ) : kind === "person" ? (
                  <UiIcon name="user" size={12} />
                ) : (
                  <UiIcon name="sparkles" size={12} />
                )}
              </span>
              <span>
                <b>{title}</b>
                <small>{who}</small>
                <span>{text}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
