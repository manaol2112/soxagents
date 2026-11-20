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

Revised again on 16 November 2026 (B1k and B1l, docs/control-workflow-plan.md): Control
Understanding ends with a review of the questions asked, attribute by attribute, so that no
question is left for the attributes to ask later. So:

- Every question says which kind of fact it establishes (`fact`, one of FACTS: the performer,
  the approver, the system, the record, the timing, the population, the exception handling,
  or another fact), and `informing` gives, for an attribute of a control, the questions that
  inform it with their kind of fact (`fact_of`), which the review reads.
- Each attribute of the access and change families says which kinds of fact its criteria
  need (`criteria_needs`), and every need is met by a question that informs the attribute or
  by a recorded reason (MET_ELSEWHERE: a value the control's statement asks, or what each
  item's own evidence shows). problems() reports a need met by neither.
- The bank for patching (ITGC-CM-06) asks the three facts its attributes needed later: who
  applies patches to production, how a patch in the patch history is linked to its change
  record, and how a patch applied without prior approval is approved afterwards. The other
  banks were checked for the same kind of gap: the transfer of access asks where the new
  manager records each decision and whether the system records each role's removal, the
  removal of leavers asks how a leaver's local accounts are found, and direct data changes
  ask how the data owner is identified.
- A question added after a control's understanding was finished does not hold it (`since`):
  it is required only of a control still in progress (walkthrough_answers). Known behaviour,
  as with the questions of B1k: on such a control whose specialist's first read was READY and
  asked nothing, the questions added since are answered and the understanding then completes
  without the specialist reading those answers (understanding_review.due_round gives no new
  read); "Review again" after completion is the way to have them read.

Added on 18 November 2026 (product owner: draft the dedicated walkthrough banks for the IT
operations library controls, for professional review): the operations family (library keys
starting "operations-", ITGC-OP-01 to -08 with OP-02.1, OP-03.1 and OP-03.2) has a bank of its
own for each control, built the same way: only what the control's attributes need, a CHOICE
or MULTI with the usual answers and Other wherever an answer can be listed, and no Yes/No
question that opens a follow-up (product owner, 18 November 2026: a Yes/No answer settles its
fact; where the answer must branch, a CHOICE or MULTI with distinct options does). Every
attribute of the family says what its criteria need (CRITERIA_NEEDS), met by a question or a
recorded reason (MET_ELSEWHERE). The questions carry `since` (OPERATIONS_ADDED), so a control
whose understanding was already finished is not held by them.

Status: draft for professional review, like the rest of the library. Nothing here sets a
threshold, a deadline or a role on the client's behalf. Pure and deterministic: no database.
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
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

FAMILIES: dict[str, str] = {"access-": "ACCESS", "change-": "CHANGE", "operations-": "OPERATIONS"}

# The kind of fact a question establishes, and an attribute's criteria need (B1l, 16 November
# 2026): who performs the control (PERFORMER), who approves, reviews or signs it off and their
# independence (APPROVER), the system, tool, layer, environment or setting (SYSTEM), the
# record that shows it and where it is kept (RECORD), when it happens or by when (TIMING),
# which items there are and where they come from (POPULATION), what happens to an exception,
# a conflict or a difference (EXCEPTION), and any other fact (OTHER).
Fact = Literal[
    "PERFORMER", "APPROVER", "SYSTEM", "RECORD", "TIMING", "POPULATION", "EXCEPTION", "OTHER"
]
FACTS: tuple[Fact, ...] = (
    "PERFORMER", "APPROVER", "SYSTEM", "RECORD", "TIMING", "POPULATION", "EXCEPTION", "OTHER"
)  # fmt: skip
# The day the questions of B1k were added to the bank (see Question.since).
B1K_ADDED = date(2026, 11, 16)
# The day the operations family's banks were added (see Question.since).
OPERATIONS_ADDED = date(2026, 11, 18)
# The day the question on evidence without a SOC 1 report was added (see Question.since;
# owner decision, 19 November 2026, the interim fix of SOL's report defect 5).
SOC1_NO_REPORT_ADDED = date(2026, 11, 19)

# The only free-text questions (product owner, 11 November 2026: options wherever an answer
# can be listed), each a narrative no list holds and each asked after a structured question
# on the same follow-up: the dates, causes and resolution of each known deviation; when each
# change in the period took effect and how the control ran before and after it; and the
# service organization's name with the complementary user entity controls the control relies
# on (19 November 2026: no longer "in its report", which a control with no SOC 1 report has
# not; the evidence approach without one is a structured question, wt-service-org-no-report).
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
    # The kind of fact its answer establishes (FACTS; chosen for each question in _FACTS).
    fact: Fact = "OTHER"
    # The day the question was added to the bank, when after the bank was first in use (None:
    # in it from the start). A question added later is required only of a control whose
    # understanding was not yet completed when it was added, and never of one whose
    # attributes are accepted (B1l: finished work is not disturbed; walkthrough_answers).
    since: date | None = None


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
    since: date | None = None,
) -> Question:
    return Question(
        key, topic, text, why, _drives(informs), "YES_NO", informs, (), required, when, (),
        order, "", yes, no, allows_other=False, fact=_FACTS.get(key, "OTHER"), since=since,
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
    since: date | None = None,
) -> Question:
    return Question(
        key, topic, text, why, _drives(informs), "TEXT", informs, (), required, when, (),
        order, narrative, allows_other=False, fact=_FACTS.get(key, "OTHER"), since=since,
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
    since: date | None = None,
) -> Question:
    return Question(
        key, topic, text, why, _drives(informs), "CHOICE", informs, options, required, when,
        natures, order, narrative, allows_other=allows_other, fact=_FACTS.get(key, "OTHER"),
        since=since,
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
    since: date | None = None,
) -> Question:
    return Question(
        key, topic, text, why, _drives(informs), "MULTI", informs, options, required, when, (),
        order, narrative, allows_other=allows_other, fact=_FACTS.get(key, "OTHER"),
        since=since,
    )  # fmt: skip


