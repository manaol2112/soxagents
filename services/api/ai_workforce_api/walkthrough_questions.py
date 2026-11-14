"""The walkthrough question bank: what a senior IT auditor asks to understand a control.

The product owner (11 November 2026): the Control Understanding step asked questions that were
correct but too high level. A library control's statement asks only for its named values (the
system, the tool, the policy, the roles, a deadline). This bank adds the walkthrough itself:
how the control starts, who approves and how their authority is set, how it is performed and
kept segregated, what records it leaves, how the population is produced from the system, and
what changed in the period.

Decided by the product owner the same day, as the first increment: the framework, universal
questions asked for every control, and full banks for the logical access family (library keys
starting "access-") and the change management family ("change-"). Questions marked required
hold the "Control Understanding complete" gate; optional ones are asked but can be left. What
a statement slot already asks is not asked again here, and ITGC-AC-05's authentication
settings stay with their own interview (authentication_profile.py).

Revised the same day after the product owner reviewed the bank in the app (11 November 2026):
"A lot of those are very deep questions which is great but a lot of those are not needed for
the user to test the attributes. Only ask the questions that are detailed but also
reasonable", the questions were "not organized in a chronological manner", and the
understanding did not change when answers were given. So:

- Every question earns its place. It is asked only because its answer changes how a named
  attribute of the control's testing definition is tested, which items are in the population
  and where they come from, what evidence is requested, the sample, the scope, the period
  tested, or reliance on a service organization; `informs` says which. Background and
  nice-to-know questions, and what the evidence itself will show, were removed.
- The topics follow the control as it operates (what it covers, how it starts, approval,
  performing it, segregation, records, exceptions), then the testing context (population,
  changes in the period, service organizations, volume). Within a topic each question has an
  explicit place (`order`), in the order a walkthrough reaches it, and a follow-up comes
  directly after its parent.
- Each question says how its confirmed answer reads in the understanding (`narrative`, or
  `narrative_yes` and `narrative_no`), and narrate() tells the understanding from the answers.

A question is asked for a control when it is universal, belongs to the control's family (some
family questions only to the family members named in _LIMITED_TO), or is specific to the
control. It is dropped for a nature it does not apply to; the volume question is also dropped
for a control whose frequency already fixes how often it operates (annual to daily), since its
population is the number of occurrences. A follow-up (when) is asked only when its parent's
answer contains the given value.

Revised again the same day (product owner, 11 November 2026: "The questions in control
understanding do not take multiple answers"): a choice where more than one option can be true
at the same client for the same control is a MULTI, and the workaround options ("Both", "A
mix", "In different ways") went with it; a CHOICE stays only where its options exclude each
other. And every CHOICE and MULTI question takes one answer its options do not offer, as a
free-text part "Other: <text>" (the last part of a MULTI answer), unless `allows_other` is
False because a fixed answer set is essential (the volume range the sample is planned from).

Revised again the same day (product owner, 11 November 2026: "Make sure that whenever
questions like this show up, an option is always provided so that the user won't have to type
as much as possible"): every free-text question whose answer can be listed is a CHOICE or
MULTI with its most common answers first and Other; a question that asked several things in
one box is split into one question per part testing needs, and the parts it does not need
(why an account is exempt, how quickly an incident is escalated, the migration's source
systems) went. TEXT stays only for answers that are a narrative no list can hold (TEXT_KEPT),
and each of those comes after a structured question on the same follow-up. A converted
question keeps its key, since an earlier free-text answer is not a valid answer to it and so
reads as missing; a question split into new parts gets new keys.

Status: draft for professional review, like the rest of the library. Nothing here sets a
threshold, a deadline or a role on the client's behalf. Pure and deterministic: no database.
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from ai_workforce_api.controls import LIBRARY_KEYS
from ai_workforce_api.definition_registry import definition_for

STATUS = "Draft for professional review"

Topic = Literal[
    "SCOPE",
    "INITIATION",
    "APPROVAL",
    "EXECUTION",
    "SEGREGATION",
    "RECORDS",
    "EXCEPTIONS",
    "POPULATION",
    "CHANGES",
    "SERVICE_ORG",
    "VOLUME",
]
# The order questions are asked in: the control as it operates, then the testing context.
TOPICS: tuple[Topic, ...] = (
    "SCOPE",
    "INITIATION",
    "APPROVAL",
    "EXECUTION",
    "SEGREGATION",
    "RECORDS",
    "EXCEPTIONS",
    "POPULATION",
    "CHANGES",
    "SERVICE_ORG",
    "VOLUME",
)
TOPIC_LABELS: dict[Topic, str] = {
    "SCOPE": "What the control covers",
    "INITIATION": "How it starts",
    "APPROVAL": "Approval",
    "EXECUTION": "Performing the control",
    "SEGREGATION": "Segregation of duties",
    "RECORDS": "Records and system data",
    "EXCEPTIONS": "Exceptions",
    "POPULATION": "Population for testing",
    "CHANGES": "Changes in the period",
    "SERVICE_ORG": "Service organizations",
    "VOLUME": "Volume",
}

# What an answer changes in the test, derived from what it informs. CRITERIA is no longer
# derived (an attribute key says which attribute's criteria) but stays a valid drive.
Drive = Literal["EVIDENCE", "ATTRIBUTES", "CRITERIA", "SAMPLING", "SCOPE"]
DRIVES: tuple[Drive, ...] = ("EVIDENCE", "ATTRIBUTES", "CRITERIA", "SAMPLING", "SCOPE")
# What an answer is needed for, besides a named attribute of the control's definition.
INFORMS: tuple[str, ...] = ("POPULATION", "EVIDENCE", "SAMPLE", "SCOPE", "PERIOD", "RELIANCE")
_DRIVES_OF: dict[str, tuple[Drive, ...]] = {
    "POPULATION": ("EVIDENCE", "SAMPLING"),
    "EVIDENCE": ("EVIDENCE",),
    "SAMPLE": ("SAMPLING",),
    "SCOPE": ("SCOPE",),
    "PERIOD": ("SCOPE", "SAMPLING"),
    "RELIANCE": ("SCOPE", "EVIDENCE"),
}
AnswerKind = Literal["CHOICE", "MULTI", "YES_NO", "TEXT"]
ANSWER_KINDS: tuple[AnswerKind, ...] = ("CHOICE", "MULTI", "YES_NO", "TEXT")
YES_NO: tuple[str, str] = ("Yes", "No")
NATURES: tuple[str, ...] = ("MANUAL", "AUTOMATED", "IT_DEPENDENT_MANUAL")
# Frequencies that fix how often the control operates, so its population is known without
# asking for a volume.
FIXED_FREQUENCIES = frozenset({"ANNUAL", "QUARTERLY", "MONTHLY", "WEEKLY", "DAILY"})
# How a MULTI answer joins its options.
JOIN = "; "
# An answer the options do not offer: "Other: <text>", the text 3-200 characters after strip,
# with no ";". One per answer, and the last part of a MULTI answer.
OTHER = "Other: "
OTHER_MIN = 3
OTHER_MAX = 200
# Where a narrative puts the answer.
ANSWER = "{answer}"

KEY = re.compile(r"^wt-[a-z0-9-]{2,60}$")
TEXT_LIMIT = 220
WHY_LIMIT = 260
OPTION_LIMIT = 80
ANSWER_LIMIT = 1000
NARRATIVE_LIMIT = 220

FAMILIES: dict[str, str] = {"access-": "ACCESS", "change-": "CHANGE"}

# The only free-text questions (product owner, 11 November 2026: options wherever an answer
# can be listed), each a narrative no list holds and each asked after a structured question
# on the same follow-up: the dates, causes and resolution of each known deviation; when each
# change in the period took effect and how the control ran before and after it; and the
# service organization's name with the complementary user entity controls its report lists.
TEXT_KEPT: frozenset[str] = frozenset(
    {"wt-known-deviations-detail", "wt-changes-in-period-detail", "wt-service-org-detail"}
)


@dataclass(frozen=True)
class Question:
    """One walkthrough question, asked to the engagement team."""

    # Unique across the bank, e.g. "wt-ac01-sod-check".
    key: str
    topic: Topic
    # The question as asked: plain English, ends with "?".
    text: str
    # Why a senior IT auditor asks it and what the answer changes; one sentence.
    why: str
    drives: tuple[Drive, ...]
    kind: AnswerKind
    # Non-empty; what the answer is needed for: attribute definition keys of the control (e.g.
    # "ac01-approver") for control-specific questions, and/or the INFORMS tokens.
    informs: tuple[str, ...]
    # CHOICE and MULTI only.
    options: tuple[str, ...] = ()
    # True when testing cannot proceed without the answer: the question holds the Control
    # Understanding gate.
    required: bool = True
    # A follow-up: asked only when question when[0]'s answer contains when[1].
    when: tuple[str, str] | None = None
    # The control natures it applies to; empty for all.
    natures: tuple[str, ...] = ()
    # Its place within its topic, in the order a walkthrough reaches it (unique among the
    # questions a control is asked in that topic). A follow-up has 0: it comes directly after
    # its parent.
    order: int = 0
    # How a confirmed answer reads in the understanding, a sentence with "{answer}" (e.g.
    # "Access is assigned {answer}."); "" = not narrated. Not used for YES_NO.
    narrative: str = ""
    # YES_NO: the sentence for "Yes" (no {answer}); "" = nothing.
    narrative_yes: str = ""
    # YES_NO: the sentence for "No".
    narrative_no: str = ""
    # CHOICE and MULTI: whether an answer the options do not offer may be recorded as one
    # free-text part "Other: <text>" (product owner, 11 November 2026). False where a fixed
    # answer set is essential; always False for YES_NO and TEXT.
    allows_other: bool = True


def _drives(informs: tuple[str, ...]) -> tuple[Drive, ...]:
    wanted: set[Drive] = set()
    for item in informs:
        wanted.update(_DRIVES_OF.get(item, ("ATTRIBUTES",)))
    return tuple(drive for drive in DRIVES if drive in wanted)


def _yes_no(
    key: str,
    topic: Topic,
    order: int,
    text: str,
    why: str,
    informs: tuple[str, ...],
    *,
    yes: str,
    no: str,
    required: bool = True,
    when: tuple[str, str] | None = None,
) -> Question:
    return Question(
        key, topic, text, why, _drives(informs), "YES_NO", informs, (), required, when, (),
        order, "", yes, no, allows_other=False,
    )  # fmt: skip


def _text(
    key: str,
    topic: Topic,
    order: int,
    text: str,
    why: str,
    informs: tuple[str, ...],
    narrative: str,
    *,
    required: bool = True,
    when: tuple[str, str] | None = None,
) -> Question:
    return Question(
        key, topic, text, why, _drives(informs), "TEXT", informs, (), required, when, (),
        order, narrative, allows_other=False,
    )  # fmt: skip


def _choice(
    key: str,
    topic: Topic,
    order: int,
    text: str,
    why: str,
    informs: tuple[str, ...],
    options: tuple[str, ...],
    narrative: str,
    *,
    required: bool = True,
    when: tuple[str, str] | None = None,
    natures: tuple[str, ...] = (),
    allows_other: bool = True,
) -> Question:
    return Question(
        key, topic, text, why, _drives(informs), "CHOICE", informs, options, required, when,
        natures, order, narrative, allows_other=allows_other,
    )  # fmt: skip


def _multi(
    key: str,
    topic: Topic,
    order: int,
    text: str,
    why: str,
    informs: tuple[str, ...],
    options: tuple[str, ...],
    narrative: str,
    *,
    required: bool = True,
    when: tuple[str, str] | None = None,
    allows_other: bool = True,
) -> Question:
    return Question(
        key, topic, text, why, _drives(informs), "MULTI", informs, options, required, when, (),
        order, narrative, allows_other=allows_other,
    )  # fmt: skip


# A control-designed safeguard is tested once in its configuration; one by policy only is
# tested for every sample item. Shared by the "can the doer also approve" questions.
_PREVENTED = ("Prevented by the system", "Prohibited by policy only", "Not prevented")

# Universal: asked for every control. Known deviations close the control's own exceptions;
# the testing context comes after the population.

UNIVERSAL: tuple[Question, ...] = (
    _yes_no(
        "wt-known-deviations", "EXCEPTIONS", 90,
        "In the period, was the control ever not performed, performed late, or did it find a "
        "problem that was not resolved?",
        "A known deviation is evaluated as an exception whether or not the sample picks it, "
        "and it can change the sample size or the conclusion.",
        ("SAMPLE", "EVIDENCE"),
        yes="At least once in the period, the control was not performed, was performed late, "
        "or found a problem that was not resolved.",
        no="No instance is known in the period of the control not being performed, being "
        "performed late, or finding a problem that was not resolved.",
    ),
    _multi(
        "wt-known-deviations-kind", "EXCEPTIONS", 0,
        "What happened in the known instances?",
        "Each kind of deviation is evaluated as an exception of its own, and a control not "
        "performed or performed late is traced to the dates it should have run.",
        ("SAMPLE", "EVIDENCE"),
        ("Not performed", "Performed late", "Performed, but a problem it found was not resolved"),
        "In the known instances, the control was {answer}.",
        when=("wt-known-deviations", "Yes"),
    ),
    # A narrative: each instance's date, cause and resolution are its own (TEXT_KEPT).
    _text(
        "wt-known-deviations-detail", "EXCEPTIONS", 0,
        "When did each instance happen, what caused it, and how was it resolved?",
        "Each deviation is traced to its records and assessed for its cause and effect.",
        ("EVIDENCE", "SAMPLE"),
        "The known instances, their dates, causes and resolution are as follows: {answer}.",
        when=("wt-known-deviations", "Yes"),
    ),
    _yes_no(
        "wt-changes-in-period", "CHANGES", 10,
        "Did the control, its system, its tool, the people who perform it or its process change "
        "at any time in the period?",
        "A control that changed is tested as each version operated, so the population and the "
        "sample are split at the date of the change.",
        ("PERIOD", "POPULATION", "SAMPLE"),
        yes="The control, its system, its tool, the people who perform it or its process "
        "changed during the period.",
        no="The control, its system, its tool, the people who perform it and its process did "
        "not change during the period.",
    ),
    _multi(
        "wt-changes-in-period-what", "CHANGES", 0,
        "What changed in the period?",
        "What changed decides which attributes are tested against each version and whether "
        "the earlier version needs a test of its own.",
        ("PERIOD", "SAMPLE"),
        ("The system or its version", "The tool", "The people who perform it", "The process",
         "The control's design"),
        "What changed in the period was {answer}.",
        when=("wt-changes-in-period", "Yes"),
    ),
    # A narrative: the dates and the two ways the control ran are the client's (TEXT_KEPT).
    _text(
        "wt-changes-in-period-detail", "CHANGES", 0,
        "When did each change take effect, and how did the control operate before and after "
        "it?",
        "The date of the change decides which version each sample item is tested against, and "
        "how each version operated is what each is tested for.",
        ("PERIOD", "SAMPLE"),
        "The dates of the change, and how the control operated before and after it, are as "
        "follows: {answer}.",
        when=("wt-changes-in-period", "Yes"),
    ),
    _yes_no(
        "wt-service-org", "SERVICE_ORG", 10,
        "Does a service organization perform any part of this control, or host the system or "
        "tool it relies on?",
        "Work performed by a service organization is supported by its SOC 1 report and the "
        "user entity's own complementary controls rather than tested directly.",
        ("RELIANCE", "SCOPE"),
        yes="A service organization performs part of the control or hosts the system or tool "
        "it relies on.",
        no="No service organization performs part of the control or hosts the system or tool "
        "it relies on.",
    ),
    # A MULTI, not a CHOICE: a control on several systems can rely on several service
    # organizations, each with its own report.
    _multi(
        "wt-service-org-report", "SERVICE_ORG", 0,
        "Which SOC 1 report does the service organization provide?",
        "Only a Type 2 report covering the period supports reliance on the service "
        "organization's controls, so a gap needs a bridge letter and a Type 1 report or none "
        "changes what is tested here.",
        ("RELIANCE", "EVIDENCE"),
        ("A SOC 1 Type 2 report covering the period",
         "A SOC 1 Type 2 report covering part of the period (bridge letter needed)",
         "A SOC 1 Type 1 report only", "No SOC 1 report"),
        "The service organization provides {answer}.",
        when=("wt-service-org", "Yes"),
    ),
    # Short text: the organization's name and the controls its report lists are its own
    # (TEXT_KEPT).
    _text(
        "wt-service-org-detail", "SERVICE_ORG", 0,
        "Which service organization is it, and which complementary user entity controls in its "
        "report does this control rely on?",
        "The complementary controls the report expects of the user entity decide what is "
        "requested from the service organization and what is tested here.",
        ("RELIANCE", "EVIDENCE"),
        "The service organization and the complementary user entity controls relied on are "
        "as follows: {answer}.",
        when=("wt-service-org", "Yes"),
    ),
    _choice(
        "wt-volume", "VOLUME", 10,
        "About how many times did the control operate in the period, for example how many "
        "requests, changes or removals?",
        "The planned sample size depends on the size of the population, and a small population "
        "may be tested in full; the population obtained settles it.",
        ("SAMPLE",),
        ("Fewer than 25", "25 to 100", "101 to 250", "251 to 1,000", "More than 1,000",
         "Not known yet"),
        "The number of times the control operated in the period is {answer}.",
        # A range the planned sample size is read from: a free-text figure would not be.
        required=False, natures=("MANUAL", "IT_DEPENDENT_MANUAL"), allows_other=False,
    ),
)  # fmt: skip

# Family questions. A family question named in _LIMITED_TO is asked only for those controls;
# its attribute keys must exist for every control it is asked for.

_ACCESS: tuple[Question, ...] = (
    _multi(
        "wt-ac-layers", "SCOPE", 10,
        "Which layers of the system does this control cover?",
        "Each layer has its own accounts, so each layer covered is a population of its own and "
        "a layer left out is a scope gap.",
        ("SCOPE", "POPULATION"),
        ("Application", "Database", "Operating system", "Directory or single sign-on service"),
        "The control covers access to the {answer}.",
    ),
    _multi(
        "wt-ac-population-source", "POPULATION", 10,
        "How is the listing this control works from produced from the system?",
        "The listing is information produced by the entity, so how it is produced decides how "
        "its completeness and accuracy are tested.",
        ("POPULATION", "EVIDENCE"),
        ("A standard report in the system", "A custom query or script",
         "An identity governance tool", "A listing compiled by hand"),
        "The listing the control works from comes from {answer}.",
    ),
)  # fmt: skip

_CHANGE: tuple[Question, ...] = (
    _multi(
        "wt-cm-change-types", "SCOPE", 10,
        "Which kinds of change does this process handle?",
        "Standard, normal and emergency changes follow different approvals, so each kind is "
        "tested against its own criteria and may be a population of its own.",
        ("SCOPE", "POPULATION"),
        ("Standard (pre-approved)", "Normal", "Emergency"),
        "The process handles {answer} changes.",
    ),
    _multi(
        "wt-cm-components", "SCOPE", 20,
        "Which parts of the system do changes under this control cover?",
        "A part of the system whose changes take another route is out of this population and "
        "needs its own control.",
        ("SCOPE", "POPULATION"),
        ("Application code and programs", "Configuration", "Database structure",
         "Operating system and infrastructure", "Interfaces and scheduled jobs"),
        "Changes under this control cover {answer}.",
    ),
    _multi(
        "wt-cm-who-deploys", "EXECUTION", 10,
        "Who can move a change into production?",
        "Whoever deploys must be independent of whoever developed the change, so the answer "
        "sets whose deployment rights are listed and compared with the developers.",
        ("cm03-listing", "cm03-separate"),
        ("A separate release or operations team", "An automated pipeline after approval",
         "Developers after an approval step", "Developers without a separate check"),
        "Changes are moved into production by {answer}.",
    ),
    _yes_no(
        "wt-cm-environments", "EXECUTION", 20,
        "Are development, test and production kept as separate environments?",
        "Testing in a non-production environment is an attribute, and it cannot be met when "
        "the environments are not separate.",
        ("cm01-environment",),
        yes="Development, test and production are kept as separate environments.",
        no="Development, test and production are not kept as fully separate environments.",
    ),
    _multi(
        "wt-cm-environments-shared", "EXECUTION", 0,
        "Which environments are shared?",
        "Which environments are shared decides whether a change can be tested apart from "
        "production and whether a design gap is raised.",
        ("cm01-environment",),
        ("Development is shared with test", "Test is shared with production",
         "Development is shared with production"),
        "Of the environments, {answer}.",
        when=("wt-cm-environments", "No"),
    ),
    _multi(
        "wt-cm-environments-tested", "EXECUTION", 0,
        "Where are changes tested before they reach production?",
        "The environment named in each change's test results is evaluated against where "
        "changes are tested, and testing in production fails the attribute.",
        ("cm01-environment", "EVIDENCE"),
        ("A shared development and test environment", "A copy of production",
         "Production itself"),
        "Before they reach users, changes are tested in {answer}.",
        when=("wt-cm-environments", "No"),
    ),
    _multi(
        "wt-cm-population-source", "POPULATION", 10,
        "How will the list of changes made to production in the period be produced?",
        "The population must come from the system's own record of what changed, since a list "
        "of tickets alone cannot show a change made without one.",
        ("POPULATION", "EVIDENCE"),
        ("The system's own log (transports, deployments, changes or patches)",
         "The deployment pipeline's history", "The change tickets", "A source not yet decided"),
        "The list of changes made to production comes from {answer}.",
    ),
    _multi(
        "wt-cm-vendor-changes", "SERVICE_ORG", 0,
        "Does the service organization deliver changes or patches to the system, and how do "
        "they reach production?",
        "Changes the vendor deploys itself are covered by its SOC 1 report, while those that "
        "pass through this process belong in this population.",
        ("POPULATION", "RELIANCE"),
        ("Does not change the system", "Delivers changes that pass through this same process",
         "Deploys changes directly (software as a service)"),
        "The service organization {answer}.",
        when=("wt-service-org", "Yes"),
    ),
)  # fmt: skip

FAMILY_QUESTIONS: dict[str, tuple[Question, ...]] = {"ACCESS": _ACCESS, "CHANGE": _CHANGE}

# A family question asked only for the controls named; a family question not named here is
# asked for every control in its family.
_LIMITED_TO: dict[str, frozenset[str]] = {
    "wt-ac-layers": frozenset(
        {
            "access-provisioning",
            "access-termination",
            "access-review",
            "access-privileged",
            "access-authentication",
            "access-shared-accounts",
        }
    ),
    "wt-ac-population-source": frozenset(
        {"access-review", "access-privileged", "access-direct-db-os"}
    ),
    "wt-cm-change-types": frozenset({"change-approval"}),
    "wt-cm-components": frozenset({"change-approval", "change-segregation"}),
    "wt-cm-who-deploys": frozenset({"change-segregation"}),
    "wt-cm-environments": frozenset({"change-approval"}),
    "wt-cm-environments-shared": frozenset({"change-approval"}),
    "wt-cm-environments-tested": frozenset({"change-approval"}),
    "wt-cm-population-source": frozenset({"change-approval", "change-emergency"}),
    "wt-cm-vendor-changes": frozenset(
        {
            "change-approval",
            "change-emergency",
            "change-configuration",
            "change-patching",
            "change-sdlc",
        }
    ),
}

# Control-specific questions, by library key.

CONTROL_QUESTIONS: dict[str, tuple[Question, ...]] = {}


def _bank(library_key: str, *questions: Question) -> None:
    CONTROL_QUESTIONS[library_key] = questions


# ITGC-AC-01 New user access is approved.
_bank(
    "access-provisioning",
    _multi(
        "wt-ac01-account-types", "SCOPE", 20,
        "Which kinds of accounts does this request process cover?",
        "Account types the process does not cover need their own control, and those it covers "
        "are all part of the population the sample is drawn from.",
        ("SCOPE", "POPULATION"),
        ("Employees", "Contractors", "Service or system accounts", "Privileged roles",
         "Emergency access"),
        "The request process covers {answer}.",
    ),
    _multi(
        "wt-ac01-authority", "APPROVAL", 10,
        "How is the approver's authority to approve established?",
        "Each sampled approval is tested against the approver this source names, and the "
        "source itself is requested as evidence.",
        ("ac01-approver", "EVIDENCE"),
        ("The manager of record in the HR system", "A role-owner matrix"),
        "The approver's authority comes from {answer}.",
    ),
    _yes_no(
        "wt-ac01-enforced-approval", "APPROVAL", 20,
        "Does the request tool stop a request from moving to provisioning until the approval is "
        "recorded?",
        "An approval the tool enforces is evidenced by its configuration, while one by "
        "procedure only must be dated against the grant request by request.",
        ("ac01-before", "EVIDENCE"),
        yes="The request tool does not let a request move to provisioning until the approval "
        "is recorded.",
        no="The request tool does not stop a request moving to provisioning before the "
        "approval is recorded.",
    ),
    _multi(
        "wt-ac01-provisioning", "EXECUTION", 10,
        "How is approved access granted in the system?",
        "Access granted by a connector is tested through its configuration, while a manual "
        "grant or group change is compared with its approval item by item where it was made.",
        ("ac01-matches", "EVIDENCE"),
        ("Manually by an administrator in the application",
         "By an administrator adding the user to a directory group",
         "Automatically by an identity management tool"),
        "Approved access is granted {answer}.",
    ),
    _choice(
        "wt-ac01-self-approval", "SEGREGATION", 10,
        "Can the user who receives the access, or the administrator who grants it, approve the "
        "request?",
        "The approver must be neither the user nor the granting administrator, and a system "
        "block is tested once in configuration while a policy is tested for every sample item.",
        ("ac01-not-self", "EVIDENCE"),
        _PREVENTED,
        "Approval of a request by its user or by the administrator who grants it is {answer}.",
    ),
    _yes_no(
        "wt-ac01-sod-check", "SEGREGATION", 20,
        "Is each request checked for segregation-of-duties conflicts before the access is "
        "granted?",
        "A conflict check before the grant is evidenced for each sampled request, and without "
        "one conflicting access is left to the segregation-of-duties control.",
        ("SCOPE", "EVIDENCE"),
        yes="Each request is checked for segregation-of-duties conflicts before the access is "
        "granted.",
        no="Requests are not checked for segregation-of-duties conflicts before the access is "
        "granted.",
    ),
    _multi(
        "wt-ac01-sod-method", "SEGREGATION", 0,
        "How is the conflict check done?",
        "A check by a GRC tool rests on its ruleset and configuration, while a manual check is "
        "evidenced by the reviewer's record for each request.",
        ("EVIDENCE",),
        ("Automatically by a GRC tool", "Manually by a reviewer"),
        "The conflict check is performed {answer}.",
        when=("wt-ac01-sod-check", "Yes"),
    ),
    _yes_no(
        "wt-ac-change-logging", "POPULATION", 10,
        "Does the system itself log every account and role change, with who made it and when?",
        "The system's own log is the population of grants, independent of the request tool, "
        "and its dates show whether each approval came before the grant.",
        ("POPULATION", "ac01-before"),
        yes="The system logs every account and role change with who made it and when, and "
        "that log is the source of the population of grants.",
        no="The system does not log every account and role change with who made it and when.",
    ),
    _multi(
        "wt-ac-change-logging-gap", "POPULATION", 0,
        "Without that log, how will the team show when each account or role change was made and "
        "that none is missing?",
        "Another source of dates and completeness must be agreed before the population can be "
        "relied on.",
        ("POPULATION", "ac01-before"),
        ("The request tool's ticket history",
         "Snapshots of the user listing compared over the period",
         "The directory or identity tool's own change log", "A source not yet decided"),
        "Without that log, the grants and their dates are evidenced by {answer}.",
        when=("wt-ac-change-logging", "No"),
    ),
)  # fmt: skip

# ITGC-AC-02 Leavers' access is removed.
_bank(
    "access-termination",
    _multi(
        "wt-ac02-contractors", "SCOPE", 20,
        "How are contractor and other non-employee leavers identified?",
        "Leavers outside the HR system are missing from the HR termination list, so the "
        "population needs another source or the scope is narrowed.",
        ("SCOPE", "POPULATION"),
        ("They are in the HR system", "Their sponsor raises a ticket",
         "Their accounts expire on an end date set at creation",
         "They are not covered by this control"),
        "For contractor and other non-employee leavers, {answer}.",
    ),
    _multi(
        "wt-ac02-trigger", "INITIATION", 10,
        "How does IT learn about a termination?",
        "An automated feed is tested once through its configuration, while a ticket or report "
        "must be traced for each leaver from the termination date.",
        ("ac02-timely", "EVIDENCE"),
        ("An automated feed from the HR system", "A ticket raised by HR or the manager",
         "An emailed or shared HR report"),
        "IT learns of a termination through {answer}.",
    ),
    _yes_no(
        "wt-ac02-involuntary", "INITIATION", 20,
        "Are involuntary terminations handled differently from resignations?",
        "Involuntary leavers carry more risk and often a shorter deadline, which changes the "
        "criterion and may justify selecting them separately.",
        ("ac02-timely", "SAMPLE"),
        yes="Involuntary terminations are handled differently from resignations.",
        no="Involuntary terminations follow the same process as resignations.",
    ),
    # Split from "how are they handled, and what deadline applies": the deadline is the
    # criterion; how IT learns of a leaver is asked for every leaver (wt-ac02-trigger).
    _choice(
        "wt-ac02-involuntary-deadline", "INITIATION", 0,
        "What deadline applies to removing an involuntary leaver's access?",
        "The deadline for involuntary leavers is the criterion their removal is tested against.",
        ("ac02-timely",),
        ("Before or as the person is told", "By the end of the termination day",
         "Within 24 hours of the termination", "Within the deadline for every leaver"),
        "An involuntary leaver's access is removed {answer}.",
        when=("wt-ac02-involuntary", "Yes"),
    ),
    _choice(
        "wt-ac02-disable-delete", "EXECUTION", 10,
        "What is done to a leaver's account?",
        "A disabled account is evidenced by its status and date, a deleted one by the deletion "
        "log, which changes what is requested.",
        ("ac02-removed", "EVIDENCE"),
        ("Disabled", "Deleted", "Disabled, then deleted later"),
        "A leaver's account is {answer}.",
    ),
    _yes_no(
        "wt-ac02-directory-only", "EXECUTION", 20,
        "Does disabling the leaver's directory or SSO account alone stop them signing in to the "
        "system?",
        "If the system accepts only directory sign-in, removal in the directory meets the "
        "attribute; otherwise every local account must be removed too.",
        ("ac02-accounts",),
        yes="Disabling a leaver's directory or single sign-on account alone stops them signing "
        "in to the system.",
        no="Disabling a leaver's directory or single sign-on account alone does not stop them "
        "signing in to the system.",
    ),
    _yes_no(
        "wt-ac02-removal-record", "RECORDS", 10,
        "Does the system record the date each account was disabled or removed, and who did it?",
        "The system's own record of the change is the evidence of the removal and its date, "
        "and without it removal and timeliness must be shown another way.",
        ("ac02-removed", "ac02-timely", "EVIDENCE"),
        yes="The system records the date each account was disabled or removed and who did it.",
        no="The system does not record the date each account was disabled or removed.",
    ),
    _multi(
        "wt-ac02-leaver-list", "POPULATION", 10,
        "How is the list of leavers in the period produced from the HR system?",
        "The leaver list is the population and information produced by the entity, so how it "
        "is produced decides how its completeness is tested.",
        ("POPULATION", "EVIDENCE"),
        ("A standard HR termination report", "A custom query or report",
         "Records compiled by hand"),
        "The list of leavers comes from {answer}.",
    ),
)  # fmt: skip

# ITGC-AC-03 User access is reviewed.
_bank(
    "access-review",
    _multi(
        "wt-ac03-coverage", "SCOPE", 20,
        "Which accounts does the review include?",
        "Accounts the review leaves out are not covered by it, and the listing is agreed to the "
        "system for those it includes.",
        ("SCOPE", "ac03-listing"),
        ("Employee accounts", "Third-party accounts", "Service accounts",
         "Privileged accounts", "Disabled accounts"),
        "The review includes {answer}.",
    ),
    _multi(
        "wt-ac03-what-checked", "EXECUTION", 10,
        "What does the reviewer check for each user?",
        "What the reviewer is expected to check sets the precision each recorded decision is "
        "tested against.",
        ("ac03-decisions",),
        ("Whether the user still needs access", "Whether each role fits the user's job",
         "Segregation-of-duties conflicts", "Accounts of people who left or moved"),
        "For each user, the reviewer checks {answer}.",
    ),
    _multi(
        "wt-ac03-performed-in", "EXECUTION", 20,
        "How is the review performed and recorded?",
        "The form of the review decides what is requested as evidence of each decision and the "
        "sign-off.",
        ("ac03-decisions", "EVIDENCE"),
        ("In an identity governance tool", "In a spreadsheet signed off or emailed back",
         "On a printed listing signed by hand"),
        "The review is performed and recorded {answer}.",
    ),
    _yes_no(
        "wt-ac03-remediation-check", "EXECUTION", 30,
        "Does anyone confirm in the system that each requested removal or change was made?",
        "A recorded confirmation is evidence the tester inspects and reperforms, while without "
        "one each requested change is traced to the system's own record.",
        ("ac03-actioned", "EVIDENCE"),
        yes="Someone confirms in the system that each removal or change the reviewer requested "
        "was made.",
        no="No one confirms in the system that each removal or change the reviewer requested "
        "was made.",
    ),
    _multi(
        "wt-ac03-own-access", "SEGREGATION", 10,
        "How is a reviewer's own access reviewed?",
        "A reviewer deciding on their own access is not independent, so the attribute is "
        "tested against how this is prevented.",
        ("ac03-reviewer",),
        ("Reviewed by someone else", "Excluded by the tool from the reviewer's own list",
         "Not handled separately"),
        "A reviewer's own access is {answer}.",
    ),
    _yes_no(
        "wt-ac03-investigation", "EXCEPTIONS", 10,
        "When the review finds access that should not have been held, is its use checked for "
        "unauthorized activity?",
        "Investigating what inappropriate access was used for is an attribute, and the record "
        "of that check is the evidence requested.",
        ("ac03-investigated", "EVIDENCE"),
        yes="Access the review finds inappropriate is checked for unauthorized activity "
        "performed with it.",
        no="Access the review finds inappropriate is not checked for unauthorized activity.",
    ),
    _yes_no(
        "wt-ac03-listing-check", "POPULATION", 20,
        "Before the review starts, does anyone check that the listing is complete, for example "
        "by agreeing its count to the system?",
        "The listing's completeness is an attribute, and a check the organization performs is "
        "evidence the tester can inspect and reperform.",
        ("ac03-listing", "EVIDENCE"),
        yes="Before the review starts, the listing is checked for completeness against the "
        "system.",
        no="The listing is not checked for completeness before the review starts.",
    ),
)  # fmt: skip

# ITGC-AC-04 Privileged access is reviewed.
_bank(
    "access-privileged",
    _multi(
        "wt-ac04-who-holds", "SCOPE", 20,
        "Who holds privileged access?",
        "Each group of holders must be on the listing, so a group that is missing is a gap in "
        "the listing's completeness.",
        ("SCOPE", "ac04-complete"),
        ("IT administrators", "Database administrators", "Developers or support staff",
         "Vendor or outsourced staff", "Business users with powerful roles", "Service accounts"),
        "Privileged access is held by {answer}.",
    ),
    _yes_no(
        "wt-ac04-pam", "SCOPE", 30,
        "Is privileged access managed through a privileged access tool that vaults passwords or "
        "grants access only when needed?",
        "A privileged access tool changes where holders are recorded, so the listing must cover "
        "both the accounts in the tool and those outside it.",
        ("POPULATION", "EVIDENCE"),
        yes="Privileged access is managed through a privileged access tool.",
        no="Privileged access is not managed through a privileged access tool.",
    ),
    _yes_no(
        "wt-ac04-reviewer-holds", "SEGREGATION", 10,
        "Does the reviewer hold any of the privileged access being reviewed?",
        "A reviewer who holds the access cannot independently confirm it, so their own access "
        "needs another decision-maker.",
        ("ac04-independent",),
        yes="The reviewer holds some of the privileged access being reviewed.",
        no="The reviewer holds none of the privileged access being reviewed.",
    ),
    _multi(
        "wt-ac04-reviewer-own", "SEGREGATION", 0,
        "Who decides whether the reviewer keeps their own privileged access?",
        "That person's decision is the evidence for the independence attribute.",
        ("ac04-independent", "EVIDENCE"),
        ("The reviewer's manager", "Another member of the review team",
         "The system or data owner", "The head of IT or the CISO"),
        "The reviewer's own privileged access is decided by {answer}.",
        when=("wt-ac04-reviewer-holds", "Yes"),
    ),
    _yes_no(
        "wt-ac04-listing-check", "POPULATION", 20,
        "Is the privileged listing checked against each layer's own list of administrators "
        "before it is reviewed?",
        "The listing must agree to the system's privileged users, and the organization's own "
        "check is "
        "evidence the tester can reperform.",
        ("ac04-complete", "EVIDENCE"),
        yes="Before it is reviewed, the privileged listing is checked against each layer's own "
        "list of administrators.",
        no="The privileged listing is not checked against each layer's own list of "
        "administrators before it is reviewed.",
    ),
)  # fmt: skip

# ITGC-AC-05 Authentication settings: the settings themselves are asked by
# authentication_profile.py; these are about scope and the settings' history only.
_bank(
    "access-authentication",
    _yes_no(
        "wt-ac05-other-paths", "SCOPE", 20,
        "Can anyone sign in to the system by a route that bypasses the required settings, such "
        "as a direct database connection or a vendor support login?",
        "The settings must apply to every sign-in path, so another route is either in scope "
        "with its own settings or a gap.",
        ("ac05-scope",),
        yes="Some sign-in routes, such as a direct database connection or a vendor support "
        "login, bypass the required settings.",
        no="No sign-in route bypasses the required settings.",
    ),
    _yes_no(
        "wt-ac05-exemptions", "SCOPE", 30,
        "Are any accounts or groups exempt from the required settings, such as service or "
        "break-glass accounts?",
        "Each exempt account needs a recorded approval, which becomes evidence for the scope "
        "attribute.",
        ("ac05-scope", "EVIDENCE"),
        yes="Some accounts or groups are exempt from the required settings.",
        no="No account or group is exempt from the required settings.",
    ),
    # Split from "which accounts, why, and who approved": the reason is not tested, only the
    # exemption's recorded approval.
    _multi(
        "wt-ac05-exempt-accounts", "SCOPE", 0,
        "Which kinds of accounts are exempt from the required settings?",
        "Each kind of exempt account is a group the settings do not cover, so each needs a "
        "recorded approval for the scope attribute.",
        ("ac05-scope",),
        ("Service or interface accounts", "Break-glass or emergency accounts",
         "Vendor or support accounts", "Senior executives", "Test or training accounts"),
        "The accounts exempt from the required settings are {answer}.",
        when=("wt-ac05-exemptions", "Yes"),
    ),
    _multi(
        "wt-ac05-exempt-approval", "SCOPE", 0,
        "Where is the approval of each exemption recorded?",
        "The tester agrees each exemption to its approval where it is recorded.",
        ("ac05-scope", "EVIDENCE"),
        ("In the security exception register", "In a ticket approved by IT security",
         "In an approval signed by the system owner", "Without a formal approval"),
        "Exemptions from the required settings are recorded {answer}.",
        when=("wt-ac05-exemptions", "Yes"),
    ),
    _yes_no(
        "wt-ac05-change-history", "RECORDS", 10,
        "Does the system keep a history of changes to its authentication settings, with who "
        "changed them and when?",
        "The history is the evidence that the settings stayed in place for the whole period, "
        "not only on the day they were inspected.",
        ("ac05-unchanged", "EVIDENCE"),
        yes="The system keeps a history of changes to its authentication settings, with who "
        "changed them and when.",
        no="The system keeps no history of changes to its authentication settings.",
    ),
)  # fmt: skip

# ITGC-AC-06 Shared, generic and service accounts.
_bank(
    "access-shared-accounts",
    _multi(
        "wt-ac06-types", "SCOPE", 20,
        "Which kinds of non-personal accounts exist in the system?",
        "Each kind must be in the inventory, so a kind left out is a gap in its completeness.",
        ("SCOPE", "ac06-inventory"),
        ("Shared accounts used by several people", "Generic accounts (e.g. training, test)",
         "Service or interface accounts", "Default vendor or system accounts"),
        "The system has {answer}.",
    ),
    # Split from "where is the owner recorded, and how is the owner kept current".
    _multi(
        "wt-ac06-owner-record", "EXECUTION", 10,
        "Where is each non-personal account's owner recorded?",
        "The attribute requires a named owner, and where the owner is recorded is the evidence "
        "requested for each account.",
        ("ac06-owner", "EVIDENCE"),
        ("In the account's description or owner field in the system",
         "In a register of non-personal accounts", "In an identity governance tool",
         "In a privileged access tool", "Nowhere"),
        "Each account's owner is recorded {answer}.",
    ),
    _multi(
        "wt-ac06-owner-current", "EXECUTION", 15,
        "How is an account's owner kept current when they leave or change role?",
        "An owner who has left is not a current owner, so how ownership moves decides how the "
        "attribute is tested for each account.",
        ("ac06-owner",),
        ("Reassigned through the leaver and transfer process",
         "Confirmed in each quarter's account review", "Updated by hand when someone notices",
         "Not kept current"),
        "When an owner leaves or changes role, the account's ownership is {answer}.",
    ),
    _yes_no(
        "wt-ac06-interactive", "EXECUTION", 20,
        "Can any service accounts sign in interactively?",
        "An account able to sign in interactively needs an approval, so each one is tested "
        "against it rather than against its disabled setting.",
        ("ac06-interactive",),
        yes="Some service accounts can sign in interactively.",
        no="No service account can sign in interactively.",
    ),
    _multi(
        "wt-ac06-interactive-detail", "EXECUTION", 0,
        "Where is the approval for each account's interactive use recorded?",
        "The tester agrees each interactive account to its approval.",
        ("ac06-interactive", "EVIDENCE"),
        ("In a ticket in the access request tool", "In the register of non-personal accounts",
         "In the security exception register", "In an identity governance tool"),
        "Approval of interactive use is recorded {answer}.",
        when=("wt-ac06-interactive", "Yes"),
    ),
    _multi(
        "wt-ac06-inventory-source", "POPULATION", 10,
        "How are shared, generic and service accounts identified in the system?",
        "The inventory must include every such account, and a naming convention or a register "
        "not agreed to the system can miss some.",
        ("ac06-inventory", "POPULATION"),
        ("An account type or flag in the system", "A naming convention",
         "A register agreed to the system", "A privileged access tool's vault",
         "No formal method"),
        "Shared, generic and service accounts are identified by {answer}.",
    ),
)  # fmt: skip

# ITGC-AC-07 Transfers.
_bank(
    "access-transfer",
    _multi(
        "wt-ac07-what-counts", "SCOPE", 10,
        "Which HR changes count as a transfer for this control?",
        "The definition sets the population, so changes it leaves out are not tested.",
        ("POPULATION", "SCOPE"),
        ("A new department", "A new position or job code", "A new manager", "A new location",
         "A new company code or legal entity"),
        "A transfer for this control is {answer}.",
    ),
    _multi(
        "wt-ac07-trigger", "INITIATION", 10,
        "How does IT learn that a user has transferred or changed role?",
        "A transfer IT is not told about is never acted on, so the route decides whether the "
        "population can be complete and the date the deadline runs from.",
        ("POPULATION", "ac07-timely"),
        ("An automated feed from the HR system", "A ticket raised by the new or old manager",
         "A periodic HR report", "The next access review"),
        "IT learns of a transfer through {answer}.",
    ),
    _multi(
        "wt-ac07-old-access", "EXECUTION", 10,
        "What happens to the user's existing access on transfer?",
        "The approach sets what the attributes test: removal of all old access, or a decision "
        "for each role kept.",
        ("ac07-reapproved", "ac07-removed"),
        ("All access is removed and the new role's access requested",
         "The new manager re-approves what the user keeps",
         "Old access is removed after a transition period"),
        "On transfer, {answer}.",
    ),
    # Split from "how long is the transition period, and who approves keeping old access".
    _choice(
        "wt-ac07-transition-length", "EXECUTION", 0,
        "How long can old access be kept after a transfer?",
        "Access kept for a transition period is tested against its end date rather than the "
        "transfer deadline.",
        ("ac07-timely",),
        ("Up to 2 weeks", "Up to 30 days", "Up to 90 days", "Not limited"),
        "The transition period for old access is {answer}.",
        when=("wt-ac07-old-access", "Old access is removed after a transition period"),
    ),
    _multi(
        "wt-ac07-transition-approver", "EXECUTION", 0,
        "Who approves keeping old access during the transition period?",
        "Access kept for a transition period is tested against its approval.",
        ("ac07-reapproved",),
        ("The new manager", "The old manager", "The system or role owner",
         "No one (it is kept without approval)"),
        "Keeping old access during the transition period is approved by {answer}.",
        when=("wt-ac07-old-access", "Old access is removed after a transition period"),
    ),
)  # fmt: skip

# ITGC-AC-08 Emergency (firefighter) access.
_bank(
    "access-firefighter",
    # Was "which IDs exist, and what can each do": the IDs come from the tool's own listing
    # with their sessions; what they can do sets how closely the activity is reviewed.
    _multi(
        "wt-ac08-id-rights", "SCOPE", 10,
        "What can the firefighter IDs do in the system?",
        "What the IDs can do sets how closely each session's activity is compared with its "
        "ticket and which activity falls outside its purpose.",
        ("SCOPE", "ac08-purpose"),
        ("Run any transaction (full access)", "Change master data",
         "Post or change financial transactions", "Change configuration",
         "Administer users and roles", "Change programs or the database directly"),
        "The firefighter IDs can {answer}.",
    ),
    _yes_no(
        "wt-ac08-pre-approval", "APPROVAL", 10,
        "Does the tool stop a session from starting until the approval is recorded?",
        "An approval the tool enforces is evidenced by its configuration, while one by "
        "procedure must be checked for each session.",
        ("ac08-approved", "EVIDENCE"),
        yes="The tool does not let a session start until the approval is recorded.",
        no="The tool does not stop a session starting before the approval is recorded.",
    ),
    _yes_no(
        "wt-ac08-reviewer-user", "SEGREGATION", 10,
        "Is the log reviewer ever a firefighter user themselves?",
        "A reviewer cannot review their own session, so the independence attribute is tested "
        "for each sampled session.",
        ("ac08-reviewed",),
        yes="The log reviewer can also be a firefighter user.",
        no="The log reviewer is never a firefighter user.",
    ),
    _multi(
        "wt-ac08-log-content", "RECORDS", 10,
        "What does the session log record?",
        "The reviewer can only compare the activity with the ticket's purpose if the log shows "
        "what was done.",
        ("ac08-purpose", "EVIDENCE"),
        ("Transactions or commands run", "Data and settings changed", "Start and end times",
         "The ticket and reason given"),
        "The session log records {answer}.",
    ),
    _yes_no(
        "wt-ac08-direct-signin", "POPULATION", 10,
        "Can anyone sign in with a firefighter ID directly, bypassing the tool?",
        "Sessions outside the tool are missing from its log, so the population must be agreed "
        "to the system's own sign-in log.",
        ("POPULATION",),
        yes="A firefighter ID can be used directly, bypassing the tool.",
        no="A firefighter ID cannot be used without going through the tool.",
    ),
)  # fmt: skip

# ITGC-AC-09 Third-party accounts.
_bank(
    "access-third-party",
    _multi(
        "wt-ac09-who", "SCOPE", 10,
        "Which third parties hold accounts in the system?",
        "Each kind of third party must be on the listing, so a kind left out is a gap in its "
        "completeness.",
        ("SCOPE", "ac09-complete"),
        ("Contractors working as staff", "Software vendor support staff",
         "Outsourced IT or managed service providers", "Auditors or consultants"),
        "Third-party accounts are held by {answer}.",
    ),
    _multi(
        "wt-ac09-sponsor-approval", "APPROVAL", 10,
        "Where is the internal sponsor's approval recorded when a third-party account is "
        "created?",
        "The sponsor's approval is an attribute, and its location is the evidence requested.",
        ("ac09-sponsored", "EVIDENCE"),
        ("In a ticket in the access request tool", "On a third-party access form",
         "In an email kept with the request", "In the contract or statement of work",
         "In an identity governance tool"),
        "The internal sponsor's approval is recorded {answer}.",
    ),
    _choice(
        "wt-ac09-expiry", "EXECUTION", 10,
        "How is an expiry date set on third-party accounts?",
        "An expiry the system requires is tested once in configuration, while one set by "
        "procedure is checked for each account.",
        ("ac09-expiry", "EVIDENCE"),
        ("Required by the system at creation", "Set by the administrator by procedure",
         "Not set"),
        "An expiry date on third-party accounts is {answer}.",
    ),
    _multi(
        "wt-ac09-identification", "POPULATION", 10,
        "How are third-party accounts told apart from employee accounts in the system?",
        "The listing must include every third-party account, which depends on how they are "
        "identified.",
        ("ac09-complete", "POPULATION"),
        ("An account type or flag", "A naming convention", "A separate register",
         "No reliable method"),
        "Third-party accounts are told apart from employee accounts by {answer}.",
    ),
)  # fmt: skip

# ITGC-AC-10 Segregation-of-duties rules.
_bank(
    "access-sod-rules",
    # Split from "who approves a mitigating control, and how is it shown to operate".
    _multi(
        "wt-ac10-mitigation-approver", "EXECUTION", 10,
        "Who approves a mitigating control for a conflict that is kept?",
        "A kept conflict passes only with a mitigating control approved by someone with the "
        "authority to accept the risk.",
        ("ac10-resolved",),
        ("The business process owner", "The risk or compliance function", "The user's manager",
         "The system owner"),
        "A mitigating control for a kept conflict is approved by {answer}.",
    ),
    _multi(
        "wt-ac10-mitigation-evidence", "EXECUTION", 15,
        "What shows that a mitigating control operated?",
        "A kept conflict passes only with a mitigating control that operates, and this is the "
        "evidence requested for each one.",
        ("ac10-resolved", "EVIDENCE"),
        ("A signed review of the user's activity report",
         "The control's own evidence in the GRC tool",
         "A periodic management review of the transactions", "Not kept"),
        "Evidence that a mitigating control operated is {answer}.",
    ),
    _yes_no(
        "wt-ac10-rule-change-log", "RECORDS", 10,
        "Does the tool keep a log of changes to the rules, with who made them and when?",
        "The log is the population of ruleset changes tested for approval.",
        ("ac10-rules", "EVIDENCE"),
        yes="The tool keeps a log of changes to the rules, with who made them and when.",
        no="The tool keeps no log of changes to the rules.",
    ),
    _yes_no(
        "wt-ac10-report-scope", "POPULATION", 10,
        "Is the conflict report run against every user in the system, not only active "
        "employees?",
        "The report must cover every user at its production date, including service and "
        "firefighter accounts.",
        ("ac10-complete", "POPULATION"),
        yes="The conflict report is run against every user in the system, not only active "
        "employees.",
        no="The conflict report is not run against every user in the system.",
    ),
)  # fmt: skip

# ITGC-AC-11 Direct database and operating-system access.
_bank(
    "access-direct-db-os",
    # Split from "which platforms, and how many servers or instances".
    _multi(
        "wt-ac11-platforms", "SCOPE", 10,
        "Which database and operating-system platforms host the system?",
        "Each platform has its own accounts and catalogue of privileges, so each is a listing "
        "to obtain and agree.",
        ("SCOPE", "POPULATION"),
        ("An Oracle database", "A Microsoft SQL Server database", "An SAP HANA database",
         "An IBM Db2 database", "A PostgreSQL or MySQL database", "Servers running Linux",
         "Servers running Windows", "Servers running Unix (AIX, Solaris or HP-UX)"),
        "The system is hosted on {answer}.",
    ),
    _choice(
        "wt-ac11-instances", "SCOPE", 15,
        "How many database and server instances are in scope?",
        "Each instance has its own accounts, so the number of instances is the number of "
        "listings requested and agreed.",
        ("SCOPE", "POPULATION"),
        ("1 to 2", "3 to 5", "6 to 20", "More than 20"),
        "The number of database and server instances in scope is {answer}.",
    ),
    _multi(
        "wt-ac11-default-accounts", "EXECUTION", 10,
        "How are built-in administrator accounts such as root, sa or SYS controlled?",
        "Built-in accounts carry full rights, and how they are controlled decides how they are "
        "tested against the roles the procedure allows.",
        ("ac11-restricted",),
        ("Disabled or locked", "Password vaulted with check-out",
         "Used by named administrators with a shared password", "Not controlled"),
        "Built-in administrator accounts such as root, sa or SYS are {answer}.",
    ),
    _multi(
        "wt-ac11-log-destination", "RECORDS", 10,
        "Where are privileged database and operating-system activity logs sent?",
        "The log must go where the administrators cannot alter it, which the configuration "
        "evidence must show.",
        ("ac11-logged", "EVIDENCE"),
        ("Sent to a central log the administrators cannot change", "Stored on the same server",
         "Not logged"),
        "Privileged database and operating-system activity is {answer}.",
    ),
    _yes_no(
        "wt-ac11-group-access", "POPULATION", 20,
        "Does the listing include access given through server or directory groups, such as "
        "local administrators or sudo rights?",
        "Access through groups is easily missed, and the listing must agree to each layer's own "
        "catalogue.",
        ("ac11-complete",),
        yes="The listing includes access given through server or directory groups, such as "
        "local administrators or sudo rights.",
        no="The listing does not include access given through server or directory groups.",
    ),
)  # fmt: skip

# ITGC-AC-12 Security monitoring.
_bank(
    "access-security-monitoring",
    _multi(
        "wt-ac12-sources", "SCOPE", 10,
        "Which log sources feed the monitoring tool for this system?",
        "A source not collected cannot raise an alert, so each source is part of the scope and "
        "its configuration is requested.",
        ("ac12-sources", "SCOPE"),
        ("Application security log", "Database audit log", "Operating-system logs",
         "Directory or SSO sign-in logs", "Network and firewall logs"),
        "The monitoring tool collects the {answer}.",
    ),
    # Was "how is an alert triaged and closed, and what must its record show": the attribute
    # already requires a recorded outcome, so what is asked is where it is recorded.
    _multi(
        "wt-ac12-triage", "EXECUTION", 10,
        "Where is each alert's investigation and outcome recorded?",
        "The record of each alert's investigation is the evidence its outcome is judged from.",
        ("ac12-reviewed", "EVIDENCE"),
        ("As a case in the monitoring tool", "In a ticket in the service desk tool",
         "In the managed security provider's portal or reports",
         "In a log or spreadsheet kept by the team"),
        "Each alert's investigation and outcome are recorded {answer}.",
    ),
    _yes_no(
        "wt-ac12-weekends", "EXECUTION", 20,
        "Are alerts raised on weekends and holidays reviewed?",
        "Days without a review are part of the population of days and change what the sample "
        "is drawn from.",
        ("SAMPLE", "POPULATION"),
        yes="Alerts raised on weekends and holidays are reviewed.",
        no="Alerts raised on weekends and holidays are not reviewed.",
    ),
    _yes_no(
        "wt-ac12-source-failure", "RECORDS", 10,
        "Is an alert raised when a log source stops sending events?",
        "Collection throughout the window is an attribute, and a silent source would leave a "
        "gap no alert reveals.",
        ("ac12-sources",),
        yes="An alert is raised when a log source stops sending events.",
        no="No alert is raised when a log source stops sending events.",
    ),
    # Was "to whom, how quickly, and where recorded": the attribute tests that the incident
    # was escalated under the incident procedure, not a deadline, so the route and its record
    # are what is asked.
    _multi(
        "wt-ac12-escalation", "EXCEPTIONS", 10,
        "How is a suspected security incident escalated and recorded?",
        "Escalation is an attribute for alerts that found unauthorized access or change, and "
        "its record is the evidence requested.",
        ("ac12-escalated", "EVIDENCE"),
        ("As an incident ticket under the incident procedure",
         "As a case in the monitoring tool marked as an incident",
         "Through the managed security provider's incident response",
         "By email or phone to the IT security manager"),
        "A suspected security incident is escalated {answer}.",
    ),
    _yes_no(
        "wt-ac12-alert-listing", "POPULATION", 10,
        "Can the tool produce a list of every alert raised on a given day, including closed "
        "ones?",
        "The alert listing is the population for each selected day and is tested for "
        "completeness.",
        ("POPULATION", "ac12-reviewed"),
        yes="The tool can list every alert raised on a given day, including closed ones.",
        no="The tool cannot list every alert raised on a given day.",
    ),
)  # fmt: skip

# ITGC-CM-01 Changes are tested and approved.
_bank(
    "change-approval",
    # Split from "which changes are pre-approved as standard, and who approved that list".
    _multi(
        "wt-cm01-standard-changes", "SCOPE", 0,
        "Which kinds of change are pre-approved as standard?",
        "Standard changes are tested against the approved list rather than an approval for "
        "each one.",
        ("cm01-approved", "POPULATION"),
        ("Routine patches or updates", "Master or reference data table updates",
         "Report or layout changes", "Job schedule changes",
         "Configuration changes from an approved catalogue"),
        "The changes pre-approved as standard are {answer}.",
        when=("wt-cm-change-types", "Standard (pre-approved)"),
    ),
    _multi(
        "wt-cm01-standard-approver", "SCOPE", 0,
        "Who approved the list of standard changes?",
        "The approved list stands in for each standard change's own approval, so its approval "
        "is the evidence requested.",
        ("cm01-approved", "EVIDENCE"),
        ("The change advisory board", "The IT change manager", "The system owner",
         "IT management"),
        "The list of standard changes was approved by {answer}.",
        when=("wt-cm-change-types", "Standard (pre-approved)"),
    ),
    _yes_no(
        "wt-cm01-approval-enforced", "APPROVAL", 10,
        "Does the tool or pipeline block deployment until the approvals are recorded?",
        "Approval the tool enforces is evidenced by its configuration, while approval by "
        "procedure must be compared with the deployment date for each change.",
        ("cm01-approved", "EVIDENCE"),
        yes="The tool or pipeline blocks deployment until the approvals are recorded.",
        no="The tool or pipeline does not block deployment before the approvals are recorded.",
    ),
    _multi(
        "wt-cm01-testing-who", "EXECUTION", 10,
        "Who tests a change before it is approved?",
        "Who tests decides whose test results and sign-off are the evidence the testing "
        "attribute is judged from.",
        ("cm01-tested", "EVIDENCE"),
        ("Developers (unit testing)", "An independent testing team",
         "Business users (user acceptance testing)"),
        "Changes are tested before approval by {answer}.",
    ),
    _choice(
        "wt-cm01-approver-independent", "SEGREGATION", 10,
        "Can the person who developed or deployed a change also approve it?",
        "Neither approver may have developed or implemented the change, and a system block is "
        "tested once in configuration while a policy is tested for every sampled change.",
        ("cm01-segregated", "EVIDENCE"),
        _PREVENTED,
        "Approval of a change by the person who developed or deployed it is {answer}.",
    ),
    _yes_no(
        "wt-cm01-version-match", "RECORDS", 10,
        "Can the object or version deployed be traced to the approved ticket, for example by a "
        "ticket number on the transport or commit?",
        "The deployed object must be the one approved, and the link between them is the "
        "evidence.",
        ("cm01-matches", "EVIDENCE"),
        yes="The object or version deployed can be traced to its approved ticket.",
        no="The object or version deployed cannot be traced directly to its approved ticket.",
    ),
)  # fmt: skip

# ITGC-CM-02 Emergency changes.
_bank(
    "change-emergency",
    # Split from "who can declare a change an emergency, and is that decision recorded".
    _multi(
        "wt-cm02-who-declares", "INITIATION", 10,
        "Who can declare a change an emergency?",
        "Whether the change met the emergency criteria is an attribute, judged from the "
        "decision of whoever may declare one.",
        ("cm02-classified",),
        ("The change manager", "An IT manager on call", "The system or business owner",
         "An emergency change advisory board", "The engineer making the change"),
        "A change can be declared an emergency by {answer}.",
    ),
    _multi(
        "wt-cm02-decision-record", "INITIATION", 20,
        "Where is the decision to treat a change as an emergency recorded, with its reason?",
        "Whether the change met the emergency criteria is judged from the recorded decision "
        "and its reason, which is the evidence requested.",
        ("cm02-classified", "EVIDENCE"),
        ("In the change ticket's emergency flag and reason",
         "In the incident ticket that caused it", "In an email or chat message", "Nowhere"),
        "The decision and its reason are recorded {answer}.",
    ),
    _multi(
        "wt-cm02-access-used", "EXECUTION", 10,
        "What access is used to deploy an emergency change?",
        "Emergency changes made with firefighter or a developer's elevated access bring that "
        "access into scope and show who made the change.",
        ("SCOPE", "cm02-independent"),
        ("The normal deployment access", "Firefighter or emergency access",
         "A developer's elevated access"),
        "Emergency changes are deployed with {answer}.",
    ),
    _choice(
        "wt-cm02-approver-independent", "SEGREGATION", 10,
        "Can the person who made an emergency change also give its approval after deployment?",
        "The retrospective approver must not have made the change, and a system block is "
        "tested once in configuration while a policy is tested for every sampled change.",
        ("cm02-independent", "EVIDENCE"),
        _PREVENTED,
        "Approval of an emergency change by the person who made it is {answer}.",
    ),
    _yes_no(
        "wt-cm02-flag", "POPULATION", 20,
        "Are emergency changes flagged as emergency in the change tool or deployment log?",
        "The population of emergency changes depends on how they are identified, and an "
        "unflagged one cannot be selected.",
        ("POPULATION", "SAMPLE"),
        yes="Emergency changes are flagged as emergency in the change tool or deployment log.",
        no="Emergency changes are not flagged as emergency in the change tool or deployment "
        "log.",
    ),
)  # fmt: skip

# ITGC-CM-03 Developers cannot deploy.
_bank(
    "change-segregation",
    _yes_no(
        "wt-cm03-approved-list", "EXECUTION", 20,
        "Is there an approved list of who should be in the deployment group, which the review "
        "compares against?",
        "Every account with deployment rights is tested as on the approved list.",
        ("cm03-authorized", "EVIDENCE"),
        yes="An approved list sets who should be in the deployment group, and the review "
        "compares against it.",
        no="No approved list sets who should be in the deployment group.",
    ),
    _yes_no(
        "wt-cm03-small-team", "SEGREGATION", 10,
        "Are there people who both develop and deploy, for example because the team is small?",
        "Known overlap is a conflict the review must find, unless a compensating control or an "
        "approved exception covers it.",
        ("cm03-separate", "cm03-signoff"),
        yes="Some people both develop and deploy changes.",
        no="No one both develops and deploys changes.",
    ),
    # Split from "what covers them, who approved it, and how long does it last".
    _multi(
        "wt-cm03-compensating", "SEGREGATION", 0,
        "What covers the people who both develop and deploy?",
        "A conflict passes only when an approved, current exception or a tested compensating "
        "control covers it.",
        ("cm03-signoff", "SCOPE"),
        ("An independent review of each change they deploy",
         "A periodic management review of the deployment log",
         "An approved segregation exception", "Nothing yet"),
        "The overlap is covered by {answer}.",
        when=("wt-cm03-small-team", "Yes"),
    ),
    _multi(
        "wt-cm03-exception-approver", "SEGREGATION", 0,
        "Who approved the exception or compensating control for that overlap?",
        "An exception or compensating control covers a conflict only when it was approved, and "
        "the approval is the evidence requested.",
        ("cm03-signoff", "EVIDENCE"),
        ("The head of IT or the CIO", "The system owner", "The risk or compliance function",
         "No one"),
        "The exception or compensating control was approved by {answer}.",
        when=("wt-cm03-small-team", "Yes"),
    ),
    _choice(
        "wt-cm03-exception-term", "SEGREGATION", 0,
        "For how long does the exception or compensating control apply?",
        "An exception that ends within the period leaves the rest of the period uncovered, "
        "which the sign-off attribute is tested against.",
        ("cm03-signoff",),
        ("For the whole period", "Until a date within the period", "With no end date"),
        "The exception or compensating control applies {answer}.",
        when=("wt-cm03-small-team", "Yes"),
    ),
    _multi(
        "wt-cm03-deploy-rights", "POPULATION", 10,
        "Which kinds of access give the ability to deploy to production?",
        "The deployment access listing must include every holder of these rights, including "
        "service accounts.",
        ("cm03-listing", "POPULATION"),
        ("A transport or release management role in the application",
         "Write access to the deployment pipeline's production stage",
         "Membership of a release or operations group in the directory",
         "Administrator access to the application", "Administrator or root access to the servers",
         "Database administrator access"),
        "The ability to deploy to production comes from {answer}.",
    ),
    _yes_no(
        "wt-cm03-service-accounts", "POPULATION", 20,
        "Can any person use a pipeline or service account that has deployment rights?",
        "A shared deployment account lets a developer deploy without appearing on the listing.",
        ("cm03-listing",),
        yes="People can use a pipeline or service account that has deployment rights.",
        no="No person can use a pipeline or service account that has deployment rights.",
    ),
    _multi(
        "wt-cm03-developer-list", "POPULATION", 30,
        "How is the list of developers for the system kept?",
        "The developer list is compared with the deployers, so its source and completeness "
        "matter as much as the deployer listing.",
        ("cm03-separate", "EVIDENCE"),
        ("Membership of a developer group in the system or directory",
         "A list kept by the development manager", "Developer keys or licences in the system",
         "No maintained source"),
        "The list of developers comes from {answer}.",
    ),
)  # fmt: skip

# ITGC-CM-04 Configuration changes.
_bank(
    "change-configuration",
    _multi(
        "wt-cm04-who-can-configure", "SCOPE", 10,
        "Who can change the in-scope configuration in production?",
        "Everyone able to change the configuration is a source of changes the log must capture.",
        ("SCOPE", "POPULATION"),
        ("Named configuration administrators", "Key business users with configuration roles",
         "IT support staff", "The vendor"),
        "Production configuration can be changed by {answer}.",
    ),
    _multi(
        "wt-cm04-route", "EXECUTION", 10,
        "How are configuration changes made in production?",
        "Changes transported from development follow program change control, while changes "
        "made directly in production are matched to their approval from the log.",
        ("SCOPE", "cm04-matches"),
        ("By transport from development", "By being made directly in production"),
        "Configuration changes reach production {answer}.",
    ),
    _choice(
        "wt-cm04-approver-independent", "SEGREGATION", 10,
        "Can the person who makes a configuration change also approve it?",
        "The approver must not have made the change, and a system block is tested once in "
        "configuration while a policy is tested for every sampled change.",
        ("cm04-independent", "EVIDENCE"),
        _PREVENTED,
        "Approval of a configuration change by the person who makes it is {answer}.",
    ),
    _yes_no(
        "wt-cm04-log-enabled", "POPULATION", 10,
        "Is the configuration change log switched on for every in-scope setting?",
        "The log is the population each change is traced from to its request, so a setting "
        "not logged has no changes to sample.",
        ("POPULATION", "cm04-request"),
        yes="The configuration change log is switched on for every in-scope setting.",
        no="The configuration change log is not switched on for every in-scope setting.",
    ),
    # Split from "which settings are not logged, and how would changes to them be found".
    _multi(
        "wt-cm04-log-gap", "POPULATION", 0,
        "Which settings are not logged?",
        "Settings outside the log need another source or are a scope gap.",
        ("POPULATION", "SCOPE"),
        ("Configuration tables without change logging switched on", "System parameters",
         "Settings changed in a vendor's console", "Interface and job settings"),
        "The settings not logged are {answer}.",
        when=("wt-cm04-log-enabled", "No"),
    ),
    _multi(
        "wt-cm04-unlogged-detection", "POPULATION", 0,
        "How would changes to the settings that are not logged be found?",
        "Another way of finding those changes is the population for them, or the settings are "
        "reported as a scope gap.",
        ("POPULATION", "SCOPE"),
        ("A periodic comparison with an approved baseline", "The database's own change log",
         "A periodic review of the settings by someone independent", "Nothing"),
        "To find changes to the settings that are not logged, the organization relies on "
        "{answer}.",
        when=("wt-cm04-log-enabled", "No"),
    ),
)  # fmt: skip

# ITGC-CM-05 Direct data changes.
_bank(
    "change-data",
    _multi(
        "wt-cm05-methods", "SCOPE", 10,
        "How can production data be changed outside the normal screens?",
        "Each method is a route for direct changes, and each must be logged to be in the "
        "population.",
        ("SCOPE", "POPULATION"),
        ("Database scripts or SQL", "Data load tools", "Table maintenance transactions",
         "Vendor tools or support access"),
        "Production data can be changed outside the normal screens through {answer}.",
    ),
    _yes_no(
        "wt-cm05-authorized-list", "EXECUTION", 10,
        "Is there an approved list of the staff authorized to make direct data changes?",
        "Each change is tested as made by someone on that list, so without one the performer "
        "attribute cannot be tested as designed.",
        ("cm05-performer", "EVIDENCE"),
        yes="An approved list names the staff authorized to make direct data changes.",
        no="No approved list names the staff authorized to make direct data changes.",
    ),
    _yes_no(
        "wt-cm05-other-access", "SEGREGATION", 10,
        "Do people other than the authorized data administrators have rights to change data "
        "directly?",
        "Others with these rights could make changes outside the process, which widens the "
        "scope to their access.",
        ("cm05-performer", "SCOPE"),
        yes="People other than the authorized data administrators have rights to change data "
        "directly.",
        no="Only the authorized data administrators have rights to change data directly.",
    ),
    _yes_no(
        "wt-cm05-logging", "POPULATION", 10,
        "Does the database or system log every direct data change, including who made it?",
        "Changes outside the log cannot be found by sampling it, and the log is what each "
        "change is compared with its approval from.",
        ("POPULATION", "cm05-matches"),
        yes="The database or system logs every direct data change, including who made it.",
        no="The database or system does not log every direct data change.",
    ),
    _multi(
        "wt-cm05-logging-gap", "POPULATION", 0,
        "How would a direct data change that was not requested be found?",
        "Without a log, another detective control is needed or the gap is reported.",
        ("POPULATION", "SCOPE"),
        ("A periodic review of database activity by someone independent",
         "A reconciliation that would show an unexpected change",
         "Database activity monitoring alerts", "Nothing"),
        "Without that log, to find a data change that was not requested, the organization "
        "relies "
        "on {answer}.",
        when=("wt-cm05-logging", "No"),
    ),
)  # fmt: skip

# ITGC-CM-06 Patching.
_bank(
    "change-patching",
    _multi(
        "wt-cm06-layers", "SCOPE", 10,
        "Which layers' patches does this control cover?",
        "Each layer's patches are part of the population, and a layer left out needs its own "
        "control.",
        ("SCOPE", "POPULATION"),
        ("Operating system", "Database", "Application or vendor releases",
         "Firmware and network devices"),
        "The control covers patches for these layers: {answer}.",
    ),
    _yes_no(
        "wt-cm06-automated", "EXECUTION", 10,
        "Are any patches applied automatically by a tool on a schedule?",
        "Automatic patching moves the approval to the tool's schedule and configuration.",
        ("cm06-approved", "EVIDENCE"),
        yes="Some patches are applied automatically by a tool on a schedule.",
        no="No patches are applied automatically on a schedule.",
    ),
    # Split from "which patches, who approved the schedule, and how are they tested": how
    # patches are tested is asked for every patch (wt-cm06-testing).
    _multi(
        "wt-cm06-automated-which", "EXECUTION", 0,
        "Which patches are applied automatically?",
        "Patches applied automatically are approved at the level of the schedule, so they are "
        "tested against it rather than an approval for each one.",
        ("cm06-approved", "POPULATION"),
        ("Operating-system security patches", "Database patches",
         "Application or vendor releases", "Firmware and network device updates"),
        "The patches applied automatically are {answer}.",
        when=("wt-cm06-automated", "Yes"),
    ),
    _multi(
        "wt-cm06-schedule-approver", "EXECUTION", 0,
        "Who approved the automatic patching schedule?",
        "The schedule's approval stands in for each automatic patch's own approval, so it is "
        "the evidence requested.",
        ("cm06-approved", "EVIDENCE"),
        ("The change advisory board", "IT management", "The system owner", "No one"),
        "The automatic patching schedule was approved by {answer}.",
        when=("wt-cm06-automated", "Yes"),
    ),
    _multi(
        "wt-cm06-testing", "EXECUTION", 20,
        "How are patches tested before production?",
        "The testing attribute is judged against the approach the procedure sets.",
        ("cm06-tested",),
        ("In a test environment first", "On a pilot group of servers first",
         "Only by the vendor, before release"),
        "Before production, patches are tested {answer}.",
    ),
    _choice(
        "wt-cm06-approver-independent", "SEGREGATION", 10,
        "Can the administrator who applies a patch also approve it?",
        "The approver must not be the administrator who applied the patch, and a system block "
        "is tested once in configuration while a policy is tested for every sampled patch.",
        ("cm06-independent", "EVIDENCE"),
        _PREVENTED,
        "Approval of a patch by the administrator who applies it is {answer}.",
    ),
    _yes_no(
        "wt-cm06-history", "POPULATION", 10,
        "Can each server or database produce its own history of patches applied, with dates?",
        "The system's own patch history is the population and shows when each patch was "
        "applied, which each change record is traced from.",
        ("POPULATION", "cm06-record"),
        yes="Each server and database can produce its own history of patches applied, with "
        "dates.",
        no="Not every server and database can produce its own history of patches applied.",
    ),
)  # fmt: skip

# ITGC-CM-07 Development life cycle.
_bank(
    "change-sdlc",
    _multi(
        "wt-cm07-what-qualifies", "SCOPE", 10,
        "What makes a change a project under the development life cycle rather than a normal "
        "change?",
        "The definition sets the population of projects and releases tested here.",
        ("POPULATION", "SCOPE"),
        ("A new system or module", "A major upgrade or vendor release",
         "Cost or effort above a set threshold", "A change to several business processes",
         "A decision by management or a steering committee"),
        "A change is delivered as a project under the development life cycle on the basis of "
        "{answer}.",
    ),
    _multi(
        "wt-cm07-methodology", "SCOPE", 20,
        "Which delivery approaches do projects follow?",
        "An agile project releases many times, so requirements, testing and go-live approval "
        "are evidenced per release rather than once.",
        ("EVIDENCE", "cm07-golive"),
        ("Sequential (waterfall) phases", "Agile sprints with a release each sprint",
         "A vendor-led implementation"),
        "Projects follow {answer}.",
    ),
    _yes_no(
        "wt-cm07-open-defects", "EXECUTION", 10,
        "Can a release go live with known open defects?",
        "Defects open at go-live must be recorded and accepted, which is part of the acceptance "
        "testing attribute.",
        ("cm07-uat",),
        yes="A release can go live with known open defects.",
        no="A release cannot go live with known open defects.",
    ),
    # Split from "who accepts the open defects, and how is that acceptance recorded".
    _multi(
        "wt-cm07-defects-accepted-by", "EXECUTION", 0,
        "Who accepts the defects that are open at go-live?",
        "Defects open at go-live must be accepted by someone entitled to accept them, as part "
        "of the acceptance testing attribute.",
        ("cm07-uat",),
        ("The business owner", "The project steering committee", "The project or IT manager",
         "The test manager"),
        "Defects open at go-live are accepted by {answer}.",
        when=("wt-cm07-open-defects", "Yes"),
    ),
    _multi(
        "wt-cm07-defects-record", "EXECUTION", 0,
        "How is the acceptance of open defects recorded?",
        "The acceptance is the evidence the defects were known and agreed before go-live.",
        ("cm07-uat", "EVIDENCE"),
        ("In the go-live sign-off that lists them",
         "By an accepted status in the defect tool",
         "In steering committee minutes", "In an email"),
        "The acceptance of open defects is recorded {answer}.",
        when=("wt-cm07-open-defects", "Yes"),
    ),
    _yes_no(
        "wt-cm07-migration", "EXECUTION", 20,
        "Did any project in the period migrate or convert data into the system?",
        "A migration brings the data migration control into scope for that project.",
        ("SCOPE",),
        yes="A project in the period migrated or converted data into the system.",
        no="No project in the period migrated or converted data into the system.",
    ),
    _yes_no(
        "wt-cm07-release-register", "POPULATION", 10,
        "Is there a register of projects and releases that reached production in the period?",
        "The register, agreed to the deployment log, is the population.",
        ("POPULATION",),
        yes="A register lists the projects and releases that reached production in the period.",
        no="No register lists the projects and releases that reached production in the period.",
    ),
)  # fmt: skip

# ITGC-CM-08 Data migration.
_bank(
    "change-data-migration",
    # Was "which data objects, and from which source systems": each object's source is named
    # by the extracts requested for its reconciliation.
    _multi(
        "wt-cm08-objects", "SCOPE", 10,
        "Which data objects were migrated?",
        "Each data object is in the population and is reconciled on its own.",
        ("POPULATION", "SCOPE"),
        ("Customer and vendor master data", "Material or product master data",
         "Open receivables and payables", "General ledger balances", "Fixed assets",
         "Open sales or purchase orders", "Employee data", "Historical transactions"),
        "The data objects migrated are {answer}.",
    ),
    _multi(
        "wt-cm08-method", "EXECUTION", 10,
        "How was the data moved?",
        "The method decides the evidence of the reconciliation: load logs from a tool, script "
        "output, or entry records.",
        ("EVIDENCE", "cm08-reconciled"),
        ("A migration tool with load logs", "Custom scripts", "Manual entry",
         "A vendor service"),
        "The data is moved using {answer}.",
    ),
    _multi(
        "wt-cm08-reconciliation", "EXECUTION", 20,
        "How was each data object reconciled between the source and the target?",
        "Counts alone do not show amounts or fields are right, so the method sets what the "
        "attribute is tested against.",
        ("cm08-reconciled",),
        ("Record counts", "Control totals of amounts", "Field-level comparison of a sample",
         "Business user review"),
        "Each data object is reconciled using {answer}.",
    ),
    _yes_no(
        "wt-cm08-approver-independent", "SEGREGATION", 10,
        "Is the person who approves the reconciliation independent of the migration team?",
        "An approver who ran the migration is not independent, which the attribute tests.",
        ("cm08-approved",),
        yes="The person who approves the reconciliation is independent of the migration team.",
        no="The person who approves the reconciliation is not independent of the migration "
        "team.",
    ),
    _yes_no(
        "wt-cm08-extracts-retained", "RECORDS", 10,
        "Were the source and target extracts used in the reconciliation kept?",
        "Without the extracts the reconciliation cannot be agreed or reperformed.",
        ("cm08-reconciled", "EVIDENCE"),
        yes="The source and target extracts used in the reconciliation are kept.",
        no="The source and target extracts used in the reconciliation are not kept.",
    ),
)  # fmt: skip


def _family(library_key: str) -> str:
    for prefix, name in FAMILIES.items():
        if library_key.startswith(prefix):
            return name
    return ""


def _all() -> tuple[Question, ...]:
    family = tuple(item for items in FAMILY_QUESTIONS.values() for item in items)
    specific = tuple(item for items in CONTROL_QUESTIONS.values() for item in items)
    return UNIVERSAL + family + specific


_BY_KEY: dict[str, Question] = {item.key: item for item in _all()}


def _normal(value: str) -> str:
    return value.strip().upper().replace(" ", "_").replace("-", "_")


def questions_for(library_key: str, nature: str = "", frequency: str = "") -> tuple[Question, ...]:
    """Every question that applies to a library control, universal + family + control-specific,
    filtered by nature, in TOPICS order and, within a topic, in each question's `order` (the
    order a walkthrough reaches it), each follow-up directly after its parent. Deterministic:
    a tie (which problems() reports) keeps universal, then family, then specific. Unknown/empty
    library_key: the universal questions only.

    An empty nature applies no nature filter. A frequency that fixes how often the control
    operates (annual to daily) drops the volume questions."""
    family = tuple(
        item
        for item in FAMILY_QUESTIONS.get(_family(library_key), ())
        if item.key not in _LIMITED_TO or library_key in _LIMITED_TO[item.key]
    )
    kind = _normal(nature)
    fixed = _normal(frequency) in FIXED_FREQUENCIES
    pool = [
        item
        for item in UNIVERSAL + family + CONTROL_QUESTIONS.get(library_key, ())
        if (not kind or not item.natures or kind in item.natures)
        and not (fixed and item.topic == "VOLUME")
    ]
    keys = {item.key for item in pool}
    children: dict[str, list[Question]] = {}
    roots: list[Question] = []
    for item in pool:
        if item.when is not None and item.when[0] in keys:
            children.setdefault(item.when[0], []).append(item)
        else:
            roots.append(item)
    roots.sort(key=lambda item: (TOPICS.index(item.topic), item.order))
    ordered: list[Question] = []

    def place(item: Question) -> None:
        ordered.append(item)
        for child in children.get(item.key, ()):
            place(child)

    for item in roots:
        place(item)
    return tuple(ordered)


def question(key: str) -> Question | None:
    return _BY_KEY.get(key)


def _parts(value: str) -> list[str]:
    return [part.strip() for part in value.split(";") if part.strip()]


def applicable(questions: Sequence[Question], answers: Mapping[str, str]) -> list[Question]:
    """The questions to ask given answers so far: a follow-up is kept only when its parent's
    answer contains the `when` value (MULTI answers are joined with "; "). A follow-up whose
    parent is not asked is not asked either."""
    kept: list[Question] = []
    asked: set[str] = set()
    for item in questions:
        if item.when is not None:
            parent, value = item.when
            if parent not in asked or value not in _parts(answers.get(parent, "")):
                continue
        kept.append(item)
        asked.add(item.key)
    return kept


def is_other(part: str) -> bool:
    """Whether an answer part is offered as "Other" (its prefix exactly, case included)."""
    return part.startswith(OTHER)


def other_text(part: str) -> str:
    """The free text of an "Other: <text>" part."""
    return part[len(OTHER) :].strip()


def _valid_other(item: Question, part: str) -> bool:
    text = other_text(part)
    return (
        item.allows_other
        and item.kind in ("CHOICE", "MULTI")
        and OTHER_MIN <= len(text) <= OTHER_MAX
        and ";" not in part
    )


def valid_answer(item: Question, value: str) -> bool:
    """CHOICE: exactly one of options, or one Other part. MULTI: one or more distinct parts
    joined with "; ", each an option except at most one Other part, which is the last.
    YES_NO: "Yes" or "No". TEXT: 1-1000 chars after strip.

    An Other part is "Other: <text>" (the prefix exactly), its text 3-200 characters after
    strip with no ";", accepted only by a CHOICE or MULTI question that allows_other. Whether
    the text holds a credential is the server's check (walkthrough_answers)."""
    if item.kind == "CHOICE":
        answer = value.strip()
        if is_other(answer):
            return _valid_other(item, answer)
        return answer in item.options
    if item.kind == "MULTI":
        parts = [part.strip() for part in value.split(";")]
        others = [index for index, part in enumerate(parts) if is_other(part)]
        if others and (others != [len(parts) - 1] or not _valid_other(item, parts[-1])):
            return False
        options = parts[:-1] if others else parts
        return (
            bool(parts)
            and all(part in item.options for part in options)
            and len(set(options)) == len(options)
        )
    if item.kind == "YES_NO":
        return value.strip() in YES_NO
    return 1 <= len(value.strip()) <= ANSWER_LIMIT


