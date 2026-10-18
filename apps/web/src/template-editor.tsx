"use client";

import { useId, useState } from "react";

import {
  PERIOD_LABELS,
  SECTION_KINDS,
  type SetupTemplate,
  type TemplateSection,
} from "./onboarding-model";
import { SheetTabBar } from "./sheet-tabs";
import { UiIcon } from "./ui-icon";

type DraftTab = {
  id: number;
  title: string;
  period: string;
  sections: DraftSection[];
};

type DraftSection = TemplateSection & { id: number };

const PERIODS = Object.keys(PERIOD_LABELS);

let nextId = 1;
const id = (): number => nextId++;

function fromTemplate(template: SetupTemplate): DraftTab[] {
  return template.tabs.map((tab) => ({
    id: id(),
    title: tab.title,
    period: tab.period,
    sections: tab.sections.map((section) => ({ ...section, id: id() })),
  }));
}

function move<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) {
    return items;
  }
  const copy = [...items];
  const [item] = copy.splice(from, 1);
  if (item !== undefined) {
    copy.splice(to, 0, item);
  }
  return copy;
}

/**
 * The firm's template editor: tabs along the bottom like a workbook, the open tab's
 * sections above. Every change stays on the page until Save posts the whole template
 * as one JSON field; the server validates it again.
 */
