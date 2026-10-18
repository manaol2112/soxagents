"""Standard workpaper templates and their previews. Templates are code, reviewed like the
control library. A template is a workbook: one tab for design, one for interim testing,
and one for the roll-forward to period end, with sections that fit the kind of control it
documents (an IT general control, an application control, a business process control, or
a key report). A preview fills a template with one engagement control, so a team sees
exactly what the testers will complete. Nothing here records test results.
"""

import hashlib
import json
import re
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from datetime import date
from typing import Literal

from pydantic import BaseModel

from ai_workforce_api.control_instances import control_label
from ai_workforce_api.controls import KINDS, Kind, kind_for_domain, sample_size

TEMPLATES_VERSION = 2

FREQUENCY_LABELS = {
    "ANNUAL": "Annual",
    "QUARTERLY": "Quarterly",
    "MONTHLY": "Monthly",
    "WEEKLY": "Weekly",
    "DAILY": "Daily",
    "RECURRING": "Multiple times a day",
    "EVENT_DRIVEN": "As events occur",
}
NATURE_LABELS = {
    "MANUAL": "Manual",
    "AUTOMATED": "Automated",
    "IT_DEPENDENT_MANUAL": "IT-dependent manual",
}
KIND_LABELS: dict[str, str] = {
    "ITGC": "IT general controls",
    "ITAC": "Application controls",
    "BUSINESS": "Business process controls",
    "KEY_REPORT": "Key reports",
}

SectionKind = Literal["fields", "guidance", "matrix", "table", "signoff"]
SECTION_KINDS: tuple[SectionKind, ...] = ("fields", "guidance", "matrix", "table", "signoff")
Period = Literal["design", "interim", "rollforward"]
PERIODS: tuple[Period, ...] = ("design", "interim", "rollforward")
PERIOD_LABELS: dict[str, str] = {
    "design": "Design",
    "interim": "Interim testing",
    "rollforward": "Roll-forward",
}
# The stored workpaper each tab belongs to: design work is one record, testing the other.
STAGE_PERIODS: dict[str, tuple[Period, ...]] = {
    "DESIGN": ("design",),
    "EFFECTIVENESS": ("interim", "rollforward"),
}
PERIOD_CODES: dict[str, str] = {"design": "TOD", "interim": "TOE", "rollforward": "RF"}


@dataclass(frozen=True)
class TemplateSection:
    title: str
    kind: SectionKind
    guidance: str = ""
    columns: tuple[str, ...] = ()
    # Starter rows for a table, such as the standard completeness and accuracy procedures.
    rows: tuple[tuple[str, ...], ...] = ()


@dataclass(frozen=True)
class TemplateTab:
    key: str
    title: str
    period: Period
    sections: tuple[TemplateSection, ...]


@dataclass(frozen=True)
class WorkpaperTemplate:
    key: str
    title: str
    kind: Kind
    purpose: str
    tabs: tuple[TemplateTab, ...]
    # STANDARD: code in this module. FIRM: uploaded or customised for one engagement
    # (workpaper_templates.py). A customised template remembers what it started from.
    source: str = "STANDARD"
    file_name: str = ""
    template_id: str = ""
    base_key: str = ""
    # A firm template's saved version; an edit must name the version it was based on.
    version: int = 1


def _control() -> TemplateSection:
    return TemplateSection("Control", "fields")


def _signoff() -> TemplateSection:
    return TemplateSection("Sign-off", "signoff")


def _walkthrough() -> TemplateSection:
    return TemplateSection(
        "Walkthrough of one instance",
        "table",
        "Follow one instance from start to finish, inspecting the evidence at each step.",
        columns=("Step", "Who", "Evidence inspected", "Result"),
    )


def _ipe(guidance: str) -> TemplateSection:
    return TemplateSection(
        "Information produced by the entity",
        "table",
        guidance,
        columns=("Report", "Source system", "Completeness and accuracy procedure"),
    )


def _reliance(guidance: str) -> TemplateSection:
    return TemplateSection(
        "Reliance on IT general controls",
        "table",
        guidance,
        columns=("ITGC", "Conclusion", "Workpaper"),
    )


def _exceptions() -> TemplateSection:
    return TemplateSection(
        "Exceptions",
        "table",
        columns=("Sample", "Attribute", "Description", "Root cause", "Impact"),
    )


def _design_close() -> tuple[TemplateSection, ...]:
    return (
        TemplateSection("Design attributes", "matrix"),
        TemplateSection(
            "Design conclusion",
            "guidance",
            "State whether the control is designed effectively to address the risk, and "
            "describe any design gap.",
        ),
        _signoff(),
    )