# The narrated understanding.

Part = tuple[str, str | None]
_END = " .,;:!?"


def _inline(option: str) -> str:
    """An option as it reads inside a sentence: its first letter lowered unless its first word
    is an abbreviation such as "IT" or "GRC"."""
    first = option.split(" ", 1)[0]
    if len(first) > 1 and first[1].isupper():
        return option
    return option[:1].lower() + option[1:]


# An Other text reads as written, since it may open with a name ("Okta workflows"), except a
# first word that is plainly not one: an article, a preposition or determiner, or an ordinary
# word ending in "-ed" or "-ly" ("Detected by the monthly review", "Manually by IT").
_LOWERED = frozenset(
    {"A", "An", "The", "By", "From", "Through", "Via", "In", "On", "At", "With", "Using",
     "Only", "Each", "Every", "All", "Some", "No", "Not", "Our", "Their", "Its"}
)  # fmt: skip


def _inline_other(text: str) -> str:
    """An Other part's text as it reads inside a sentence: on one line, its ending
    punctuation dropped, and its first letter lowered only when its first word is plainly
    not a name (_LOWERED)."""
    shown = " ".join(text.split()).rstrip(_END)
    first = shown.split(" ", 1)[0]
    plain = first[:1].isupper() and first[1:].islower() and first.endswith(("ed", "ly"))
    return shown[:1].lower() + shown[1:] if first in _LOWERED or plain else shown


