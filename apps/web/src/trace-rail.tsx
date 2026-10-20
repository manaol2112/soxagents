import { type TraceNode, type TraceRow, traceSummary } from "./trace-model";
import { UiIcon } from "./ui-icon";

const STATE_ICON: Record<TraceNode["state"], "check" | "clock" | "info"> = {
  recorded: "check",
  partial: "clock",
  missing: "info",
};

const STATE_WORD: Record<TraceNode["state"], string> = {
  recorded: "on record",
  partial: "partly on record",
  missing: "not on record",
};

/**
 * The trace rail: the chain from control objective to independent review as compact
 * chips, each stating whether its record exists; open, the chain's records and each
 * attribute's evidence and results. No link is drawn without a record behind it.
 */
export function TraceRail({
  nodes,
  rows,
}: {
  nodes: TraceNode[];
  rows: TraceRow[];
}) {
  return (
    <details className="cw-trace">
      <summary>
        <span className="cw-trace-title">Trace</span>
        <ol className="cw-trace-chain" aria-label="Traceability chain">
          {nodes.map((node) => (
            <li
              key={node.kind}
              className={`is-${node.state}`}
              title={`${node.label}: ${node.summary}`}
            >
              <UiIcon name={STATE_ICON[node.state]} size={11} />
              {node.label}
            </li>
          ))}
        </ol>
        <span className="cw-trace-note">{traceSummary(nodes)}</span>
      </summary>
      <div className="cw-trace-body">
        <ol className="cw-trace-nodes">
          {nodes.map((node) => (
            <li key={node.kind} className={`is-${node.state}`}>
              <span className="cw-trace-node-label">
                <UiIcon name={STATE_ICON[node.state]} size={12} />
                {node.href !== null ? (
                  <a href={node.href}>{node.label}</a>
                ) : (
                  node.label
                )}
                <small>{STATE_WORD[node.state]}</small>
              </span>
              <span className="cw-trace-node-summary">{node.summary}</span>
              {node.items.length > 1 ? (
                <ul className="cw-trace-node-items">
                  {node.items.slice(0, 6).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                  {node.items.length > 6 ? (
                    <li>… {node.items.length - 6} more</li>
                  ) : null}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
        {rows.length > 0 ? (
          <table className="cw-trace-table">
            <caption>
              Each attribute: the evidence its results cite, and what they found
            </caption>
            <thead>
              <tr>
                <th scope="col">Attribute</th>
                <th scope="col">Evidence cited</th>
                <th scope="col">Results</th>
                <th scope="col">Exceptions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.code}>
                  <td>
                    <strong>{row.code}</strong> {row.attribute}
                  </td>
                  <td>
                    {row.evidence.length > 0 ? row.evidence.join(", ") : "—"}
                  </td>
                  <td>
                    {row.pass + row.exceptions + row.unable + row.review === 0
                      ? "Not tested"
                      : `${row.pass} pass${row.exceptions > 0 ? `, ${row.exceptions} exception${row.exceptions === 1 ? "" : "s"}` : ""}${row.unable > 0 ? `, ${row.unable} insufficient` : ""}${row.review > 0 ? `, ${row.review} for review` : ""}${row.untested > 0 ? `, ${row.untested} untested` : ""}`}
                  </td>
                  <td>
                    {row.exceptionItems.length > 0
                      ? row.exceptionItems.join(", ")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </details>
  );
}