def _sample_tabs(population: str, changes: str) -> tuple[TemplateTab, TemplateTab]:
    """Interim and roll-forward tabs for a control tested on a sample."""
    return (
        TemplateTab(
            "interim",
            "Interim testing",
            "interim",
            (
                _control(),
                TemplateSection("Population", "guidance", population),
                TemplateSection("Sample selection", "fields"),
                TemplateSection("Testing matrix", "matrix"),
                _exceptions(),
                TemplateSection(
                    "Interim conclusion",
                    "guidance",
                    "Conclude on operating effectiveness for the interim period, considering "
                    "any exceptions and their impact.",
                ),
                _signoff(),
            ),
        ),
        TemplateTab(
            "rollforward",
            "Roll-forward",
            "rollforward",
            (
                _control(),
                TemplateSection("Changes since interim", "guidance", changes),
                TemplateSection("Update sample", "fields"),
                TemplateSection("Roll-forward testing", "matrix"),
                _exceptions(),
                TemplateSection(
                    "Conclusion for the period",
                    "guidance",
                    "Conclude on operating effectiveness for the whole period, combining the "
                    "interim and roll-forward results.",
                ),
                _signoff(),
            ),
        ),
    )


TEMPLATES: tuple[WorkpaperTemplate, ...] = (
    WorkpaperTemplate(
        key="itgc",
        title="IT general control",
        kind="ITGC",
        purpose=(
            "Documents a control over access, change, or operations: how it operates in "
            "the system, a walkthrough of one instance, interim testing of a sample, and a "
            "roll-forward to period end."
        ),
        tabs=(
            TemplateTab(
                "design",
                "Design",
                "design",
                (
                    _control(),
                    TemplateSection(
                        "Understanding of the control",
                        "guidance",
                        "Describe how the control operates in the system: who performs it, "
                        "how often, the tools or reports used, what is checked, and what "
                        "happens when an exception is found.",
                    ),
                    _walkthrough(),
                    _ipe(
                        "List each system listing the control relies on (user lists, change "
                        "logs, job schedules) and how its completeness and accuracy were "
                        "checked."
                    ),
                    *_design_close(),
                ),
            ),
            *_sample_tabs(
                "Record the population's source (the system's list of users, changes, or "
                "jobs), how it was obtained, the period it covers, and how its completeness "
                "and accuracy were validated. For an automated control, record the "
                "configuration inspected instead.",
                "Record the owner's confirmation that the control, the system, and the "
                "people performing it did not change since interim testing, and any change "
                "found.",
            ),
        ),
    ),
    WorkpaperTemplate(
        key="itac",
        title="Application control",
        kind="ITAC",
        purpose=(
            "Documents an automated application control: the configuration or logic, a "
            "test of one, reliance on IT general controls, and confirmation that nothing "
            "changed through period end."
        ),
        tabs=(
            TemplateTab(
                "design",
                "Design",
                "design",
                (
                    _control(),
                    TemplateSection(
                        "Understanding of the configuration",
                        "guidance",
                        "Describe the configured rule, calculation, interface, or validation: "
                        "its inputs and outputs, where it is set in the application, who can "
                        "change it, and what happens when it rejects or flags a transaction.",
                    ),
                    _walkthrough(),
                    _reliance(
                        "Link the access and change management controls over the application "
                        "that support relying on the configuration for the whole period."
                    ),
                    *_design_close(),
                ),
            ),
            TemplateTab(
                "interim",
                "Interim testing",
                "interim",
                (
                    _control(),
                    TemplateSection(
                        "Configuration inspected",
                        "guidance",
                        "Record the configuration or logic inspected, how it was obtained from "
                        "the system (screenshots, configuration reports, code), and the "
                        "expected behaviour.",
                    ),
                    TemplateSection("Test of one", "matrix"),
                    _reliance(
                        "Link the change management controls that support relying on this "
                        "control for the whole period."
                    ),
                    _exceptions(),
                    TemplateSection(
                        "Interim conclusion",
                        "guidance",
                        "Conclude on operating effectiveness as at the test date, noting any "
                        "dependency on IT general controls.",
                    ),
                    _signoff(),
                ),
            ),
            TemplateTab(
                "rollforward",
                "Roll-forward",
                "rollforward",
                (
                    _control(),
                    TemplateSection(
                        "Configuration changes since interim",
                        "guidance",
                        "Record the change log or the owner's confirmation that the "
                        "configuration did not change since the test of one, and any change "
                        "found.",
                    ),
                    _reliance(
                        "Confirm the change management controls operated through period end."
                    ),
                    TemplateSection("Roll-forward test", "matrix"),
                    TemplateSection(
                        "Conclusion for the period",
                        "guidance",
                        "Conclude on operating effectiveness for the whole period, noting any "
                        "configuration change.",
                    ),
                    _signoff(),
                ),
            ),
        ),
    ),
    WorkpaperTemplate(
        key="business",
        title="Business process control",
        kind="BUSINESS",
        purpose=(
            "Documents a manual or IT-dependent business process control: the process, a "
            "walkthrough, interim testing of a sample across the period, and a roll-forward "
            "to period end."
        ),
        tabs=(
            TemplateTab(
                "design",
                "Design",
                "design",
                (
                    _control(),
                    TemplateSection(
                        "Process narrative",
                        "guidance",
                        "Describe the process from initiation to recording: how the control "
                        "operates, who performs and reviews it, the systems and reports "
                        "involved, and what happens when an exception is found.",
                    ),
                    _walkthrough(),
                    TemplateSection(
                        "Segregation of duties",
                        "guidance",
                        "Record who prepares, who reviews, and who approves, and confirm that "
                        "no one person holds incompatible duties.",
                    ),
                    _ipe(
                        "List each report the control relies on and how its completeness and "
                        "accuracy were checked."
                    ),
                    *_design_close(),
                ),
            ),
            *_sample_tabs(
                "Record the population's source, how it was obtained, the period it covers, "
                "and how its completeness and accuracy were validated.",
                "Record the owner's confirmation that the control and the people performing "
                "it did not change since interim testing, and any change found.",
            ),
        ),
    ),
    WorkpaperTemplate(
        key="key-report",
        title="Key report",
        kind="KEY_REPORT",
        purpose=(
            "Documents a key report (information produced by the entity): what it is and how "
            "it is produced, its completeness and accuracy testing, and whether it changed "
            "through period end."
        ),
        tabs=(
            TemplateTab(
                "design",
                "Design",
                "design",
                (
                    _control(),
                    TemplateSection(
                        "Report description",
                        "guidance",
                        "Describe the report: its name and source system, who runs it and "
                        "when, the parameters and filters used, its purpose in the control, "
                        "and who relies on it.",
                    ),
                    TemplateSection(
                        "Source data and logic",
                        "table",
                        "Trace each field or total the control relies on to its source and "
                        "the logic that produces it.",
                        columns=("Report element", "Source table or system", "How it is derived"),
                    ),
                    _reliance(
                        "Link the controls over the system that produces the report, where its "
                        "logic is relied on without re-performance."
                    ),
                    *_design_close(),
                ),
            ),
            TemplateTab(
                "interim",
                "Interim testing",
                "interim",
                (
                    _control(),
                    TemplateSection(
                        "Report instance tested",
                        "guidance",
                        "Record the run of the report that was tested: the date, the "
                        "parameters, who produced it, and how it was obtained.",
                    ),
                    TemplateSection(
                        "Completeness and accuracy procedures",
                        "table",
                        columns=("Procedure", "What was done", "Result"),
                        rows=(
                            ("Completeness: report totals agree to the source data", "", ""),
                            (
                                "Accuracy: a selection of report lines agrees to the source "
                                "records",
                                "",
                                "",
                            ),
                            (
                                "Parameters: the run parameters match the control's requirement",
                                "",
                                "",
                            ),
                            ("Logic: a calculation or filter was re-performed", "", ""),
                        ),
                    ),
                    TemplateSection("Testing matrix", "matrix"),
                    _exceptions(),
                    TemplateSection(
                        "Interim conclusion",
                        "guidance",
                        "Conclude on whether the report is complete and accurate for the "
                        "control's purpose.",
                    ),
                    _signoff(),
                ),
            ),
            TemplateTab(
                "rollforward",
                "Roll-forward",
                "rollforward",
                (
                    _control(),
                    TemplateSection(
                        "Changes to the report since interim",
                        "guidance",
                        "Record the owner's confirmation that the report's logic, parameters, "
                        "and source did not change since interim testing, and any change "
                        "found.",
                    ),
                    _reliance(
                        "Confirm the controls over the reporting system operated through "
                        "period end."
                    ),
                    TemplateSection("Roll-forward testing", "matrix"),
                    TemplateSection(
                        "Conclusion for the period",
                        "guidance",
                        "Conclude on whether the report was complete and accurate for the "
                        "whole period.",
                    ),
                    _signoff(),
                ),
            ),
        ),
    ),
)