def _listed(items: list[str]) -> str:
    if len(items) < 2:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def _shown(item: Question, value: str, starts: bool) -> str:
    """The answer as the narrative shows it; `starts` when it opens the sentence."""
    if item.kind == "TEXT":
        shown = " ".join(value.split()).rstrip(_END)
    else:
        shown = _listed(
            [
                _inline_other(other_text(part)) if is_other(part) else _inline(part)
                for part in _parts(value)
            ]
        )
    return shown[:1].upper() + shown[1:] if starts else shown


def _sentence(item: Question, value: str) -> list[Part]:
    if item.kind == "YES_NO":
        if value not in YES_NO:
            return []
        said = item.narrative_yes if value == "Yes" else item.narrative_no
        return [(said, item.key)] if said else []
    if not item.narrative or not valid_answer(item, value):
        return []
    before, after = item.narrative.split(ANSWER, 1)
    shown = _shown(item, value, not before)
    if not shown:
        return []
    parts: list[Part] = [(before, None)] if before else []
    parts.append((shown, item.key))
    if after:
        parts.append((after, None))
    return parts


def narrate(
    questions: Sequence[Question], answers: Mapping[str, str]
) -> list[tuple[Topic, list[tuple[str, str | None]]]]:
    """The understanding as the confirmed answers tell it, in the questions' order, grouped by
    topic (TOPICS order; a topic appears only if it has a sentence). Each topic's parts are
    (text, None) for the template's own words and (answer text, question key) for the answer
    itself, so the screen highlights each answer and links it to its question. YES_NO answers
    give their narrative_yes/no sentence as one part keyed to the question. MULTI answers
    ("A; B; C") read as "A, B and C". An Other part reads as its text, without "Other:",
    listed with the options of a MULTI answer. TEXT answers are inserted as given (trimmed, ending
    punctuation normalised). Questions not in `answers`, with an empty answer (not
    applicable), or with no narrative are left out. Sentences are separated by a single space
    part (" ", None).

    Also left out: a follow-up its parent's answer no longer opens (applicable()), and an
    answer that is not valid for its question. An option inside a sentence reads with its
    first letter lowered (not an abbreviation's); an answer that opens a sentence is
    capitalised."""
    by_topic: dict[Topic, list[Part]] = {}
    for item in applicable(questions, answers):
        value = answers.get(item.key, "").strip()
        sentence = _sentence(item, value) if value else []
        if not sentence:
            continue
        parts = by_topic.setdefault(item.topic, [])
        if parts:
            parts.append((" ", None))
        parts.extend(sentence)
    return [(topic, by_topic[topic]) for topic in TOPICS if topic in by_topic]