# The kind of fact each question's answer establishes (B1l, 16 November 2026), chosen for
# every question of the bank (problems() checks none is missing): the one its answer settles
# first, where it touches several (whether the tool enforces an approval is TIMING, since
# the attribute it informs is that the approval came first).
_FACTS: dict[str, Fact] = {
    # Universal.
    "wt-known-deviations": "EXCEPTION",
    "wt-known-deviations-kind": "EXCEPTION",
    "wt-known-deviations-detail": "EXCEPTION",
    "wt-changes-in-period": "OTHER",
    "wt-changes-in-period-what": "OTHER",
    "wt-changes-in-period-detail": "OTHER",
    "wt-service-org": "OTHER",
    "wt-service-org-report": "OTHER",
    "wt-service-org-detail": "OTHER",
    "wt-service-org-no-report": "OTHER",
    "wt-volume": "POPULATION",
    # Logical access, the family.
    "wt-ac-layers": "SYSTEM",
    "wt-ac-population-source": "POPULATION",
    # Change management, the family.
    "wt-cm-change-types": "POPULATION",
    "wt-cm-components": "SYSTEM",
    "wt-cm-who-deploys": "PERFORMER",
    "wt-cm-environments": "SYSTEM",
    "wt-cm-environments-shared": "SYSTEM",
    "wt-cm-environments-tested": "SYSTEM",
    "wt-cm-population-source": "POPULATION",
    "wt-cm-vendor-changes": "POPULATION",
    # ITGC-AC-01.
    "wt-ac01-account-types": "POPULATION",
    "wt-ac01-authority": "APPROVER",
    "wt-ac01-enforced-approval": "TIMING",
    "wt-ac01-provisioning": "PERFORMER",
    "wt-ac01-self-approval": "APPROVER",
    "wt-ac01-sod-check": "OTHER",
    "wt-ac01-sod-method": "OTHER",
    "wt-ac-change-logging": "RECORD",
    "wt-ac-change-logging-gap": "RECORD",
    # ITGC-AC-02.
    "wt-ac02-contractors": "POPULATION",
    "wt-ac02-trigger": "TIMING",
    "wt-ac02-involuntary": "TIMING",
    "wt-ac02-involuntary-deadline": "TIMING",
    "wt-ac02-disable-delete": "RECORD",
    "wt-ac02-directory-only": "SYSTEM",
    "wt-ac02-account-mapping": "POPULATION",
    "wt-ac02-removal-record": "RECORD",
    "wt-ac02-leaver-list": "POPULATION",
    # ITGC-AC-03.
    "wt-ac03-coverage": "POPULATION",
    "wt-ac03-what-checked": "OTHER",
    "wt-ac03-performed-in": "RECORD",
    "wt-ac03-remediation-check": "RECORD",
    "wt-ac03-own-access": "APPROVER",
    "wt-ac03-investigation": "EXCEPTION",
    "wt-ac03-listing-check": "POPULATION",
    # ITGC-AC-04.
    "wt-ac04-who-holds": "POPULATION",
    "wt-ac04-pam": "SYSTEM",
    "wt-ac04-reviewer-holds": "APPROVER",
    "wt-ac04-reviewer-own": "APPROVER",
    "wt-ac04-listing-check": "POPULATION",
    # ITGC-AC-05.
    "wt-ac05-other-paths": "SYSTEM",
    "wt-ac05-exemptions": "POPULATION",
    "wt-ac05-exempt-accounts": "POPULATION",
    "wt-ac05-exempt-approval": "RECORD",
    "wt-ac05-change-history": "RECORD",
    # ITGC-AC-06.
    "wt-ac06-types": "POPULATION",
    "wt-ac06-owner-record": "RECORD",
    "wt-ac06-owner-current": "OTHER",
    "wt-ac06-interactive": "SYSTEM",
    "wt-ac06-interactive-detail": "RECORD",
    "wt-ac06-inventory-source": "POPULATION",
    # ITGC-AC-07.
    "wt-ac07-what-counts": "POPULATION",
    "wt-ac07-trigger": "TIMING",
    "wt-ac07-old-access": "OTHER",
    "wt-ac07-transition-length": "TIMING",
    "wt-ac07-transition-approver": "APPROVER",
    "wt-ac07-reapproval-record": "RECORD",
    "wt-ac07-removal-record": "RECORD",
    # ITGC-AC-08.
    "wt-ac08-id-rights": "OTHER",
    "wt-ac08-pre-approval": "TIMING",
    "wt-ac08-reviewer-user": "APPROVER",
    "wt-ac08-log-content": "RECORD",
    "wt-ac08-direct-signin": "POPULATION",
    # ITGC-AC-09.
    "wt-ac09-who": "POPULATION",
    "wt-ac09-sponsor-approval": "RECORD",
    "wt-ac09-expiry": "SYSTEM",
    "wt-ac09-identification": "POPULATION",
    # ITGC-AC-10.
    "wt-ac10-mitigation-approver": "APPROVER",
    "wt-ac10-mitigation-evidence": "RECORD",
    "wt-ac10-rule-change-log": "RECORD",
    "wt-ac10-report-scope": "POPULATION",
    # ITGC-AC-11.
    "wt-ac11-platforms": "SYSTEM",
    "wt-ac11-instances": "POPULATION",
    "wt-ac11-default-accounts": "OTHER",
    "wt-ac11-log-destination": "RECORD",
    "wt-ac11-group-access": "POPULATION",
    # ITGC-AC-12.
    "wt-ac12-sources": "SYSTEM",
    "wt-ac12-triage": "RECORD",
    "wt-ac12-weekends": "TIMING",
    "wt-ac12-source-failure": "SYSTEM",
    "wt-ac12-escalation": "EXCEPTION",
    "wt-ac12-alert-listing": "POPULATION",
    # ITGC-CM-01.
    "wt-cm01-standard-changes": "POPULATION",
    "wt-cm01-standard-approver": "APPROVER",
    "wt-cm01-approval-enforced": "TIMING",
    "wt-cm01-testing-who": "PERFORMER",
    "wt-cm01-approver-independent": "APPROVER",
    "wt-cm01-version-match": "RECORD",
    # ITGC-CM-02.
    "wt-cm02-who-declares": "APPROVER",
    "wt-cm02-decision-record": "RECORD",
    "wt-cm02-access-used": "PERFORMER",
    "wt-cm02-approver-independent": "APPROVER",
    "wt-cm02-flag": "POPULATION",
    # ITGC-CM-03.
    "wt-cm03-approved-list": "RECORD",
    "wt-cm03-small-team": "PERFORMER",
    "wt-cm03-compensating": "EXCEPTION",
    "wt-cm03-exception-approver": "APPROVER",
    "wt-cm03-exception-term": "TIMING",
    "wt-cm03-deploy-rights": "POPULATION",
    "wt-cm03-service-accounts": "POPULATION",
    "wt-cm03-developer-list": "POPULATION",
    # ITGC-CM-04.
    "wt-cm04-who-can-configure": "PERFORMER",
    "wt-cm04-route": "OTHER",
    "wt-cm04-approver-independent": "APPROVER",
    "wt-cm04-log-enabled": "RECORD",
    "wt-cm04-log-gap": "POPULATION",
    "wt-cm04-unlogged-detection": "POPULATION",
    # ITGC-CM-05.
    "wt-cm05-methods": "SYSTEM",
    "wt-cm05-data-owner": "APPROVER",
    "wt-cm05-authorized-list": "PERFORMER",
    "wt-cm05-other-access": "PERFORMER",
    "wt-cm05-logging": "RECORD",
    "wt-cm05-logging-gap": "POPULATION",
    # ITGC-CM-06.
    "wt-cm06-layers": "SYSTEM",
    "wt-cm06-automated": "PERFORMER",
    "wt-cm06-automated-which": "POPULATION",
    "wt-cm06-schedule-approver": "APPROVER",
    "wt-cm06-testing": "SYSTEM",
    "wt-cm06-who-applies": "PERFORMER",
    "wt-cm06-approver-independent": "APPROVER",
    "wt-cm06-change-link": "RECORD",
    "wt-cm06-unapproved": "APPROVER",
    "wt-cm06-history": "POPULATION",
    # ITGC-CM-07.
    "wt-cm07-what-qualifies": "POPULATION",
    "wt-cm07-methodology": "OTHER",
    "wt-cm07-open-defects": "EXCEPTION",
    "wt-cm07-defects-accepted-by": "APPROVER",
    "wt-cm07-defects-record": "RECORD",
    "wt-cm07-migration": "OTHER",
    "wt-cm07-release-register": "POPULATION",
    # ITGC-CM-08.
    "wt-cm08-objects": "POPULATION",
    "wt-cm08-method": "OTHER",
    "wt-cm08-reconciliation": "OTHER",
    "wt-cm08-approver-independent": "APPROVER",
    "wt-cm08-extracts-retained": "RECORD",
    # ITGC-OP-01.
    "wt-op01-relevant-jobs": "POPULATION",
    "wt-op01-failure-record": "RECORD",
    "wt-op01-off-hours": "TIMING",
    "wt-op01-rerun-check": "RECORD",
    "wt-op01-resolution": "EXCEPTION",
    "wt-op01-run-history": "POPULATION",
    # ITGC-OP-02.
    "wt-op02-other-actions": "POPULATION",
    "wt-op02-approval-enforced": "TIMING",
    "wt-op02-change-log": "RECORD",
    "wt-op02-request-link": "RECORD",
    "wt-op02-urgent": "EXCEPTION",
    # ITGC-OP-02.1.
    "wt-op021-change-rights": "POPULATION",
    "wt-op021-generic-accounts": "POPULATION",
    "wt-op021-removal-check": "RECORD",
    "wt-op021-own-access": "APPROVER",
    "wt-op021-decision-record": "RECORD",
    "wt-op021-listing-source": "POPULATION",
    # ITGC-OP-03.
    "wt-op03-data-covered": "SYSTEM",
    "wt-op03-new-hosts": "SYSTEM",
    "wt-op03-change-approval": "APPROVER",
    "wt-op03-history-kept": "RECORD",
    "wt-op03-config-history": "RECORD",
    # ITGC-OP-03.1.
    "wt-op031-what-counts": "POPULATION",
    "wt-op031-off-hours": "TIMING",
    "wt-op031-review-record": "RECORD",
    "wt-op031-resolution": "EXCEPTION",
    "wt-op031-job-history": "POPULATION",
    # ITGC-OP-03.2.
    "wt-op032-what-restored": "SYSTEM",
    "wt-op032-backup-identified": "RECORD",
    "wt-op032-comparison": "RECORD",
    "wt-op032-source-figures": "TIMING",
    "wt-op032-failed-test": "EXCEPTION",
    # ITGC-OP-04.
    "wt-op04-system-link": "POPULATION",
    "wt-op04-priority-set": "SYSTEM",
    "wt-op04-targets": "TIMING",
    "wt-op04-closure": "RECORD",
    "wt-op04-root-cause-record": "RECORD",
    # ITGC-OP-05.
    "wt-op05-hosting": "SYSTEM",
    "wt-op05-access-list": "POPULATION",
    "wt-op05-grant-approval": "APPROVER",
    "wt-op05-removal-record": "RECORD",
    "wt-op05-soc-coverage": "RECORD",
    "wt-op05-holders": "POPULATION",
    "wt-op05-decision-record": "RECORD",
    # ITGC-OP-06.
    "wt-op06-mismatch-check": "SYSTEM",
    "wt-op06-off-hours": "TIMING",
    "wt-op06-recheck": "RECORD",
    "wt-op06-review-record": "RECORD",
    "wt-op06-recovery": "EXCEPTION",
    "wt-op06-run-log": "POPULATION",
    # ITGC-OP-07.
    "wt-op07-carve-out": "POPULATION",
    "wt-op07-cuec-mapping": "RECORD",
    "wt-op07-cuec-assurance": "OTHER",
    "wt-op07-exception-assessment": "EXCEPTION",
    # ITGC-OP-08.
    "wt-op08-inventory": "POPULATION",
    "wt-op08-severity": "POPULATION",
    "wt-op08-closure": "RECORD",
    "wt-op08-first-seen": "TIMING",
    "wt-op08-acceptance-record": "RECORD",
    "wt-op08-signoff-record": "RECORD",
}


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
    # Without a SOC 1 report the provider's part is evidenced another way, and how is the
    # team's decision (owner decision, 19 November 2026; options as approved). Added later
    # (since), so a completed understanding is not reopened (walkthrough_answers.holds). The
    # bank's first follow-up of a follow-up: questions_for asks it directly after the report
    # answer that opens it.
    _choice(
        "wt-service-org-no-report", "SERVICE_ORG", 0,
        "Without a SOC 1 report, how will the team obtain evidence over the service "
        "organization's part?",
        "Without a SOC 1 report the service organization's part needs evidence of another kind, "
        "and the approach decides what is requested and what is tested here.",
        ("RELIANCE", "EVIDENCE"),
        ("Test the service organization's controls directly",
         "Rely on another assurance report (for example SOC 2 or ISAE 3402)",
         "Test the user entity's own controls over the outsourced work",
         "For the audit team to decide"),
        # The parent's sentence ("...provides no SOC 1 report.") always comes directly before,
        # so this one does not repeat it, and the colon reads every option, a phrase, as one
        # sentence (design review, 19 November 2026).
        "Evidence over the service organization's part: {answer}.",
        when=("wt-service-org-report", "No SOC 1 report"),
        since=SOC1_NO_REPORT_ADDED,
    ),
    # Short text: the organization's name and the complementary controls relied on are its
    # own (TEXT_KEPT). Reworded 19 November 2026 (owner-approved): "in its report" dropped, as
    # a control may have no SOC 1 report; the key, kind and condition are unchanged, so an
    # answer confirmed before still stands (valid_answer does not read a TEXT question's
    # words).
    _text(
        "wt-service-org-detail", "SERVICE_ORG", 0,
        "Which service organization is it, and which complementary user entity controls does "
        "this control rely on?",
        "The service organization and the complementary controls expected of the user entity "
        "decide what is requested from the service organization and what is tested here.",
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
    # Added 16 November 2026 (B1k): with local accounts to remove, the attribute's criteria
    # cannot name the leaver's accounts without knowing how they are found.
    _multi(
        "wt-ac02-account-mapping", "EXECUTION", 0,
        "How are a leaver's local accounts in the system found from their HR record?",
        "Every account of the leaver must be removed, so how the system's accounts are matched "
        "to the HR record decides whether the accounts tested for each leaver are complete.",
        ("ac02-accounts", "EVIDENCE"),
        ("By an employee ID held on each account",
         "By a user ID that matches the directory account", "By name or email address",
         "Without a reliable link"),
        "A leaver's local accounts in the system are found {answer}.",
        when=("wt-ac02-directory-only", "No"), since=B1K_ADDED,
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
    # Added 16 November 2026 (B1k): the re-approval attribute needs a decision for each role,
    # and its evidence cannot be requested without knowing where that decision is kept.
    _multi(
        "wt-ac07-reapproval-record", "EXECUTION", 0,
        "Where does the new manager record the decision on each role the user keeps?",
        "The attribute needs a decision for each role held, and where the decision is recorded "
        "is the evidence requested for each transfer.",
        ("ac07-reapproved", "EVIDENCE"),
        ("In a ticket in the access request tool",
         "In a transfer review in an identity governance tool",
         "In an email or form kept with the transfer", "Only for the access as a whole"),
        "The new manager's decision on each role the user keeps is recorded {answer}.",
        when=("wt-ac07-old-access", "The new manager re-approves what the user keeps"),
        since=B1K_ADDED,
    ),
    # Added 16 November 2026 (B1k): the deadline is tested against the date of each removal,
    # as for leavers (wt-ac02-removal-record).
    _yes_no(
        "wt-ac07-removal-record", "RECORDS", 10,
        "Does the system record the date each role was removed from a user, and who removed "
        "it?",
        "The system's own record of the removal is the evidence that old access went and when, "
        "and without it the removal and its timing must be shown another way.",
        ("ac07-removed", "ac07-timely", "EVIDENCE"),
        yes="The system records the date each role was removed from a user and who removed it.",
        no="The system does not record the date each role was removed from a user.",
        since=B1K_ADDED,
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
    # Added 16 November 2026 (B1k): the statement names the data owner as the approver but
    # asks no value for it, so the approval cannot be tested without knowing who that is.
    _multi(
        "wt-cm05-data-owner", "APPROVAL", 10,
        "How is the data owner who must approve a direct data change identified?",
        "Each approval is tested against the data owner, so the source that names the owner is "
        "what the approver is compared with and is requested as evidence.",
        ("cm05-approved", "EVIDENCE"),
        ("A data ownership register or matrix", "The business process owner of the data",
         "The requester's manager", "Whoever the requester names"),
        "The data owner who approves a direct data change is identified by {answer}.",
        since=B1K_ADDED,
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
    # Added 16 November 2026 (B1k): the three facts ITGC-CM-06's attributes needed after the
    # walkthrough, each asked where the patch reaches it: applied, linked to its record, and
    # the exception of a patch applied before its approval.
    _multi(
        "wt-cm06-who-applies", "EXECUTION", 30,
        "Who applies patches to production?",
        "The approver is compared with whoever applied each patch, so the answer sets whose "
        "names the patch history must show and who may not approve.",
        ("cm06-independent", "EVIDENCE"),
        ("Server or infrastructure administrators", "Database administrators",
         "Application support staff", "The vendor or a managed service provider",
         "A patching tool, for the patches it applies automatically"),
        "Patches are applied to production by {answer}.",
        since=B1K_ADDED,
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
    _multi(
        "wt-cm06-change-link", "RECORDS", 10,
        "How is a patch in the system's patch history linked to its change record?",
        "Each patch in the history is traced to the change record that names it, and a link by "
        "date alone does not show that the record is for that patch.",
        ("cm06-record", "EVIDENCE"),
        ("The change number recorded with the patch in the patching tool",
         "The patch and hosts listed on the change record",
         "One change record for each scheduled patch cycle", "The patch name and date only"),
        "A patch in the patch history is linked to its change record by {answer}.",
        since=B1K_ADDED,
    ),
    _choice(
        "wt-cm06-unapproved", "EXCEPTIONS", 10,
        "How is a patch applied without prior approval, such as an emergency patch, approved "
        "afterwards?",
        "A patch applied before its approval passes only under the emergency change procedure, "
        "so the answer decides whether such patches are tested here or under the emergency "
        "change control.",
        ("cm06-approved", "POPULATION"),
        ("Approved afterwards under the emergency change procedure",
         "Approved afterwards by the approver of patches", "Not approved afterwards",
         "Not allowed, as every patch is approved first"),
        "A patch applied without prior approval is {answer}.",
        since=B1K_ADDED,
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

# The IT operations family (added 18 November 2026, OPERATIONS_ADDED; draft for professional
# review). What a statement value already asks (the system, the scheduler or tool, the team
# that performs the control, the approver or reviewer, a time allowed) is not asked again.
# No Yes/No question opens a follow-up: where the answer must branch, a CHOICE or MULTI does.
_OPS = OPERATIONS_ADDED

# ITGC-OP-01 Scheduled jobs are monitored and failures resolved.
_bank(
    "operations-jobs",
    _multi(
        "wt-op01-relevant-jobs", "SCOPE", 10,
        "How are the financially relevant jobs identified among the scheduler's jobs?",
        "The job log is the population only for the jobs identified as financially relevant, "
        "so how they are identified decides whether the failures tested are complete.",
        ("op01-identified", "SCOPE", "POPULATION"),
        ("A flag or naming convention in the scheduler",
         "A list of relevant jobs kept by IT operations",
         "Every job of the system is treated as relevant", "Not identified separately"),
        "The financially relevant jobs are identified as follows: {answer}.",
        since=_OPS,
    ),
    _multi(
        "wt-op01-failure-record", "EXECUTION", 10,
        "Where is a failed job recorded when it is noted?",
        "The record of each failure is the evidence that it was noted and logged as an incident "
        "on the day, and a failure that leaves no record cannot be traced from the job log.",
        ("op01-identified", "op01-logged", "op01-resolved", "EVIDENCE"),
        ("An incident raised automatically by the scheduler",
         "An incident raised by the operator who notes it",
         "An alert acknowledged in the scheduler", "The daily monitoring log or checklist",
         "An incident only when a rerun does not fix it"),
        "A failed job is recorded as follows: {answer}.",
        since=_OPS,
    ),
    _choice(
        "wt-op01-off-hours", "EXECUTION", 20,
        "When are failures of jobs that run overnight, at weekends or on holidays acted on?",
        "The attribute expects an incident on the day of the failure, so a failure acted on "
        "later is tested against what the procedure allows for those hours.",
        ("op01-logged", "SAMPLE"),
        ("As they happen, by an on-call or 24-hour team", "At the start of the next business day",
         "At the next scheduled check, whatever the day"),
        "Failures of jobs that run overnight, at weekends or on holidays are acted on {answer}.",
        since=_OPS,
    ),
    _multi(
        "wt-op01-rerun-check", "EXECUTION", 30,
        "How is it confirmed that a rerun processed the failed run's data once and completely?",
        "A successful status alone may not show that no record was skipped or posted twice, so "
        "the check used is what the completeness attribute is tested against.",
        ("op01-complete", "EVIDENCE"),
        ("The rerun's successful status in the scheduler",
         "Record counts or control totals compared after the rerun",
         "A check of the output by the business data owner",
         "A restart from the failure point that the job supports"),
        "A rerun's processing of the failed run's data is confirmed by {answer}.",
        since=_OPS,
    ),
    _multi(
        "wt-op01-resolution", "EXCEPTIONS", 10,
        "How are failed jobs resolved?",
        "Each way a failure is resolved leaves its own record, which is the evidence requested "
        "for each failure and decides how the completeness of its data is shown.",
        ("op01-resolved", "op01-complete", "EVIDENCE"),
        ("Rerun in the scheduler", "Run by hand outside the scheduler",
         "Cancelled with the business owner's agreement",
         "Corrected through a change under change management",
         "Left for the next scheduled run to pick up"),
        "Failed jobs are {answer}.",
        since=_OPS,
    ),
    _choice(
        "wt-op01-run-history", "POPULATION", 10,
        "What does the scheduler's run history for a day list?",
        "The run history is the population for each selected day, so a history that leaves out "
        "some runs needs the schedule itself to show what should have run.",
        ("op01-identified", "POPULATION", "EVIDENCE"),
        ("Every scheduled run, including jobs that did not start",
         "Every run that started, with its status", "Only failed runs", "Only successful runs"),
        "For a day, the scheduler's run history lists {answer}.",
        since=_OPS,
    ),
)  # fmt: skip

# ITGC-OP-02 Changes to the job schedule are approved.
_bank(
    "operations-scheduling",
    _multi(
        "wt-op02-other-actions", "SCOPE", 10,
        "Besides new jobs and changes to a job's timing, parameters or dependencies, which "
        "schedule actions need an approved request?",
        "Each action that needs a request is part of the population drawn from the scheduler's "
        "log, and an action made without one is outside the control.",
        ("op02-request", "SCOPE", "POPULATION"),
        ("Deleting or suspending a job", "Holding or skipping a single run",
         "Running a job once on request", "None of these"),
        "The other schedule actions that need an approved request are {answer}.",
        since=_OPS,
    ),
    _yes_no(
        "wt-op02-approval-enforced", "APPROVAL", 10,
        "Does the scheduler or the change tool stop a schedule change being made until its "
        "approval is recorded?",
        "An approval the tool enforces is evidenced by its configuration, while one by "
        "procedure only is dated against the change in the scheduler's log for each sampled "
        "change.",
        ("op02-approved", "EVIDENCE"),
        yes="The scheduler or the change tool stops a schedule change being made until its "
        "approval is recorded.",
        no="Neither the scheduler nor the change tool stops a schedule change being made before "
        "its approval is recorded.",
        since=_OPS,
    ),
    _choice(
        "wt-op02-change-log", "RECORDS", 10,
        "What does the scheduler record of a change to a job's definition?",
        "The scheduler's own record is the population of schedule changes, and only the old and "
        "new definition show that the change made is the change approved.",
        ("op02-matches", "POPULATION", "EVIDENCE"),
        ("The old and new definition, who changed it and when",
         "Who changed it and when, without the old and new values",
         "Only the current definition and the date it last changed", "Nothing about the change"),
        "For a change to a job's definition, the scheduler records {answer}.",
        since=_OPS,
    ),
    _multi(
        "wt-op02-request-link", "RECORDS", 20,
        "How is a change in the scheduler's log linked to its request in the change tool?",
        "Each change in the log is traced to the request that describes it, and a link by date "
        "alone does not show that the request is for that change.",
        ("op02-request", "op02-matches", "EVIDENCE"),
        ("The request number recorded with the change in the scheduler",
         "The job and the change described on the request",
         "One request for each release of schedule changes", "The job name and date only"),
        "A change in the scheduler's log is linked to its request by {answer}.",
        since=_OPS,
    ),
    _choice(
        "wt-op02-urgent", "EXCEPTIONS", 10,
        "How is a schedule change made before its approval, such as an urgent one, approved "
        "afterwards?",
        "A schedule change made before its approval passes only under the emergency change "
        "procedure, so the answer decides whether such changes are tested here or under the "
        "emergency change control.",
        ("op02-approved", "POPULATION"),
        ("Approved afterwards under the emergency change procedure",
         "Approved afterwards by the approver of schedule changes", "Not approved afterwards",
         "Not allowed, as every schedule change is approved first"),
        "A schedule change made before its approval is {answer}.",
        since=_OPS,
    ),
)  # fmt: skip

# ITGC-OP-02.1 Access to change the job schedule is reviewed.
_bank(
    "operations-scheduler-access",
    _multi(
        "wt-op021-change-rights", "SCOPE", 10,
        "Which kinds of access let someone change the job schedule?",
        "Every kind of access that can change the schedule must be on the listing reviewed, so "
        "a kind left out is a gap in its completeness.",
        ("op021-complete", "SCOPE", "POPULATION"),
        ("Scheduler administrator roles", "Rights to create or edit job definitions",
         "Rights to hold, release or force-start jobs", "Access to the scheduler's server or files",
         "Access to the scheduler's database tables"),
        "The job schedule can be changed through {answer}.",
        since=_OPS,
    ),
    _yes_no(
        "wt-op021-generic-accounts", "SCOPE", 20,
        "Do any service or generic accounts have rights to change the job schedule?",
        "A non-personal account with those rights must be on the listing, with its need "
        "confirmed through a named owner, which the review is tested for.",
        ("op021-complete", "op021-access"),
        yes="Some service or generic accounts have rights to change the job schedule.",
        no="No service or generic account has rights to change the job schedule.",
        since=_OPS,
    ),
    _yes_no(
        "wt-op021-removal-check", "EXECUTION", 10,
        "Is each removal the reviewer requests confirmed in the scheduler once it is made?",
        "A recorded confirmation is evidence the tester inspects, while without one each "
        "requested removal is traced to the scheduler's own user list.",
        ("op021-access", "EVIDENCE"),
        yes="Each removal the reviewer requests is confirmed in the scheduler once it is made.",
        no="Removals the reviewer requests are not confirmed in the scheduler once they are "
        "made.",
        since=_OPS,
    ),
    _choice(
        "wt-op021-own-access", "SEGREGATION", 10,
        "Who decides whether the reviewer keeps their own access to change the job schedule?",
        "A reviewer confirming their own access is not an independent decision, so the "
        "reviewer's own access is tested against whoever decides it.",
        ("op021-access",),
        ("The reviewer holds no such access", "The reviewer's manager decides it",
         "Another member of IT management decides it", "The reviewer decides it"),
        "As to the reviewer's own access to change the job schedule, {answer}.",
        since=_OPS,
    ),
    _multi(
        "wt-op021-decision-record", "RECORDS", 10,
        "How is the reviewer's decision on each user able to change the schedule recorded?",
        "The attribute requires a decision for each user, so a sign-off of the whole listing "
        "without one for each user is tested as such.",
        ("op021-access", "op021-signoff", "EVIDENCE"),
        ("Against each user in a review tool", "Against each user on the listing, signed and dated",
         "In a ticket with the marked-up listing attached", "As one sign-off of the whole listing"),
        "The reviewer's decision on each user is recorded {answer}.",
        since=_OPS,
    ),
    _multi(
        "wt-op021-listing-source", "POPULATION", 10,
        "How is the listing of users able to change the job schedule produced?",
        "The listing is information produced by the entity, so how it is produced decides how "
        "its completeness is tested against the scheduler's own users.",
        ("op021-complete", "POPULATION", "EVIDENCE"),
        ("A standard user and role report in the scheduler",
         "A custom query of the scheduler's security tables",
         "The directory groups the scheduler grants rights to", "A listing compiled by hand"),
        "The listing of users able to change the job schedule comes from {answer}.",
        since=_OPS,
    ),
)  # fmt: skip

# ITGC-OP-03 Backups are configured and scheduled.
_bank(
    "operations-backup",
    _multi(
        "wt-op03-data-covered", "SCOPE", 10,
        "Which of the system's data do the backup jobs cover?",
        "The configuration is tested for every store of the system's financial data, so a store "
        "the jobs leave out is a gap in the configuration attribute.",
        ("op03-config", "SCOPE"),
        ("The production database", "The database's transaction logs",
         "Application and file servers", "Interface and archive files"),
        "The backup jobs cover {answer}.",
        since=_OPS,
    ),
    _multi(
        "wt-op03-new-hosts", "SCOPE", 20,
        "How is a new server or database of the system added to the backup schedule?",
        "A server or database added in the period and left out of the schedule is not backed "
        "up, which the configuration attribute tests for every store of the system.",
        ("op03-config",),
        ("Automatically, by a policy that covers every host of the system",
         "By the backup administrator when the server is built",
         "Through a step in the server build or change checklist", "Without a set step"),
        "A new server or database of the system is added to the backup schedule {answer}.",
        since=_OPS,
    ),
    _multi(
        "wt-op03-change-approval", "APPROVAL", 10,
        "How is a change to a backup job's scope, schedule or retention approved?",
        "The attribute passes a change only with an approval under change management, so the "
        "route a change takes decides where its approval is requested.",
        ("op03-unchanged", "EVIDENCE"),
        ("A change under the change management process",
         "Approval by the IT operations manager, outside change management",
         "Approval by the backup administrator who makes it", "No approval"),
        "The route for approving a change to a backup job's scope, schedule or retention is "
        "{answer}.",
        since=_OPS,
    ),
    _choice(
        "wt-op03-history-kept", "RECORDS", 10,
        "How long does the backup tool keep its job history?",
        "The job history is the evidence that each scheduled backup ran on a day examined, so "
        "history kept for a short time decides when the days are selected and requested.",
        ("op03-ran", "EVIDENCE", "SAMPLE"),
        ("For the whole period or longer", "For about 90 days", "For 30 days or less",
         "Only until a job completes"),
        "The backup tool keeps its job history {answer}.",
        since=_OPS,
    ),
    _choice(
        "wt-op03-config-history", "RECORDS", 20,
        "What does the backup tool record of a change to a backup job's scope, schedule or "
        "retention?",
        "The tool's own change history is the evidence that the configuration stayed in place "
        "through the period, not only on the day it was inspected.",
        ("op03-unchanged", "EVIDENCE"),
        ("The old and new setting, who changed it and when",
         "Who changed it and when, without the old and new values",
         "Only the current setting and the date it last changed", "Nothing about the change"),
        "For a change to a backup job, the backup tool records {answer}.",
        since=_OPS,
    ),
)  # fmt: skip

# ITGC-OP-03.1 Failed backups are resolved.
_bank(
    "operations-backup-failures",
    _multi(
        "wt-op031-what-counts", "SCOPE", 10,
        "Which backup results does the daily review treat as failures?",
        "Each kind of result treated as a failure is part of the population drawn from the job "
        "history, and a kind left out is tested as a gap in the review.",
        ("op031-identified", "SCOPE", "POPULATION"),
        ("Failed jobs", "Jobs that completed with warnings or skipped files",
         "Jobs that did not start", "Jobs that ran outside their window"),
        "The daily review treats these results as failures: {answer}.",
        since=_OPS,
    ),
    _choice(
        "wt-op031-off-hours", "EXECUTION", 10,
        "When are backups that fail at weekends or on holidays reviewed?",
        "The attribute expects a failure to be noted on the day it failed, so a failure "
        "reviewed later is tested against what the procedure allows for those days.",
        ("op031-identified", "SAMPLE"),
        ("On the day, by an on-call or 24-hour team", "On the next business day",
         "At the next weekly check"),
        "Backups that fail at weekends or on holidays are reviewed {answer}.",
        since=_OPS,
    ),
    _multi(
        "wt-op031-review-record", "RECORDS", 10,
        "What record shows the day's review of backup results and the failures it noted?",
        "The review record is the evidence that each failure was noted on the day, and its form "
        "decides what is requested for each selected failure.",
        ("op031-identified", "op031-resolved", "EVIDENCE"),
        ("Alerts acknowledged in the backup tool",
         "A daily checklist or shift log signed by the reviewer", "A ticket for each failure",
         "An email of the day's results with the failures marked"),
        "The day's review of backup results is shown by {answer}.",
        since=_OPS,
    ),
    _multi(
        "wt-op031-resolution", "EXCEPTIONS", 10,
        "How is a failed backup resolved when it cannot be rerun within the time allowed?",
        "A failure resolved without a successful rerun passes only with a recorded resolution, "
        "so the ways it is resolved decide what is requested for each failure.",
        ("op031-resolved", "EVIDENCE"),
        ("By a backup taken by hand", "By escalating it as an incident",
         "By the next scheduled backup, with the gap accepted by IT management",
         "By the next scheduled backup, without a recorded acceptance"),
        "A failed backup that cannot be rerun within the time allowed is resolved {answer}.",
        since=_OPS,
    ),
    _choice(
        "wt-op031-job-history", "POPULATION", 10,
        "Which backups does the backup tool's job history list?",
        "The job history is the population of failed backups, so a history that leaves out "
        "backups that did not start needs the schedule itself to show what should have run.",
        ("op031-identified", "POPULATION", "EVIDENCE"),
        ("Every scheduled backup, including those that did not start",
         "Every backup that started, with its result", "Only the latest result of each job",
         "Only failed backups"),
        "The backup tool's job history lists {answer}.",
        since=_OPS,
    ),
)  # fmt: skip

# ITGC-OP-03.2 Backups are restored in a test.
_bank(
    "operations-restore-test",
    _multi(
        "wt-op032-what-restored", "SCOPE", 10,
        "What does the restore test restore?",
        "The attribute requires a restore of the system's financial data, so a test of other "
        "data, or of part of it, is tested against the data stores of the system.",
        ("op032-restore", "SCOPE"),
        ("The full production database", "Selected database tables or files",
         "Application servers or virtual machines",
         "The whole system, in a disaster recovery exercise"),
        "The restore test restores {answer}.",
        since=_OPS,
    ),
    _multi(
        "wt-op032-backup-identified", "EXECUTION", 10,
        "How does the restore test's record identify the backup it restored?",
        "The restored backup is agreed to the backup tool's catalog, which needs the test "
        "record to name it.",
        ("op032-restore", "EVIDENCE"),
        ("By its job or catalog ID in the backup tool", "By the date and time of the backup",
         "By the media or copy it came from", "The backup is not identified"),
        "The test record identifies the backup restored as follows: {answer}.",
        since=_OPS,
    ),
    _multi(
        "wt-op032-comparison", "EXECUTION", 20,
        "How is the restored data compared with the source?",
        "The comparison is what the attribute tests the restored data against, so a check that "
        "the data opens without comparing it shows it readable but not complete.",
        ("op032-compared", "EVIDENCE"),
        ("Record counts of key tables", "Control totals of amounts",
         "Checksums of the restored files", "Reports run in the system on the restored data",
         "A check that the data opens, without a comparison"),
        "The restored data is compared with the source using {answer}.",
        since=_OPS,
    ),
    _yes_no(
        "wt-op032-source-figures", "RECORDS", 10,
        "Are the source figures the restored data is compared with taken as at the date of the "
        "backup?",
        "Restored data is complete only against the source as it stood when the backup was "
        "taken, so figures taken on the day of the test are not a valid comparison.",
        ("op032-compared", "EVIDENCE"),
        yes="The source figures the restored data is compared with are taken as at the date of "
        "the backup.",
        no="The source figures the restored data is compared with are not taken as at the date "
        "of the backup.",
        since=_OPS,
    ),
    _multi(
        "wt-op032-failed-test", "EXCEPTIONS", 10,
        "What is done when a restore test fails or finds a difference from the source?",
        "A difference passes only when it is explained, so how failures and differences are "
        "handled decides what is requested beside the sign-off.",
        ("op032-compared", "EVIDENCE"),
        ("The cause is fixed and the test repeated", "An incident or problem record is raised",
         "The difference is explained in the sign-off", "Nothing beyond the sign-off"),
        "When a restore test fails or finds a difference, the following is done: {answer}.",
        since=_OPS,
    ),
)  # fmt: skip

# ITGC-OP-04 Incidents are tracked to resolution.
_bank(
    "operations-incidents",
    _multi(
        "wt-op04-system-link", "SCOPE", 10,
        "How is an incident linked to the system in the incident tool?",
        "The population is the incidents logged against the system, so how the link is "
        "recorded decides how the incidents are selected and whether any are missed.",
        ("op04-logged", "POPULATION"),
        ("A configuration item or service chosen on each ticket",
         "An assignment group that supports only this system",
         "Keywords in the ticket's description", "No link to the system"),
        "Incidents are linked to the system as follows: {answer}.",
        since=_OPS,
    ),
    _multi(
        "wt-op04-priority-set", "EXECUTION", 10,
        "How is an incident's priority set?",
        "A priority the tool calculates is tested once through its configuration, while one "
        "chosen by a person is compared with the procedure's criteria ticket by ticket.",
        ("op04-priority", "EVIDENCE"),
        ("Calculated by the tool from the impact and urgency chosen",
         "Chosen by the service desk analyst against the procedure's criteria",
         "Taken from the alert's severity in the monitoring tool",
         "Agreed with the person who reported it"),
        "An incident's priority is {answer}.",
        since=_OPS,
    ),
    _choice(
        "wt-op04-targets", "EXECUTION", 20,
        "What resolution targets does the incident procedure set?",
        "The attribute fails an incident left unresolved beyond the procedure's target, so the "
        "targets and how they are tracked decide what each incident is compared with.",
        ("op04-resolved", "EVIDENCE"),
        ("Targets by priority, tracked in the incident tool",
         "Targets by priority, not tracked in the tool", "No resolution targets"),
        "The incident procedure sets {answer}.",
        since=_OPS,
    ),
    _multi(
        "wt-op04-closure", "EXECUTION", 30,
        "How is an incident closed?",
        "The attribute requires a recorded resolution at closure, so a ticket the tool closes "
        "without one is tested as an exception rather than as a resolution.",
        ("op04-resolved", "EVIDENCE"),
        ("By the support team, with the resolution recorded",
         "Once the person who reported it confirms the resolution",
         "Automatically after a set time without a reply", "By the service owner after review"),
        "An incident is closed {answer}.",
        since=_OPS,
    ),
    _multi(
        "wt-op04-root-cause-record", "RECORDS", 10,
        "Where is a major incident's root cause recorded?",
        "Each major incident is traced to its root-cause record, so where it is kept is the "
        "evidence requested for each one.",
        ("op04-root-cause", "EVIDENCE"),
        ("In a problem record linked to the incident", "In a root-cause field on the incident",
         "In a post-incident review report", "In the change that fixed it"),
        "A major incident's root cause is recorded {answer}.",
        since=_OPS,
    ),
)  # fmt: skip

# ITGC-OP-05 Physical access to the data center is restricted. Who controls the access
# decides what is tested: the company's own badge system and review, or the provider's
# SOC 1 report; a MULTI, as a system can be hosted in both ways.
_OP05_OWN = "The company, in a data center, server room or cage it controls"
_OP05_PROVIDER = "A hosting or cloud provider, in its own data centers"
_bank(
    "operations-physical",
    _multi(
        "wt-op05-hosting", "SCOPE", 10,
        "Who controls physical access to the data centers that host the system's servers?",
        "Access the company controls is tested through its badge system and review, while "
        "access a provider controls is covered by the provider's SOC 1 report.",
        ("op05-review", "op05-soc", "SCOPE", "RELIANCE"),
        (_OP05_OWN, _OP05_PROVIDER),
        "Physical access to the data centers that host the system's servers is controlled by "
        "{answer}.",
        since=_OPS,
    ),
    _multi(
        "wt-op05-access-list", "SCOPE", 0,
        "How is the list of people with physical access produced for the review?",
        "The reviewed list must agree to the badge system's at the review date, so how it is "
        "produced decides how its completeness is tested.",
        ("op05-review", "op05-authorized", "POPULATION", "EVIDENCE"),
        ("A badge system report of active badges with data center access",
         "A query of the badge system's access groups", "A list kept by hand by facilities",
         "A key or sign-in register kept at the entrance"),
        "The list of people with physical access comes from {answer}.",
        when=("wt-op05-hosting", _OP05_OWN), since=_OPS,
    ),
    _multi(
        "wt-op05-grant-approval", "SCOPE", 0,
        "How is a person's physical access to the data center approved before it is granted?",
        "Each person on the list is tested against the authorization of their access, so how it "
        "is approved decides what is requested for each person.",
        ("op05-authorized", "EVIDENCE"),
        ("A request approved by the data center or facilities manager",
         "A request approved by the person's manager",
         "Granted by facilities on request, without a recorded approval"),
        "Physical access to the data center is authorized as follows: {answer}.",
        when=("wt-op05-hosting", _OP05_OWN), since=_OPS,
    ),
    _yes_no(
        "wt-op05-removal-record", "SCOPE", 0,
        "Does the badge system record when each person's access was removed, and by whom?",
        "The badge system's record is the evidence that each removal the reviewer decided was "
        "made, and without it removal is shown by the next list produced.",
        ("op05-removed", "EVIDENCE"),
        yes="The badge system records when each person's access was removed, and by whom.",
        no="The badge system does not record when each person's access was removed.",
        when=("wt-op05-hosting", _OP05_OWN), since=_OPS,
    ),
    _multi(
        "wt-op05-soc-coverage", "SCOPE", 0,
        "Which SOC 1 report covers physical access to the provider's data centers?",
        "Physical access may be carved out of the provider's report to a subservice "
        "organization, whose own report is then the one requested.",
        ("op05-soc", "RELIANCE", "EVIDENCE"),
        ("The provider's own report",
         "A subservice organization's report, as the provider's report carves it out",
         "No SOC 1 report"),
        "Physical access to the provider's data centers is covered by {answer}.",
        when=("wt-op05-hosting", _OP05_PROVIDER), since=_OPS,
    ),
    _multi(
        "wt-op05-holders", "SCOPE", 20,
        "Besides IT staff, who can hold physical access to the data center?",
        "Each group with access must be on the list reviewed and authorized, so a group left "
        "out is a gap in the list's completeness.",
        ("op05-authorized", "op05-review", "POPULATION"),
        ("Facilities and security staff", "Cleaning and maintenance contractors",
         "Vendor or provider engineers", "Visitors on temporary badges",
         "No one besides IT staff"),
        "Besides IT staff, physical access to the data center can be held by {answer}.",
        since=_OPS,
    ),
    _multi(
        "wt-op05-decision-record", "RECORDS", 10,
        "How is the reviewer's decision on each person with physical access recorded?",
        "The attribute requires a decision for each person and a dated sign-off, so a single "
        "approval of the whole list is tested as such.",
        ("op05-review", "op05-removed", "EVIDENCE"),
        ("Against each person on the list, signed and dated",
         "In the badge system's review function", "In a ticket with the marked-up list attached",
         "As one approval of the whole list"),
        "The reviewer's decision on each person is recorded {answer}.",
        since=_OPS,
    ),
)  # fmt: skip

# ITGC-OP-06 Interface failures and mismatches are resolved.
_bank(
    "operations-interfaces",
    _multi(
        "wt-op06-mismatch-check", "EXECUTION", 10,
        "How are record-count or control-total mismatches between source and target found?",
        "The attribute requires every mismatch to be noted, so runs whose counts are not "
        "compared show only failures and leave mismatches untested.",
        ("op06-identified", "op06-complete", "EVIDENCE"),
        ("Compared by the integration tool on each run",
         "A reconciliation report produced each day",
         "Compared by hand from the source and target counts",
         "Not compared, as only failed runs are reviewed"),
        "Mismatches between source and target are found as follows: {answer}.",
        since=_OPS,
    ),
    _choice(
        "wt-op06-off-hours", "EXECUTION", 20,
        "When are interface runs at weekends or on holidays reviewed?",
        "The attribute expects each failure or mismatch to be noted by the day's review, so "
        "runs reviewed later are tested against what the procedure allows for those days.",
        ("op06-identified", "SAMPLE"),
        ("On the day, by an on-call or 24-hour team", "On the next business day",
         "At the next weekly check"),
        "Interface runs at weekends or on holidays are reviewed {answer}.",
        since=_OPS,
    ),
    _yes_no(
        "wt-op06-recheck", "EXECUTION", 30,
        "After records are reprocessed or corrected, are the counts sent and received compared "
        "again?",
        "The completeness attribute compares the counts after the fix, and a recheck the team "
        "performs is the evidence of it.",
        ("op06-complete", "EVIDENCE"),
        yes="After records are reprocessed or corrected, the counts sent and received are "
        "compared again.",
        no="After records are reprocessed or corrected, the counts sent and received are not "
        "compared again.",
        since=_OPS,
    ),
    _multi(
        "wt-op06-review-record", "RECORDS", 10,
        "What record shows the day's review of interface runs and the failures or mismatches it "
        "noted?",
        "The review record is the evidence that each failure and mismatch was noted, and its "
        "form decides what is requested for each selected day.",
        ("op06-identified", "op06-resolved", "EVIDENCE"),
        ("Alerts acknowledged in the integration tool",
         "A daily checklist or log signed by the reviewer",
         "A ticket for each failure or mismatch",
         "An email of the day's results with the exceptions marked"),
        "The day's review of interface runs is shown by {answer}.",
        since=_OPS,
    ),
    _multi(
        "wt-op06-recovery", "EXCEPTIONS", 10,
        "How are the records of a failed or mismatched run recovered?",
        "Each way of recovering records leaves its own record of the cause and the action, "
        "which is the evidence the resolution attribute is tested from.",
        ("op06-resolved", "op06-complete", "EVIDENCE"),
        ("Reprocessed from the integration tool's error queue", "Resent by the source system",
         "Corrected by hand in the target system",
         "Corrected through a data change under change management"),
        "The records of a failed or mismatched run are {answer}.",
        since=_OPS,
    ),
    _choice(
        "wt-op06-run-log", "POPULATION", 10,
        "What does the integration tool's run log show for each run of an interface?",
        "The run log is the population for each selected day, so a log without counts, or "
        "without runs that did not start, needs another source for mismatches and missed runs.",
        ("op06-identified", "POPULATION", "EVIDENCE"),
        ("Each scheduled run, with its status and the counts sent and received",
         "Each run that started, with its status and counts", "Each run's status, without counts",
         "Only failed runs"),
        "For each run of an interface, the run log shows {answer}.",
        since=_OPS,
    ),
)  # fmt: skip

# ITGC-OP-07 Service organization (SOC 1) reports are reviewed. Which report each service
# organization provides is asked by the universal wt-service-org-report; the organizations
# themselves are a statement value ({service-orgs}).
_bank(
    "operations-soc-reports",
    _multi(
        "wt-op07-carve-out", "SCOPE", 10,
        "When a report carves out a subservice organization, how is that organization's part "
        "of the service covered?",
        "A carved-out subservice organization is outside the report's opinion, so the coverage "
        "attribute is tested against how its part of the service is covered.",
        ("op07-coverage", "SCOPE", "POPULATION"),
        ("Its own SOC 1 report is obtained and reviewed",
         "The service organization's monitoring of it is relied on",
         "It is not covered further", "No report relied on carves one out"),
        "A carved-out subservice organization's part of the service is covered as follows: "
        "{answer}.",
        since=_OPS,
    ),
    _multi(
        "wt-op07-cuec-mapping", "EXECUTION", 10,
        "Where is each complementary user entity control mapped to the company control that "
        "performs it?",
        "The attribute requires each complementary control to be mapped, and the mapping is "
        "the evidence requested for each report.",
        ("op07-cuecs", "EVIDENCE"),
        ("In the review memo", "In a separate mapping workbook", "In the risk and control matrix",
         "Nowhere"),
        "The mapping of complementary user entity controls to company controls is kept "
        "{answer}.",
        since=_OPS,
    ),
    _multi(
        "wt-op07-cuec-assurance", "EXECUTION", 20,
        "How is each mapped company control shown to be in place?",
        "The attribute passes a mapping only to a control that is in place and tested, so the "
        "source of that assurance decides what is requested for each mapping.",
        ("op07-cuecs", "EVIDENCE"),
        ("It is a control tested in this audit",
         "It is tested by internal audit or another assurance team",
         "Its control owner confirms it", "It is not shown"),
        "Each mapped company control is shown to be in place as follows: {answer}.",
        since=_OPS,
    ),
    _multi(
        "wt-op07-exception-assessment", "EXCEPTIONS", 10,
        "How is the effect of an exception a report notes on a control relied on assessed?",
        "The attribute requires each exception on a control relied on to be assessed for its "
        "effect, so how it is assessed decides what the memo is tested for.",
        ("op07-exceptions", "EVIDENCE"),
        ("Against the company's reliance, recorded in the memo",
         "With the service organization's response and a compensating company control",
         "By the owner of the affected process", "Only when the opinion is qualified"),
        "An exception on a control relied on is assessed {answer}.",
        since=_OPS,
    ),
)  # fmt: skip

# ITGC-OP-08 Vulnerabilities are found and remediated.
_bank(
    "operations-vulnerabilities",
    _multi(
        "wt-op08-inventory", "SCOPE", 10,
        "Which inventory lists the system's servers and databases that the scan must cover?",
        "The scope attribute compares the hosts scanned with the inventory, so the inventory "
        "named is what the completeness of each month's scan is tested against.",
        ("op08-scope", "POPULATION", "EVIDENCE"),
        ("The configuration management database", "The cloud provider's asset listing",
         "The scanner's own asset discovery", "A spreadsheet of hosts kept by IT"),
        "The system's servers and databases the scan must cover are listed in {answer}.",
        since=_OPS,
    ),
    _choice(
        "wt-op08-severity", "SCOPE", 20,
        "Which rating decides whether a finding is critical or high?",
        "The rating decides which findings are in the population of critical and high findings "
        "tested for remediation.",
        ("op08-remediated", "POPULATION"),
        ("The scanner's own severity rating", "The CVSS base score",
         "A rating the security team adjusts for the host's exposure"),
        "Whether a finding is critical or high is decided by {answer}.",
        since=_OPS,
    ),
    _multi(
        "wt-op08-closure", "EXECUTION", 10,
        "How is a finding marked as remediated?",
        "The attribute accepts a remediation only when a rescan confirms it, so a finding "
        "closed without a rescan is tested as an exception.",
        ("op08-remediated", "EVIDENCE"),
        ("Closed by the scanner when a rescan no longer detects it",
         "Closed by hand after a rescan is reviewed",
         "Closed by hand on the remediation team's word, without a rescan"),
        "Findings are marked as remediated as follows: {answer}.",
        since=_OPS,
    ),
    _choice(
        "wt-op08-first-seen", "RECORDS", 10,
        "From which date is a finding's remediation time measured?",
        "The attribute measures the time allowed from when the finding was first seen, so a "
        "later starting date makes a late remediation look timely.",
        ("op08-remediated", "EVIDENCE"),
        ("The date the scanner first detected it", "The date it was assigned for remediation",
         "The date of the vendor's patch or advisory"),
        "A finding's remediation time is measured from {answer}.",
        since=_OPS,
    ),
    _multi(
        "wt-op08-signoff-record", "RECORDS", 20,
        "How is the month's review of scan findings signed off?",
        "The attribute requires a sign-off that refers to the month's scan, so its form decides "
        "how the sign-off is agreed to that scan.",
        ("op08-signoff", "EVIDENCE"),
        ("In the scanner's report workflow", "On the scan report, signed or emailed back",
         "In the minutes of a monthly vulnerability meeting", "In a ticket for the month's review"),
        "The month's review of scan findings is signed off {answer}.",
        since=_OPS,
    ),
    _multi(
        "wt-op08-acceptance-record", "EXCEPTIONS", 10,
        "Where is a risk acceptance recorded, with its reason and expiry?",
        "Each acceptance is tested for its approver, reason and expiry, so where it is recorded "
        "is the evidence requested for each accepted finding.",
        ("op08-accepted", "op08-remediated", "EVIDENCE"),
        ("In the scanner, as an exception with an expiry date",
         "In the security exception register",
         "In a ticket approved by the approver of risk acceptances", "In an email"),
        "A risk acceptance is recorded {answer}.",
        since=_OPS,
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


# What each attribute's criteria need (B1k and B1l, 16 November 2026), read by the review of
# the questions asked.


def fact_of(item: Question) -> Fact:
    """The kind of fact a question's answer establishes (one of FACTS)."""
    return item.fact


def informing(library_key: str, definition_key: str) -> tuple[Question, ...]:
    """The questions a library control can be asked that inform one attribute of its testing
    definition (the attribute's key in their `informs`), in the asking order, with no nature
    or frequency filter, follow-ups included whether or not their parent's answer opens
    them: what the review reads for the attribute, each with its kind of fact (fact_of).
    Empty for an unknown control or attribute. Pure."""
    return tuple(item for item in questions_for(library_key) if definition_key in item.informs)


# The kinds of fact each attribute's criteria cannot be written without, by attribute
# definition key, for every attribute of the access, change and operations families. A fact
# the statement fixes for every item (an order such as "approved before it is applied") is
# listed where the criterion compares it, with the reason in MET_ELSEWHERE.
CRITERIA_NEEDS: dict[str, tuple[Fact, ...]] = {
    "ac01-request": ("RECORD",),
    "ac01-approver": ("APPROVER",),
    "ac01-before": ("TIMING", "RECORD"),
    "ac01-matches": ("PERFORMER",),
    "ac01-not-self": ("APPROVER", "PERFORMER"),
    "ac02-removed": ("RECORD",),
    "ac02-timely": ("TIMING", "RECORD"),
    "ac02-accounts": ("SYSTEM", "POPULATION"),
    "ac03-listing": ("POPULATION",),
    "ac03-reviewer": ("APPROVER",),
    "ac03-decisions": ("RECORD",),
    "ac03-actioned": ("RECORD",),
    "ac03-deadline": ("TIMING",),
    "ac03-investigated": ("EXCEPTION",),
    "ac04-complete": ("POPULATION",),
    "ac04-approved": ("APPROVER", "RECORD"),
    "ac04-independent": ("APPROVER",),
    "ac04-removed": ("RECORD",),
    "ac05-values": ("SYSTEM",),
    "ac05-unchanged": ("RECORD",),
    "ac05-scope": ("SYSTEM", "POPULATION"),
    "ac06-inventory": ("POPULATION",),
    "ac06-signoff": ("APPROVER",),
    "ac06-owner": ("RECORD",),
    "ac06-interactive": ("SYSTEM", "RECORD"),
    "ac06-disabled": ("RECORD",),
    "ac07-reapproved": ("APPROVER", "RECORD"),
    "ac07-removed": ("RECORD",),
    "ac07-timely": ("TIMING", "RECORD"),
    "ac08-approved": ("APPROVER", "TIMING"),
    "ac08-purpose": ("RECORD",),
    "ac08-reviewed": ("APPROVER",),
    "ac08-timely": ("TIMING",),
    "ac09-complete": ("POPULATION",),
    "ac09-sponsored": ("RECORD",),
    "ac09-expiry": ("SYSTEM", "TIMING"),
    "ac09-reviewed": ("APPROVER",),
    "ac10-complete": ("POPULATION",),
    "ac10-resolved": ("APPROVER", "RECORD"),
    "ac10-rules": ("RECORD", "APPROVER"),
    "ac10-signoff": ("APPROVER",),
    "ac11-complete": ("POPULATION", "SYSTEM"),
    "ac11-restricted": ("PERFORMER",),
    "ac11-reviewed": ("APPROVER",),
    "ac11-logged": ("RECORD",),
    "ac12-sources": ("SYSTEM",),
    "ac12-reviewed": ("RECORD", "POPULATION"),
    "ac12-escalated": ("EXCEPTION",),
    "cm01-request": ("RECORD",),
    "cm01-tested": ("PERFORMER",),
    "cm01-environment": ("SYSTEM",),
    "cm01-approved": ("APPROVER", "TIMING"),
    "cm01-segregated": ("APPROVER", "PERFORMER"),
    "cm01-matches": ("RECORD",),
    "cm02-record": ("RECORD",),
    "cm02-classified": ("APPROVER", "RECORD"),
    "cm02-reviewed": ("APPROVER",),
    "cm02-independent": ("APPROVER", "PERFORMER"),
    "cm02-approved": ("TIMING",),
    "cm03-listing": ("POPULATION",),
    "cm03-separate": ("PERFORMER", "POPULATION"),
    "cm03-authorized": ("RECORD",),
    "cm03-signoff": ("APPROVER", "EXCEPTION", "TIMING"),
    "cm04-request": ("RECORD",),
    "cm04-approval": ("APPROVER",),
    "cm04-matches": ("RECORD",),
    "cm04-independent": ("APPROVER", "PERFORMER"),
    "cm04-before": ("TIMING",),
    "cm05-approved": ("APPROVER",),
    "cm05-performer": ("PERFORMER",),
    "cm05-matches": ("RECORD",),
    "cm05-before": ("TIMING",),
    "cm06-record": ("RECORD",),
    "cm06-tested": ("SYSTEM",),
    "cm06-approved": ("APPROVER", "TIMING"),
    "cm06-independent": ("APPROVER", "PERFORMER"),
    "cm07-requirements": ("APPROVER",),
    "cm07-uat": ("APPROVER", "RECORD", "EXCEPTION"),
    "cm07-golive": ("APPROVER", "TIMING"),
    "cm08-reconciled": ("RECORD",),
    "cm08-resolved": ("EXCEPTION",),
    "cm08-approved": ("APPROVER", "TIMING"),
    # The operations family (18 November 2026; draft for professional review).
    "op01-identified": ("POPULATION", "RECORD"),
    "op01-logged": ("RECORD", "TIMING"),
    "op01-resolved": ("RECORD", "EXCEPTION"),
    "op01-complete": ("RECORD",),
    "op02-request": ("RECORD",),
    "op02-approved": ("APPROVER", "TIMING"),
    "op02-matches": ("RECORD",),
    "op021-complete": ("POPULATION",),
    "op021-signoff": ("APPROVER", "RECORD"),
    "op021-access": ("APPROVER", "RECORD"),
    "op03-config": ("SYSTEM", "TIMING"),
    "op03-ran": ("RECORD",),
    "op03-unchanged": ("RECORD", "APPROVER"),
    "op031-identified": ("POPULATION", "RECORD", "TIMING"),
    "op031-resolved": ("RECORD", "TIMING", "EXCEPTION"),
    "op032-restore": ("SYSTEM", "RECORD"),
    "op032-compared": ("RECORD", "TIMING", "EXCEPTION"),
    "op032-signoff": ("APPROVER", "PERFORMER"),
    "op04-logged": ("RECORD", "POPULATION"),
    "op04-priority": ("SYSTEM", "RECORD"),
    "op04-resolved": ("RECORD", "TIMING"),
    "op04-root-cause": ("RECORD", "POPULATION"),
    "op05-authorized": ("APPROVER", "POPULATION"),
    "op05-review": ("POPULATION", "RECORD", "APPROVER"),
    "op05-removed": ("RECORD",),
    "op05-soc": ("SYSTEM", "RECORD"),
    "op06-identified": ("POPULATION", "RECORD", "TIMING"),
    "op06-resolved": ("RECORD", "EXCEPTION"),
    "op06-complete": ("RECORD",),
    "op07-coverage": ("POPULATION", "RECORD", "TIMING"),
    "op07-exceptions": ("EXCEPTION",),
    "op07-cuecs": ("RECORD",),
    "op07-signoff": ("APPROVER", "TIMING"),
    "op08-scope": ("POPULATION", "SYSTEM"),
    "op08-remediated": ("POPULATION", "TIMING", "RECORD"),
    "op08-accepted": ("APPROVER", "RECORD", "TIMING"),
    "op08-signoff": ("APPROVER", "RECORD"),
}

# A need no question informs, with the reason it is met without one: a value the control's
# statement asks ({slot}, filled at setup), or what each item's own evidence shows. A need a
# question informs has no reason here (problems() reports one that does).
_FIXED_ORDER = "The statement fixes the order"
_REMOVAL_SHOWN = (
    "No deadline is tested: the removal is shown by the system's record of it or by the next "
    "listing produced from the system, which the evidence requests."
)
MET_ELSEWHERE: dict[tuple[str, Fact], str] = {
    ("ac01-request", "RECORD"): "{access-tool}: the statement names the tool each request is "
    "raised in.",
    ("ac01-not-self", "PERFORMER"): "{admin-role}: the statement names who grants access, and "
    "each grant's administrator is read from the system's record of it.",
    ("ac03-deadline", "TIMING"): "{review-deadline}: the statement asks the deadline.",
    ("ac04-approved", "APPROVER"): "{privileged-reviewer}: the statement asks who approves.",
    ("ac04-approved", "RECORD"): "The statement says the reviewer signs the listing, which is "
    "the record of each decision.",
    ("ac04-removed", "RECORD"): _REMOVAL_SHOWN,
    ("ac05-values", "SYSTEM"): "{auth-settings} and {security-policy}: the statement asks the "
    "required settings and the policy, and the authentication interview "
    "(authentication_profile.py) asks each configured value.",
    ("ac06-signoff", "APPROVER"): "{account-reviewer}: the statement asks who reviews.",
    ("ac06-disabled", "RECORD"): _REMOVAL_SHOWN,
    ("ac08-approved", "APPROVER"): "{ff-approver}: the statement asks who approves.",
    ("ac08-timely", "TIMING"): "{ff-review-days}: the statement asks the days allowed.",
    ("ac09-expiry", "TIMING"): "The engagement's end date is read, account by account, from "
    "the sponsor's approval or the contract the evidence requests.",
    ("ac09-reviewed", "APPROVER"): "{sponsor-reviewer}: the statement asks who reviews.",
    ("ac10-rules", "APPROVER"): "{sod-reviewer}: the statement asks who approves rule changes.",
    ("ac10-signoff", "APPROVER"): "{sod-reviewer}: the statement asks who reviews.",
    ("ac11-complete", "SYSTEM"): "wt-ac11-platforms and wt-ac11-instances ask the layers and "
    "instances for the whole control (its scope), which this attribute's listings follow.",
    ("ac11-restricted", "PERFORMER"): "{infra-admin-role}: the statement asks the roles allowed "
    "direct access.",
    ("ac11-reviewed", "APPROVER"): "{infra-reviewer}: the statement asks who reviews.",
    ("cm01-request", "RECORD"): "{change-tool}: the statement names the tool each change is "
    "raised in.",
    ("cm01-segregated", "PERFORMER"): "The developer and the implementer of each change are "
    "read from its ticket and deployment record, which the evidence requests change by change.",
    ("cm02-record", "RECORD"): "{change-tool}: the statement names the tool the ticket is in.",
    ("cm02-reviewed", "APPROVER"): "{emergency-approver}: the statement asks who approves.",
    ("cm02-approved", "TIMING"): "{emergency-days}: the statement asks the days allowed.",
    ("cm04-approval", "APPROVER"): "{config-approver}: the statement asks who approves.",
    ("cm04-matches", "RECORD"): "The configuration change log (wt-cm04-log-enabled) is the "
    "record each change is matched from, and wt-cm04-route says which log it is.",
    ("cm04-independent", "PERFORMER"): "The person who made each change is the configuration "
    "log's 'changed by', and who may change the configuration is asked for the scope "
    "(wt-cm04-who-can-configure).",
    ("cm04-before", "TIMING"): f"{_FIXED_ORDER} (approved before it is made), and both dates "
    "are read from the request and the log.",
    ("cm05-before", "TIMING"): f"{_FIXED_ORDER} (requested and approved before it is made), "
    "and both dates are read from the request and the log.",
    ("cm06-approved", "TIMING"): f"{_FIXED_ORDER} (approved before it is applied to "
    "production), and both times are read from the change record and the patch history.",
    ("cm07-requirements", "APPROVER"): "Each project names the business owner of the process "
    "it affects in its own requirements sign-off, which the evidence requests project by "
    "project.",
    ("cm07-golive", "APPROVER"): "{go-live-approver}: the statement asks who approves go-live.",
    ("cm07-golive", "TIMING"): f"{_FIXED_ORDER} (go-live approved before the release reaches "
    "production).",
    ("cm08-resolved", "EXCEPTION"): "Each difference and its resolution are recorded on the "
    "reconciliation itself, which the evidence requests for each data object.",
    ("cm08-approved", "TIMING"): f"{_FIXED_ORDER} (approved before cutover).",
    # The operations family (18 November 2026; draft for professional review).
    ("op02-approved", "APPROVER"): "{schedule-approver}: the statement asks who approves.",
    ("op021-signoff", "APPROVER"): "{ops-owner}: the statement names the control owner who "
    "reviews and signs off each quarter's listing.",
    ("op03-config", "TIMING"): "{backup-frequency} and {retention}: the statement asks how often "
    "backups run and how long they are kept.",
    ("op031-resolved", "TIMING"): "{backup-fix-days}: the statement asks the time allowed to "
    "resolve a failed backup.",
    ("op032-signoff", "APPROVER"): "{restore-reviewer}: the statement asks who signs off.",
    ("op032-signoff", "PERFORMER"): "{ops-role}: the statement names the team that performs "
    "restore tests, and each test's performer is read from its record.",
    ("op04-logged", "RECORD"): "{incident-tool}: the statement names the tool each incident is "
    "logged in, and each ticket's fields are read from it.",
    ("op04-priority", "RECORD"): "{incident-procedure}: the statement names the procedure whose "
    "priority criteria each ticket's priority is compared with.",
    ("op04-root-cause", "POPULATION"): "{major-priority}: the statement asks the priority that "
    "counts as major, which selects the incidents this attribute tests.",
    ("op05-review", "APPROVER"): "{facilities-reviewer}: the statement asks who reviews.",
    ("op07-coverage", "RECORD"): "wt-service-org-report asks which SOC 1 report is provided, and "
    "each report's period, scope and opinion are read from the report the evidence requests for "
    "each of {service-orgs}.",
    ("op07-coverage", "TIMING"): "The statement fixes the cover (a bridge letter for any gap to "
    "period end), and the report and letter dates are read from each.",
    ("op07-signoff", "APPROVER"): "{soc-reviewer}: the statement asks who reviews.",
    ("op07-signoff", "TIMING"): "The statement fixes the review each year, and each memo's "
    "sign-off date is read from it and compared with the period.",
    ("op08-scope", "SYSTEM"): "{scan-tool}: the statement names the scanner whose scope "
    "configuration is compared with the inventory.",
    ("op08-accepted", "APPROVER"): "{risk-acceptor}: the statement asks who approves risk "
    "acceptances.",
    ("op08-accepted", "TIMING"): "Each acceptance's expiry date is read from its record and "
    "compared with the date of the review.",
    ("op08-signoff", "APPROVER"): "{vuln-owner}: the statement asks who reviews scan findings.",
}


def criteria_needs(definition_key: str) -> tuple[Fact, ...]:
    """The kinds of fact an attribute's criteria cannot be written without (CRITERIA_NEEDS);
    empty for an attribute the access, change and operations families do not have. Pure."""
    return CRITERIA_NEEDS.get(definition_key, ())


def met_elsewhere(definition_key: str, fact: str) -> str:
    """Why an attribute's need is met without a question that informs it (MET_ELSEWHERE),
    or "" when a question is meant to inform it. Pure."""
    for (key, need), reason in MET_ELSEWHERE.items():
        if key == definition_key and need == fact:
            return reason
    return ""


def met_by_slot(slot_key: str) -> tuple[tuple[str, Fact], ...]:
    """The (attribute definition key, kind of fact) needs the bank records as met by a value
    of the statement (MET_ELSEWHERE names "{slot}"), in the record's order: the one reading of
    which value settles what, for the review's citations (understanding_review.slot_facts)
    and for a value left as not known (understanding_review.value_informs). Pure."""
    mark = "{" + slot_key + "}"
    return tuple(need for need, reason in MET_ELSEWHERE.items() if mark in reason)


_PERFORMS: tuple[Fact, ...] = ("PERFORMER",)
_APPROVES: tuple[Fact, ...] = ("APPROVER",)
_PERFORMS_AND_APPROVES: tuple[Fact, ...] = ("PERFORMER", "APPROVER")

# What each role slot of the library's statements records, when a value of it is cited for an
# attribute's need (owner decision, 18 November 2026, after the independent review of the
# citation rule: "an explicit slot to facts record"). Drafted from each slot's own meaning
# (its `why`), then decided here one by one; this record, not the slot's words, is the source,
# and a role slot it does not list records nothing (test_understanding_review_support checks
# every role slot of the library is listed). The control owner ("Accountable for the
# control's design and operation") names who answers for the control, never who performs or
# approves it: nothing. An operator who reviews (an access review's reviewer) performs the
# control and is its reviewer: both. A preparer, maintainer or operator performs it; a
# reviewer or approver approves it; who breaches are escalated to is how an exception is
# handled; the administrators allowed direct access are a population, not a party: nothing.
ROLE_SLOT_FACTS: dict[str, tuple[Fact, ...]] = {
    "access-owner": (),
    "accrual-owner": (),
    "ap-owner": (),
    "ar-owner": (),
    "bank-owner": (),
    "cash-owner": (),
    "change-owner": (),
    "consol-owner": (),
    "cost-owner": (),
    "count-owner": (),
    "credit-owner": (),
    "customer-owner": (),
    "cutoff-owner": (),
    "debt-owner": (),
    "depreciation-owner": (),
    "fa-owner": (),
    "flux-owner": (),
    "gl-owner": (),
    "indirect-tax-owner": (),
    "infra-admin-role": (),
    "inv-owner": (),
    "je-owner": (),
    "memo-owner": (),
    "ops-owner": (),
    "payment-owner": (),
    "payroll-owner": (),
    "payroll-recon-owner": (),
    "payroll-run-owner": (),
    "po-owner": (),
    "ptp-owner": (),
    "recon-owner": (),
    "reserve-owner": (),
    "revenue-owner": (),
    "signatory-owner": (),
    "tax-owner": (),
    "vendor-owner": (),
    "accrual-preparer": _PERFORMS,
    "admin-role": _PERFORMS,
    "ap-preparer": _PERFORMS,
    "ar-preparer": _PERFORMS,
    "bank-preparer": _PERFORMS,
    "cash-preparer": _PERFORMS,
    "conduct-owner": _PERFORMS,
    "consol-preparer": _PERFORMS,
    "cost-maintainer": _PERFORMS,
    "count-preparer": _PERFORMS,
    "count-team": _PERFORMS,
    "covenant-preparer": _PERFORMS,
    "credit-release-role": _PERFORMS,
    "customer-maintainer": _PERFORMS,
    "cutoff-preparer": _PERFORMS,
    "data-admin": _PERFORMS,
    "debt-preparer": _PERFORMS,
    "depreciation-preparer": _PERFORMS,
    "euc-owner": _PERFORMS,
    "fa-preparer": _PERFORMS,
    "flux-preparer": _PERFORMS,
    "impairment-preparer": _PERFORMS,
    "indirect-tax-preparer": _PERFORMS,
    "interface-owner": _PERFORMS,
    "inv-preparer": _PERFORMS,
    "investigator": _PERFORMS,
    "je-preparer": _PERFORMS,
    "ops-role": _PERFORMS,
    "pay-preparer": _PERFORMS,
    "payroll-maintainer": _PERFORMS,
    "payroll-recon-preparer": _PERFORMS,
    "payroll-run-preparer": _PERFORMS,
    "recon-preparer": _PERFORMS,
    "release-role": _PERFORMS,
    "reopen-role": _PERFORMS,
    "reserve-preparer": _PERFORMS,
    "rev-preparer": _PERFORMS,
    "soc-role": _PERFORMS,
    "tax-preparer": _PERFORMS,
    "vendor-maintainer": _PERFORMS,
    "accrual-reviewer": _APPROVES,
    "bank-reviewer": _APPROVES,
    "cash-reviewer": _APPROVES,
    "conduct-oversight": _APPROVES,
    "config-approver": _APPROVES,
    "consol-reviewer": _APPROVES,
    "cost-approver": _APPROVES,
    "count-reviewer": _APPROVES,
    "covenant-reviewer": _APPROVES,
    "customer-approver": _APPROVES,
    "cutoff-reviewer": _APPROVES,
    "debt-reviewer": _APPROVES,
    "depreciation-reviewer": _APPROVES,
    "disposal-approver": _APPROVES,
    "dup-reviewer": _APPROVES,
    "emergency-approver": _APPROVES,
    "fa-reviewer": _APPROVES,
    "ff-approver": _APPROVES,
    "flux-reviewer": _APPROVES,
    "go-live-approver": _APPROVES,
    "impairment-reviewer": _APPROVES,
    "indirect-tax-reviewer": _APPROVES,
    "it-approver": _APPROVES,
    "je-approver": _APPROVES,
    "migration-approver": _APPROVES,
    "patch-approver": _APPROVES,
    "payroll-approver": _APPROVES,
    "payroll-recon-reviewer": _APPROVES,
    "payroll-run-reviewer": _APPROVES,
    "pricing-approver": _APPROVES,
    "recon-reviewer": _APPROVES,
    "reserve-reviewer": _APPROVES,
    "restore-reviewer": _APPROVES,
    "risk-acceptor": _APPROVES,
    "schedule-approver": _APPROVES,
    "tax-reviewer": _APPROVES,
    "vendor-approver": _APPROVES,
    "wb-oversight": _APPROVES,
    "account-reviewer": _PERFORMS_AND_APPROVES,
    "deploy-reviewer": _PERFORMS_AND_APPROVES,
    "facilities-reviewer": _PERFORMS_AND_APPROVES,
    "ff-reviewer": _PERFORMS_AND_APPROVES,
    "infra-reviewer": _PERFORMS_AND_APPROVES,
    "payment-reviewer": _PERFORMS_AND_APPROVES,
    "privileged-reviewer": _PERFORMS_AND_APPROVES,
    "review-owner": _PERFORMS_AND_APPROVES,
    "signatory-reviewer": _PERFORMS_AND_APPROVES,
    "soc-reviewer": _PERFORMS_AND_APPROVES,
    "sod-reviewer": _PERFORMS_AND_APPROVES,
    "sponsor-reviewer": _PERFORMS_AND_APPROVES,
    "vuln-owner": _PERFORMS_AND_APPROVES,
    "covenant-escalation": ("EXCEPTION",),
}


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


def _under(item: Question, parent: str) -> bool:
    """Whether a question is asked under `parent`: a follow-up of it, or of one under it."""
    seen: set[str] = set()
    while item.when is not None and item.key not in seen:
        seen.add(item.key)
        if item.when[0] == parent:
            return True
        above = _BY_KEY.get(item.when[0])
        if above is None:
            return False
        item = above
    return False


def _order(scope: str, nature: str, frequency: str) -> list[str]:
    """For one control: each follow-up directly after its parent (or its parent's earlier
    follow-ups and what is asked under them), and no two questions of a topic sharing a place.

    19 November 2026: the bank's first follow-up of a follow-up (wt-service-org-no-report).
    Old: only the parent or a follow-up of the same parent could come directly before a
    follow-up, which a follow-up nested under an earlier sibling breaks. New: the parent or
    any question under it (_under); anything else still separates it from its parent."""
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
            if before.key != item.when[0] and not _under(before, item.when[0]):
                found.append(f"{item.key}: not directly after its parent for {where}")
        seen.add(item.key)
    return found


_SLOT = re.compile(r"\{([a-z][a-z0-9-]{1,40})\}")
_QUESTION_KEY = re.compile(r"\bwt-[a-z0-9-]+[a-z0-9]")


def _facts(every: Sequence[Question]) -> list[str]:
    """Every question has a kind of fact chosen in _FACTS, one of FACTS, and _FACTS names
    only questions of the bank."""
    keys = {item.key for item in every}
    found = [
        f"{item.key}: no kind of fact chosen (_FACTS)" for item in every if item.key not in _FACTS
    ]
    found.extend(
        f"{item.key}: unknown fact {item.fact}" for item in every if item.fact not in FACTS
    )
    found.extend(
        f"{item.key}: fact {item.fact}, but _FACTS chooses {_FACTS[item.key]}"
        for item in every
        if item.key in _FACTS and item.fact != _FACTS[item.key]
    )
    found.extend(
        f"{key}: a fact for a question not in the bank" for key in _FACTS if key not in keys
    )
    return found


def _needs() -> list[str]:
    """Every attribute of the access, change and operations families says what its criteria
    need, and every need is met by a question informing the attribute with that kind of fact
    or by a reason in MET_ELSEWHERE, never both; a reason names only the control's statement
    values and questions of the bank."""
    from ai_workforce_api.statement_registry import statement_for

    found: list[str] = []
    attributes: set[str] = set()
    for library_key in LIBRARY_KEYS:
        if not _family(library_key):
            continue
        definition = definition_for(library_key)
        statement = statement_for(library_key)
        slots = {slot.key for slot in statement.slots} if statement is not None else set()
        for attribute in definition.attributes if definition is not None else ():
            key = attribute.key
            attributes.add(key)
            needs = criteria_needs(key)
            if not needs or len(set(needs)) != len(needs) or not set(needs) <= set(FACTS):
                found.append(f"{key}: its criteria name no needs, or repeat or unknown ones")
            facts = {fact_of(item) for item in informing(library_key, key)}
            for need in needs:
                reason = met_elsewhere(key, need)
                if need in facts and reason:
                    found.append(f"{key}: {need} is informed by a question and has a reason")
                elif need not in facts and not reason:
                    found.append(f"{key}: no question informs its {need} and no reason is given")
                found.extend(
                    f"{key}: the reason for {need} names {slot}, not a value of {library_key}"
                    for slot in _SLOT.findall(reason)
                    if slot not in slots
                )
                found.extend(
                    f"{key}: the reason for {need} names {name}, not a question of {library_key}"
                    for name in _QUESTION_KEY.findall(reason)
                    if name not in {item.key for item in questions_for(library_key)}
                )
    found.extend(
        f"{key}: needs for an attribute of no family control"
        for key in CRITERIA_NEEDS
        if key not in attributes
    )
    found.extend(
        f"{key}: a reason for {need}, which its criteria do not need"
        for key, need in MET_ELSEWHERE
        if need not in criteria_needs(key)
    )
    return found


def problems() -> list[str]:
    """Structural checks over the whole bank: unique keys and texts, key pattern, lengths,
    options rules per kind; `when` parent exists, is in the same topic, is asked directly
    before its follow-ups for every control, and its value is a valid answer of the parent;
    a follow-up is never required when its parent is optional; no option starts with "Other",
    and only a CHOICE or MULTI question takes an Other answer, never as a follow-up's value;
    every question has an explicit place in its topic and no two share one for a control;
    every question informs at least one need, each a known token or an attribute key of every
    control it is asked for; every question is narrated; every library key in the access,
    change and operations families has a bank; a free-text question is one of TEXT_KEPT, and
    each of those is a free-text question of the bank; every question has a kind of fact
    (_facts); and every need of every family attribute's criteria is met by an informing
    question or a recorded reason (_needs)."""
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
            found.append(f"{key}: bank for a key that is not a library control of a family")
    for key, members in _LIMITED_TO.items():
        if key not in family_of:
            found.append(f"{key}: limited, but not a family question")
            continue
        found.extend(
            f"{key}: limited to {member}, not in its family"
            for member in sorted(members)
            if member not in LIBRARY_KEYS or _family(member) != family_of[key]
        )
    found.extend(_facts(every))
    found.extend(_needs())
    return sorted(set(found), key=found.index)