BY_KEY = {template.key: template for template in TEMPLATES}
STANDARD_BY_KIND: dict[str, WorkpaperTemplate] = {t.kind: t for t in TEMPLATES}
assert set(STANDARD_BY_KIND) == set(KINDS)


def default_template(domain: str) -> str:
    """The standard template for a control's area."""
    return STANDARD_BY_KIND[kind_for_domain(domain)].key


def tabs_for(template: WorkpaperTemplate, stage: str) -> tuple[TemplateTab, ...]:
    """The tabs a stored workpaper holds: design work, or interim and roll-forward testing."""
    periods = STAGE_PERIODS.get(stage, ())
    return tuple(tab for tab in template.tabs if tab.period in periods)


def templates_fingerprint() -> str:
    # The standard templates' content only: their origin fields never change it.
    payload = [
        {
            k: v
            for k, v in asdict(template).items()
            if k not in ("source", "file_name", "template_id", "base_key", "version")
        }
        for template in TEMPLATES
    ]
    text = json.dumps({"version": TEMPLATES_VERSION, "templates": payload}, sort_keys=True)
    return hashlib.sha256(text.encode()).hexdigest()


class SectionSummary(BaseModel):
    title: str
    kind: str
    guidance: str = ""
    columns: list[str] = []
    rows: list[list[str]] = []