# Structural checks.


def _scopes() -> list[str]:
    """Every set of controls a question can be asked for: the universal set, then each
    library key with a family."""
    return ["", *(key for key in LIBRARY_KEYS if _family(key))]


def _shape(item: Question) -> list[str]:
    found: list[str] = []
    name = item.key
    if not KEY.match(name):
        found.append(f"{name}: key does not match {KEY.pattern}")
    if item.topic not in TOPICS:
        found.append(f"{name}: unknown topic {item.topic}")
    if not item.text.strip() or len(item.text) > TEXT_LIMIT or not item.text.endswith("?"):
        found.append(f"{name}: text must be 1-{TEXT_LIMIT} characters ending with '?'")
    why = item.why.strip()
    if not why or len(item.why) > WHY_LIMIT or not why.endswith(".") or ". " in why:
        found.append(f"{name}: why must be one sentence of at most {WHY_LIMIT} characters")
    if not item.drives or len(set(item.drives)) != len(item.drives):
        found.append(f"{name}: drives must name at least one drive, without repeats")
    found.extend(f"{name}: unknown drive {d}" for d in item.drives if d not in DRIVES)
    if item.kind not in ANSWER_KINDS:
        found.append(f"{name}: unknown kind {item.kind}")
    if item.kind in ("CHOICE", "MULTI"):
        if not 2 <= len(item.options) <= 8:
            found.append(f"{name}: a {item.kind} question needs 2-8 options")
        if len(set(item.options)) != len(item.options):
            found.append(f"{name}: repeated option")
        for option in item.options:
            if not option.strip() or len(option) > OPTION_LIMIT or ";" in option:
                found.append(f"{name}: option {option!r} must be 1-{OPTION_LIMIT} chars, no ';'")
            if option.casefold().startswith("other"):
                found.append(f"{name}: option {option!r} must not start with 'Other'")
    else:
        if item.options:
            found.append(f"{name}: a {item.kind} question has no options")
        if item.allows_other:
            found.append(f"{name}: a {item.kind} question never takes an Other answer")
    if len(set(item.natures)) != len(item.natures):
        found.append(f"{name}: repeated nature")
    found.extend(f"{name}: unknown nature {n}" for n in item.natures if n not in NATURES)
    if (item.when is None) == (item.order == 0) or item.order < 0:
        found.append(f"{name}: a question has a positive order, a follow-up has 0")
    found.extend(_narrative(item))
    return found