export function TemplateEditor({
  organizationId,
  projectId,
  template,
  cancelHref,
}: {
  organizationId: string;
  projectId: string;
  template: SetupTemplate;
  cancelHref: string;
}) {
  const formId = useId();
  const [title, setTitle] = useState(template.title);
  const [tabs, setTabs] = useState<DraftTab[]>(() => fromTemplate(template));
  const [active, setActive] = useState(0);
  const tab = tabs[Math.min(active, tabs.length - 1)];
  const draft = JSON.stringify({
    title,
    tabs: tabs.map((item) => ({
      title: item.title,
      period: item.period,
      sections: item.sections.map(({ id: _id, ...section }) => section),
    })),
  });
  const complete =
    title.trim() !== "" &&
    tabs.length > 0 &&
    tabs.every(
      (item) =>
        item.title.trim() !== "" &&
        item.sections.length > 0 &&
        item.sections.every(
          (section) =>
            section.title.trim() !== "" &&
            (section.kind !== "table" || section.columns.length > 0),
        ),
    );

  const updateTab = (index: number, change: Partial<DraftTab>) =>
    setTabs((current) =>
      current.map((item, i) => (i === index ? { ...item, ...change } : item)),
    );
  const updateSection = (index: number, change: Partial<DraftSection>) => {
    if (tab === undefined) {
      return;
    }
    updateTab(tabs.indexOf(tab), {
      sections: tab.sections.map((section, i) =>
        i === index ? { ...section, ...change } : section,
      ),
    });
  };

  return (
    <section className="card template-editor" aria-labelledby="editor-title">
      <header className="card-header">
        <div>
          <h2 id="editor-title">Edit your firm's template</h2>
          <p className="card-desc">
            Rename the tabs and sections, change the guidance the preparer sees
            and the columns of each table, or add and remove sections. The
            header fields, the testing matrix, and the sign-off are filled from
            the records; a narrative is drafted by the agent and completed by a
            person.
          </p>
        </div>
      </header>
      <div className="card-body editor-body">
        <label className="field-wide" htmlFor={`${formId}-title`}>
          Template name
          <input
            autoComplete="off"
            id={`${formId}-title`}
            value={title}
            maxLength={200}
            required
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        {tab === undefined ? null : (
          <div className="workbook workbook-page editor-workbook">
            <div className="workbook-sheet editor-sheet">
              <div className="editor-tab-head">
                <label htmlFor={`${formId}-tab`}>
                  Tab name
                  <input
                    autoComplete="off"
                    id={`${formId}-tab`}
                    value={tab.title}
                    maxLength={200}
                    required
                    onChange={(event) =>
                      updateTab(tabs.indexOf(tab), {
                        title: event.target.value,
                      })
                    }
                  />
                </label>
                <label htmlFor={`${formId}-period`}>
                  Covers
                  <select
                    id={`${formId}-period`}
                    value={tab.period}
                    onChange={(event) =>
                      updateTab(tabs.indexOf(tab), {
                        period: event.target.value,
                      })
                    }
                  >
                    {PERIODS.map((period) => (
                      <option key={period} value={period}>
                        {PERIOD_LABELS[period]}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="editor-tab-actions">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={tabs.indexOf(tab) === 0}
                    onClick={() => {
                      const from = tabs.indexOf(tab);
                      setTabs(move(tabs, from, from - 1));
                      setActive(from - 1);
                    }}
                  >
                    Move left
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={tabs.indexOf(tab) === tabs.length - 1}
                    onClick={() => {
                      const from = tabs.indexOf(tab);
                      setTabs(move(tabs, from, from + 1));
                      setActive(from + 1);
                    }}
                  >
                    Move right
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={tabs.length <= 1}
                    onClick={() => {
                      const from = tabs.indexOf(tab);
                      setTabs(tabs.filter((_item, i) => i !== from));
                      setActive(Math.max(0, from - 1));
                    }}
                  >
                    Remove tab
                  </button>
                </div>
              </div>
              <ol className="editor-sections">
                {tab.sections.map((section, index) => (
                  <li key={section.id} className="editor-section">
                    <div className="editor-section-row">
                      <label
                        className="grow"
                        htmlFor={`${formId}-s${section.id}`}
                      >
                        Section
                        <input
                          autoComplete="off"
                          id={`${formId}-s${section.id}`}
                          value={section.title}
                          maxLength={200}
                          required
                          onChange={(event) =>
                            updateSection(index, { title: event.target.value })
                          }
                        />
                      </label>
                      <label htmlFor={`${formId}-k${section.id}`}>
                        Kind
                        <select
                          id={`${formId}-k${section.id}`}
                          value={section.kind}
                          onChange={(event) =>
                            updateSection(index, { kind: event.target.value })
                          }
                        >
                          {SECTION_KINDS.map(([kind, label]) => (
                            <option key={kind} value={kind}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="editor-section-actions">
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          aria-label={`Move ${section.title || "section"} up`}
                          disabled={index === 0}
                          onClick={() =>
                            updateTab(tabs.indexOf(tab), {
                              sections: move(tab.sections, index, index - 1),
                            })
                          }
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          aria-label={`Move ${section.title || "section"} down`}
                          disabled={index === tab.sections.length - 1}
                          onClick={() =>
                            updateTab(tabs.indexOf(tab), {
                              sections: move(tab.sections, index, index + 1),
                            })
                          }
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          aria-label={`Remove ${section.title || "section"}`}
                          disabled={tab.sections.length <= 1}
                          onClick={() =>
                            updateTab(tabs.indexOf(tab), {
                              sections: tab.sections.filter(
                                (_item, i) => i !== index,
                              ),
                            })
                          }
                        >
                          <UiIcon name="x" size={14} />
                        </button>
                      </div>
                    </div>
                    {section.kind === "fields" || section.kind === "signoff" ? (
                      <p className="form-hint">
                        {section.kind === "fields"
                          ? "Filled from the control's record: engagement, control, risk, activity, frequency, nature, owner, applications, and period end. A section named with “sample” holds the sample instead."
                          : "Prepared by and reviewed by, with the testing sign-off when there is one."}
                      </p>
                    ) : (
                      <label
                        className="field-wide"
                        htmlFor={`${formId}-g${section.id}`}
                      >
                        Guidance to the preparer
                        <textarea
                          autoComplete="off"
                          id={`${formId}-g${section.id}`}
                          rows={2}
                          maxLength={1000}
                          value={section.guidance}
                          onChange={(event) =>
                            updateSection(index, {
                              guidance: event.target.value,
                            })
                          }
                        />
                      </label>
                    )}
                    {section.kind === "table" || section.kind === "matrix" ? (
                      <label
                        className="field-wide"
                        htmlFor={`${formId}-c${section.id}`}
                      >
                        {section.kind === "matrix"
                          ? "Columns (the sample and one per attribute are added when the control's attributes are known)"
                          : "Columns, separated by commas"}
                        <input
                          autoComplete="off"
                          id={`${formId}-c${section.id}`}
                          value={section.columns.join(", ")}
                          required={section.kind === "table"}
                          onChange={(event) =>
                            updateSection(index, {
                              columns: event.target.value
                                .split(",")
                                .map((column) => column.trim())
                                .filter((column) => column !== "")
                                .slice(0, 20),
                            })
                          }
                        />
                      </label>
                    ) : null}
                    {section.kind === "table" ? (
                      <label
                        className="field-wide"
                        htmlFor={`${formId}-r${section.id}`}
                      >
                        Starter rows, one per line, cells separated by “|”
                        <textarea
                          autoComplete="off"
                          id={`${formId}-r${section.id}`}
                          rows={Math.min(6, section.rows.length + 1)}
                          value={section.rows
                            .map((row) => row.join(" | "))
                            .join("\n")}
                          onChange={(event) =>
                            updateSection(index, {
                              rows: event.target.value
                                .replace(/\r/g, "")
                                .split("\n")
                                .filter((line) => line.trim() !== "")
                                .slice(0, 30)
                                .map((line) =>
                                  line.split("|").map((cell) => cell.trim()),
                                ),
                            })
                          }
                        />
                      </label>
                    ) : null}
                  </li>
                ))}
              </ol>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() =>
                  updateTab(tabs.indexOf(tab), {
                    sections: [
                      ...tab.sections,
                      {
                        id: id(),
                        title: "",
                        kind: "guidance",
                        guidance: "",
                        columns: [],
                        rows: [],
                      },
                    ],
                  })
                }
              >
                <UiIcon name="plus" size={14} /> Add a section
              </button>
            </div>
            <SheetTabBar
              tabs={tabs.map((item) => ({
                key: String(item.id),
                title: item.title || "Untitled tab",
                note: PERIOD_LABELS[item.period],
              }))}
              active={String(tab.id)}
              onSelect={(key) =>
                setActive(tabs.findIndex((item) => String(item.id) === key))
              }
              label="Template tabs"
              trailing={
                tabs.length < 6 ? (
                  <button
                    type="button"
                    className="sheet-tab sheet-tab-add"
                    aria-label="Add a tab"
                    onClick={() => {
                      setTabs([
                        ...tabs,
                        {
                          id: id(),
                          title: "",
                          period: "interim",
                          sections: [
                            {
                              id: id(),
                              title: "Control",
                              kind: "fields",
                              guidance: "",
                              columns: [],
                              rows: [],
                            },
                          ],
                        },
                      ]);
                      setActive(tabs.length);
                    }}
                  >
                    <UiIcon name="plus" size={14} />
                  </button>
                ) : null
              }
            />
          </div>
        )}
        <form
          autoComplete="off"
          method="post"
          action="/workspace/setup"
          className="form-actions editor-actions"
        >
          <input type="hidden" name="organization_id" value={organizationId} />
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="intent" value="workpaper-template-save" />
          <input type="hidden" name="step" value="workpapers" />
          <input type="hidden" name="template_id" value={template.templateId} />
          <input type="hidden" name="version" value={template.version} />
          <input type="hidden" name="template" value={draft} />
          <button type="submit" disabled={!complete}>
            <UiIcon name="check" size={15} /> Save as your firm's template
          </button>
          <a className="btn btn-secondary" href={cancelHref}>
            Cancel
          </a>
          {complete ? null : (
            <span className="form-hint">
              Every tab and section needs a name, and a table needs columns.
            </span>
          )}
        </form>
      </div>
    </section>
  );
}