class TabSummary(BaseModel):
    key: str
    title: str
    period: str
    sections: list[SectionSummary]


class TemplateSummary(BaseModel):
    key: str
    title: str
    kind: str
    purpose: str
    tabs: list[TabSummary]
    source: str = "STANDARD"
    file_name: str = ""
    template_id: str = ""
    base_key: str = ""
    version: int = 1


class PreviewField(BaseModel):
    label: str
    value: str


class PreviewSection(BaseModel):
    title: str
    kind: str
    guidance: str
    fields: list[PreviewField]
    columns: list[str]
    rows: list[list[str]]


class PreviewTab(BaseModel):
    key: str
    title: str
    period: str
    reference: str
    sections: list[PreviewSection]


class WorkpaperPreview(BaseModel):
    template_key: str
    template_title: str
    template_version: int
    kind: str
    purpose: str
    reference: str
    title: str
    tabs: list[PreviewTab]


def application_code(name: str) -> str:
    """A short code for an application in a reference: Active Directory -> AD."""
    words = [word for word in re.split(r"[^A-Za-z0-9]+", name) if word]
    if not words:
        return ""
    code = "".join(word[0] for word in words) if len(words) > 1 else words[0][:4]
    return code.upper()[:8]


def workpaper_reference(control_ref: str, applications: tuple[str, ...], stage_code: str) -> str:
    """ITGC-AC-01-TOE, or ITGC-AC-01-AD-TOE for the Active Directory instance."""
    base = control_ref
    if len(applications) == 1:
        base = f"{control_ref}-{application_code(applications[0])}"
    return base if stage_code == "" else f"{base}-{stage_code}"


def instance_name(control: PreviewControl) -> str:
    return control_label(
        control.control_ref, control.applications[0] if len(control.applications) == 1 else None
    )


@dataclass(frozen=True)
class PreviewControl:
    control_ref: str
    title: str
    risk: str
    activity: str
    frequency: str
    nature: str
    owner_name: str
    test_attributes: tuple[str, ...]
    applications: tuple[str, ...]
    # The client's own terms and extra RCM columns, when the RCM was uploaded.
    frequency_label: str = ""
    nature_label: str = ""
    custom_fields: tuple[tuple[str, str], ...] = ()


def summary(template: WorkpaperTemplate) -> TemplateSummary:
    return TemplateSummary(
        key=template.key,
        title=template.title,
        kind=template.kind,
        purpose=template.purpose,
        tabs=[
            TabSummary(
                key=tab.key,
                title=tab.title,
                period=tab.period,
                sections=[
                    SectionSummary(
                        title=section.title,
                        kind=section.kind,
                        guidance=section.guidance,
                        columns=list(section.columns),
                        rows=[list(row) for row in section.rows],
                    )
                    for section in tab.sections
                ],
            )
            for tab in template.tabs
        ],
        source=template.source,
        file_name=template.file_name,
        template_id=template.template_id,
        base_key=template.base_key,
        version=template.version,
    )


def summaries(extra: Iterable[WorkpaperTemplate] = ()) -> list[TemplateSummary]:
    """The standard templates, then any the firm uploaded or customised for the engagement."""
    return [summary(template) for template in (*TEMPLATES, *extra)]