def _sentence_problem(text: str) -> bool:
    return (
        not text.strip()
        or len(text) > NARRATIVE_LIMIT
        or not text.endswith(".")
        or text != text.strip()
        or "{" in text.replace(ANSWER, "")
        or "}" in text.replace(ANSWER, "")
        or not (text.startswith(ANSWER) or text[:1].isupper())
    )


def _narrative(item: Question) -> list[str]:
    """Every question is narrated: YES_NO by a sentence for each answer, the others by one
    sentence with the answer in it once."""
    name = item.key
    if item.kind == "YES_NO":
        found = [] if not item.narrative else [f"{name}: a YES_NO question has no narrative"]
        for said in (item.narrative_yes, item.narrative_no):
            if _sentence_problem(said) or ANSWER in said:
                found.append(f"{name}: {said!r} must be one sentence without {ANSWER}")
        return found
    found = (
        []
        if not (item.narrative_yes or item.narrative_no)
        else [f"{name}: only a YES_NO question has yes and no sentences"]
    )
    if _sentence_problem(item.narrative) or item.narrative.count(ANSWER) != 1:
        found.append(f"{name}: narrative must be a sentence with {ANSWER} once")
    return found


def _attribute_keys(library_key: str) -> frozenset[str]:
    definition = definition_for(library_key)
    return frozenset(a.key for a in definition.attributes) if definition else frozenset()


