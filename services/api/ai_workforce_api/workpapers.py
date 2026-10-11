"""Standard workpaper templates and their previews. Templates are code, reviewed like the
control library. A preview fills a template with one engagement control, so a team sees
exactly what the testers will complete. Nothing here records test results.
"""

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import date
from typing import Literal

from pydantic import BaseModel

from ai_workforce_api.controls import sample_size

TEMPLATES_VERSION = 1

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

SectionKind = Literal["fields", "guidance", "matrix", "table", "signoff"]


@dataclass(frozen=True)
class TemplateSection:
    title: str
    kind: SectionKind
    guidance: str = ""
    columns: tuple[str, ...] = ()


@dataclass(frozen=True)
class WorkpaperTemplate:
    key: str
    title: str
    stage: Literal["design", "effectiveness"]
    purpose: str
    sections: tuple[TemplateSection, ...]


TEMPLATES: tuple[WorkpaperTemplate, ...] = (
    WorkpaperTemplate(
        key="design-walkthrough",
        title="Walkthrough and test of design",
        stage="design",
        purpose=(
            "Confirms the control exists as described and is designed to address the risk, "
            "by following one instance from start to finish."
        ),
        sections=(
            TemplateSection("Control", "fields"),
            TemplateSection(
                "Process narrative",
                "guidance",
                "Describe how the control operates, who performs it, the systems and reports "
                "involved, and what happens when an exception is found.",
            ),
            TemplateSection(
                "Walkthrough of one instance",
                "table",
                columns=("Step", "Who", "Evidence inspected", "Result"),
            ),
            TemplateSection(
                "Information produced by the entity",
                "table",
                "List each report the control relies on and how its completeness and "
                "accuracy were checked.",
                columns=("Report", "Source system", "Completeness and accuracy procedure"),
            ),
            TemplateSection("Design attributes", "matrix"),
            TemplateSection(
                "Design conclusion",
                "guidance",
                "State whether the control is designed effectively to address the risk, "
                "and describe any design gap.",
            ),
            TemplateSection("Sign-off", "signoff"),
        ),
    ),
    WorkpaperTemplate(
        key="oe-manual",
        title="Operating effectiveness: manual control",
        stage="effectiveness",
        purpose=(
            "Tests a sample of control instances across the period against each attribute, "
            "and concludes on whether the control operated effectively."
        ),
        sections=(
            TemplateSection("Control", "fields"),
            TemplateSection(
                "Population",
                "guidance",
                "Record the population's source, how it was obtained, and how its "
                "completeness and accuracy were validated.",
            ),
            TemplateSection("Sample selection", "fields"),
            TemplateSection("Testing matrix", "matrix"),
            TemplateSection(
                "Exceptions",
                "table",
                columns=("Sample", "Attribute", "Description", "Root cause", "Impact"),
            ),
            TemplateSection(
                "Conclusion",
                "guidance",
                "Conclude on operating effectiveness for the period, considering any "
                "exceptions and their impact.",
            ),
            TemplateSection("Sign-off", "signoff"),
        ),
    ),
    WorkpaperTemplate(
        key="oe-automated",
        title="Operating effectiveness: automated control",
        stage="effectiveness",
        purpose=(
            "Tests the configured behaviour once, then relies on effective change "
            "management controls to conclude it operated throughout the period."
        ),
        sections=(
            TemplateSection("Control", "fields"),
            TemplateSection(
                "Configuration inspected",
                "guidance",
                "Record the configuration or logic inspected, how it was obtained from the "
                "system, and the expected behaviour.",
            ),
            TemplateSection("Test of one", "matrix"),
            TemplateSection(
                "Reliance on IT general controls",
                "table",
                "Link the change management controls that support relying on this control "
                "for the whole period.",
                columns=("ITGC", "Conclusion", "Workpaper"),
            ),
            TemplateSection(
                "Conclusion",
                "guidance",
                "Conclude on operating effectiveness, noting any configuration change "
                "during the period.",
            ),
            TemplateSection("Sign-off", "signoff"),
        ),
    ),
)

BY_KEY = {template.key: template for template in TEMPLATES}
DESIGN_KEYS = tuple(t.key for t in TEMPLATES if t.stage == "design")
EFFECTIVENESS_KEYS = tuple(t.key for t in TEMPLATES if t.stage == "effectiveness")


def templates_fingerprint() -> str:
    payload = [asdict(template) for template in TEMPLATES]
    text = json.dumps({"version": TEMPLATES_VERSION, "templates": payload}, sort_keys=True)
    return hashlib.sha256(text.encode()).hexdigest()


class TemplateSummary(BaseModel):
    key: str
    title: str
    stage: str
    purpose: str
    section_titles: list[str]


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


class WorkpaperPreview(BaseModel):
    template_key: str
    template_title: str
    template_version: int
    stage: str
    purpose: str
    reference: str
    title: str
    sections: list[PreviewSection]


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


def summaries() -> list[TemplateSummary]:
    return [
        TemplateSummary(
            key=template.key,
            title=template.title,
            stage=template.stage,
            purpose=template.purpose,
            section_titles=[section.title for section in template.sections],
        )
        for template in TEMPLATES
    ]


def preview(
    template_key: str,
    control: PreviewControl,
    engagement: str,
    period_end: date | None,
) -> WorkpaperPreview:
    """Fill a template with one control. The result shows structure, never results."""
    template = BY_KEY.get(template_key)
    if template is None:
        raise ValueError("template is unknown")
    stage_code = "TOD" if template.stage == "design" else "TOE"
    reference = f"{control.control_ref}-{stage_code}"
    sections = [
        _section(section, template, control, engagement, period_end)
        for section in template.sections
    ]
    return WorkpaperPreview(
        template_key=template.key,
        template_title=template.title,
        template_version=TEMPLATES_VERSION,
        stage=template.stage,
        purpose=template.purpose,
        reference=reference,
        title=f"{control.control_ref} {control.title}",
        sections=sections,
    )


def _section(
    section: TemplateSection,
    template: WorkpaperTemplate,
    control: PreviewControl,
    engagement: str,
    period_end: date | None,
) -> PreviewSection:
    fields: list[PreviewField] = []
    columns = list(section.columns)
    rows: list[list[str]] = []
    attributes = list(control.test_attributes)
    letters = [chr(ord("A") + index) for index in range(len(attributes))]
    if section.kind == "fields" and section.title == "Control":
        fields = [
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
    elif section.kind == "fields" and section.title == "Sample selection":
        size = sample_size(control.frequency, control.nature)
        fields = [
            PreviewField(label="Frequency", value=FREQUENCY_LABELS.get(control.frequency, "")),
            PreviewField(label="Sample size", value=str(size)),
            PreviewField(label="Selection method", value="Random across the period"),
        ]
    elif section.kind == "matrix":
        columns = [
            "Sample",
            *[f"{letter}. {text}" for letter, text in zip(letters, attributes, strict=True)],
        ]
        if template.stage == "design":
            columns = ["Attribute", "Designed to address the risk", "Notes"]
            rows = [
                [f"{letter}. {text}", "", ""]
                for letter, text in zip(letters, attributes, strict=True)
            ]
        else:
            count = sample_size(control.frequency, control.nature)
            shown = min(count, 5)
            rows = [[f"Sample {index}", *["" for _ in attributes]] for index in range(1, shown + 1)]
            if count > shown:
                rows.append([f"… {count - shown} more", *["" for _ in attributes]])
    elif section.kind == "table":
        rows = [["" for _ in columns]]
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