def preview(
    template_key: str | WorkpaperTemplate,
    control: PreviewControl,
    engagement: str,
    period_end: date | None,
) -> WorkpaperPreview:
    """Fill a template with one control. The result shows structure, never results."""
    template = (
        template_key if isinstance(template_key, WorkpaperTemplate) else BY_KEY.get(template_key)
    )
    if template is None:
        raise ValueError("template is unknown")
    reference = workpaper_reference(control.control_ref, control.applications, "")
    tabs = [
        PreviewTab(
            key=tab.key,
            title=tab.title,
            period=tab.period,
            reference=workpaper_reference(
                control.control_ref, control.applications, PERIOD_CODES[tab.period]
            ),
            sections=[
                _section(section, tab.period, control, engagement, period_end)
                for section in tab.sections
            ],
        )
        for tab in template.tabs
    ]
    return WorkpaperPreview(
        template_key=template.key,
        template_title=template.title,
        template_version=TEMPLATES_VERSION,
        kind=template.kind,
        purpose=template.purpose,
        reference=reference,
        title=f"{instance_name(control)} {control.title}",
        tabs=tabs,
    )


def header_fields(
    control: PreviewControl, engagement: str, period_end: date | None
) -> list[PreviewField]:
    return [
        PreviewField(label="Engagement", value=engagement),
        PreviewField(label="Control", value=f"{control.control_ref} {control.title}"),
        PreviewField(label="Risk", value=control.risk),
        PreviewField(label="Control activity", value=control.activity),
        PreviewField(
            label="Frequency",
            value=_term(control.frequency_label, FREQUENCY_LABELS.get(control.frequency, "")),
        ),
        PreviewField(
            label="Nature",
            value=_term(control.nature_label, NATURE_LABELS.get(control.nature, "")),
        ),
        PreviewField(label="Control owner", value=control.owner_name or "Not assigned"),
        PreviewField(
            label="Applications",
            value=", ".join(control.applications) or "Not assigned",
        ),
        PreviewField(
            label="Period end",
            value="Not set" if period_end is None else period_end.isoformat(),
        ),
        *[PreviewField(label=label, value=value) for label, value in control.custom_fields],
    ]


def sample_plan(control: PreviewControl, period: str) -> tuple[int, str]:
    """The standard sample for a period: the size and how it is selected."""
    if period == "rollforward":
        from ai_workforce_api.test_rounds import rollforward_size

        method, size = rollforward_size(control.frequency, control.nature)
        return size, (
            "One instance from current evidence"
            if method == "TEST_OF_ONE"
            else "Random across the period remaining after interim testing"
        )
    size = sample_size(control.frequency, control.nature)
    return size, ("One instance" if size == 1 else "Random across the period")


def is_sample_fields(section: TemplateSection) -> bool:
    return section.kind == "fields" and "sample" in section.title.lower()


def _section(
    section: TemplateSection,
    period: str,
    control: PreviewControl,
    engagement: str,
    period_end: date | None,
) -> PreviewSection:
    fields: list[PreviewField] = []
    columns = list(section.columns)
    rows: list[list[str]] = [list(row) for row in section.rows]
    attributes = list(control.test_attributes)
    letters = [chr(ord("A") + index) for index in range(len(attributes))]
    if section.kind == "fields" and not is_sample_fields(section):
        fields = header_fields(control, engagement, period_end)
    elif section.kind == "fields":
        size, method = sample_plan(control, period)
        fields = [
            PreviewField(label="Frequency", value=FREQUENCY_LABELS.get(control.frequency, "")),
            PreviewField(label="Sample size", value=str(size)),
            PreviewField(label="Selection method", value=method),
        ]
    elif section.kind == "matrix":
        if period == "design":
            columns = ["Attribute", "Designed to address the risk", "Notes"]
            rows = [
                [f"{letter}. {text}", "", ""]
                for letter, text in zip(letters, attributes, strict=True)
            ]
        else:
            columns = [
                "Sample",
                *[f"{letter}. {text}" for letter, text in zip(letters, attributes, strict=True)],
            ]
            count, _method = sample_plan(control, period)
            shown = min(count, 5)
            rows = [[f"Sample {index}", *["" for _ in attributes]] for index in range(1, shown + 1)]
            if count > shown:
                rows.append([f"… {count - shown} more", *["" for _ in attributes]])
    elif section.kind == "table":
        rows = rows or [["" for _ in columns]]
    elif section.kind == "signoff":
        columns = ["Role", "Name", "Date"]
        rows = [["Prepared by", "", ""], ["Reviewed by", "", ""]]
    return PreviewSection(
        title=section.title,
        kind=section.kind,
        guidance=section.guidance,
        fields=fields,
        columns=columns,
        rows=rows,
    )


def _term(client: str, standard: str) -> str:
    """The client's word for a value, with the standard value it was mapped to."""
    if client == "" or client.lower() == standard.lower():
        return standard
    return f"{client} ({standard})"