def _asked_for(item: Question, family_of: Mapping[str, str]) -> list[str]:
    """The library keys a question can be asked for."""
    for library_key, items in CONTROL_QUESTIONS.items():
        if item in items:
            return [library_key]
    if item.key in family_of:
        members = _LIMITED_TO.get(item.key)
        return [
            key
            for key in LIBRARY_KEYS
            if _family(key) == family_of[item.key] and (members is None or key in members)
        ]
    return list(LIBRARY_KEYS)


def _informs(item: Question, family_of: Mapping[str, str]) -> list[str]:
    name = item.key
    if not item.informs or len(set(item.informs)) != len(item.informs):
        return [f"{name}: informs must name at least one need, without repeats"]
    found: list[str] = []
    controls = _asked_for(item, family_of)
    for need in item.informs:
        if need in INFORMS:
            continue
        if need.isupper():
            found.append(f"{name}: unknown informs token {need}")
            continue
        found.extend(
            f"{name}: informs {need}, not an attribute of {key}"
            for key in controls
            if need not in _attribute_keys(key)
        )
    return found


def _follow_up(item: Question) -> list[str]:
    if item.when is None:
        return []
    name = item.key
    parent = _BY_KEY.get(item.when[0])
    if parent is None:
        return [f"{name}: follow-up of unknown question {item.when[0]}"]
    found: list[str] = []
    if parent.kind == "TEXT" or not valid_answer(parent, item.when[1]) or is_other(item.when[1]):
        found.append(f"{name}: {item.when[1]!r} is not an answer of {parent.key}")
    if parent.kind == "MULTI" and item.when[1] not in parent.options:
        found.append(f"{name}: {item.when[1]!r} is not one option of {parent.key}")
    if parent.topic != item.topic:
        found.append(f"{name}: a follow-up is asked in its parent's topic ({parent.topic})")
    if item.required and not parent.required:
        found.append(f"{name}: a required follow-up of an optional question")
    return found


def _order(scope: str, nature: str, frequency: str) -> list[str]:
    """For one control: each follow-up directly after its parent (or its parent's earlier
    follow-ups), and no two questions of a topic sharing a place."""
    found: list[str] = []
    asked = questions_for(scope, nature, frequency)
    where = scope or "any control"
    seen: set[str] = set()
    places: set[tuple[str, int]] = set()
    for index, item in enumerate(asked):
        if item.when is None:
            if (item.topic, item.order) in places:
                found.append(f"{item.key}: shares its place in {item.topic} for {where}")
            places.add((item.topic, item.order))
        elif item.when[0] not in seen:
            found.append(
                f"{item.key}: asked for {where} ({nature or 'any'}) "
                f"without its parent {item.when[0]} before it"
            )
        else:
            before = asked[index - 1]
            sibling = before.when is not None and before.when[0] == item.when[0]
            if before.key != item.when[0] and not sibling:
                found.append(f"{item.key}: not directly after its parent for {where}")
        seen.add(item.key)
    return found


def problems() -> list[str]:
    """Structural checks over the whole bank: unique keys and texts, key pattern, lengths,
    options rules per kind; `when` parent exists, is in the same topic, is asked directly
    before its follow-ups for every control, and its value is a valid answer of the parent;
    a follow-up is never required when its parent is optional; no option starts with "Other",
    and only a CHOICE or MULTI question takes an Other answer, never as a follow-up's value;
    every question has an explicit place in its topic and no two share one for a control;
    every question informs at least one need, each a known token or an attribute key of every
    control it is asked for; every question is narrated; every library key in the access and
    change families has a bank; a free-text question is one of TEXT_KEPT, and each of those
    is a free-text question of the bank."""
    every = _all()
    found: list[str] = []
    keys = [item.key for item in every]
    found.extend(
        f"{key}: key is not unique" for key in sorted({k for k in keys if keys.count(k) > 1})
    )
    texts = [item.text for item in every]
    found.extend(f"{t!r}: asked twice" for t in sorted({t for t in texts if texts.count(t) > 1}))
    family_of = {item.key: name for name, items in FAMILY_QUESTIONS.items() for item in items}
    for item in every:
        found.extend(_shape(item))
        found.extend(_follow_up(item))
        found.extend(_informs(item, family_of))
        if item.kind == "TEXT" and item.key not in TEXT_KEPT:
            found.append(f"{item.key}: free text where options can be given (TEXT_KEPT)")
    found.extend(
        f"{key}: kept as free text, but not a TEXT question of the bank"
        for key in sorted(TEXT_KEPT)
        if (kept := _BY_KEY.get(key)) is None or kept.kind != "TEXT"
    )
    for scope in _scopes():
        for nature in ("", *NATURES):
            for frequency in ("", "QUARTERLY"):
                found.extend(_order(scope, nature, frequency))
    for key in LIBRARY_KEYS:
        if _family(key) and not CONTROL_QUESTIONS.get(key):
            found.append(f"{key}: no walkthrough bank")
    for key in CONTROL_QUESTIONS:
        if key not in LIBRARY_KEYS or not _family(key):
            found.append(f"{key}: bank for a key that is not an access or change library control")
    for key, members in _LIMITED_TO.items():
        if key not in family_of:
            found.append(f"{key}: limited, but not a family question")
            continue
        found.extend(
            f"{key}: limited to {member}, not in its family"
            for member in sorted(members)
            if member not in LIBRARY_KEYS or _family(member) != family_of[key]
        )
    return sorted(set(found), key=found.index)
