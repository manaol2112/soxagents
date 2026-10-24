"""The evidence planner: what each testing phase of a control needs, and why.

Pure planning, without a database: the control's facts in, a validated plan out. The
service that stores plans and makes requests from them is tested in test_evidence_plans.
"""

from dataclasses import replace
from datetime import date
from typing import Any

import pytest

from ai_workforce_api.evidence_planning import (
    ControlChange,
    InterimResult,
    PlanFacts,
    PlanOutput,
    check_plan,
    forced_decisions,
    phase_periods,
    prompt_for,
    rules_plan,
    suite_description,
    suite_wording,
    traits_of,
)
from ai_workforce_api.evidence_plans import phase_state, requirement_state

YEAR_END = date(2026, 12, 31)


def _facts(**overrides: Any) -> PlanFacts:
    base: dict[str, Any] = {
        "control_ref": "ITGC-01",
        "title": "A control",
        "activity": "A control activity.",
        "risk": "Something goes wrong.",
        "domain": "ACCESS",
        "frequency": "EVENT_DRIVEN",
        "nature": "MANUAL",
        "attributes": ("The activity was performed",),
        "applications": ("SAP ERP",),
        "classifications": ("ITGC",),
        "period_end": YEAR_END,
    }
    return PlanFacts(**(base | overrides))


def _mfa() -> PlanFacts:
    return _facts(
        control_ref="ITGC-AC-07",
        title="MFA is enforced for privileged accounts",
        activity="Multi-factor authentication is enforced by the identity provider for every "
        "privileged account.",
        frequency="RECURRING",
        nature="AUTOMATED",
        attributes=(
            "MFA is required for every privileged account",
            "The MFA setting did not change in the period, or changes were approved",
        ),
    )


def _access_review() -> PlanFacts:
    return _facts(
        control_ref="ITGC-AC-03",
        title="User access is reviewed quarterly",
        activity="Application owners review all user access quarterly, and changes they "
        "request are made and tracked to completion.",
        frequency="QUARTERLY",
        nature="IT_DEPENDENT_MANUAL",
        classifications=("ITGC", "IT_DEPENDENT_MANUAL"),
        attributes=(
            "The review covered a complete and accurate user listing",
            "Changes requested in the review were made",
        ),
    )


def _change_approval() -> PlanFacts:
    return _facts(
        control_ref="ITGC-CM-01",
        title="Changes are tested and approved",
        domain="CHANGE",
        activity="Changes are requested, tested, and approved before they reach production.",
        attributes=("The change was approved before deployment", "The change was tested"),
    )


def _management_review() -> PlanFacts:
    return _facts(
        control_ref="RTR-02",
        title="Monthly flux review",
        domain="RECORD_TO_REPORT",
        frequency="MONTHLY",
        activity="The controller reviews the monthly balance sheet flux analysis and "
        "investigates variances over 50,000.",
        classifications=("BUSINESS_PROCESS",),
        process_required=True,
        process_confirmed=True,
        attributes=("Variances over the threshold were investigated",),
    )


def _report_review() -> PlanFacts:
    return _facts(
        control_ref="RTR-05",
        title="Unusual journal entries are reviewed",
        domain="RECORD_TO_REPORT",
        frequency="MONTHLY",
        nature="IT_DEPENDENT_MANUAL",
        activity="Management reviews a system-generated report of unusual journal entries "
        "each month and investigates each flagged entry.",
        classifications=("IT_DEPENDENT_MANUAL", "BUSINESS_PROCESS"),
        process_required=True,
        process_confirmed=True,
        attributes=("Each flagged entry was investigated",),
    )


def _plan(facts: PlanFacts) -> PlanOutput:
    return check_plan(rules_plan(facts), facts)


def _categories(plan: PlanOutput, phase: str) -> set[str]:
    return {c for r in plan.phase(phase).requirements for c in r.categories}


def _keys(plan: PlanOutput, phase: str) -> list[str]:
    return [r.key for r in plan.phase(phase).requirements]


def _requirement(plan: PlanOutput, phase: str, key: str) -> Any:
    return next(r for r in plan.phase(phase).requirements if r.key == key)


# Every phase, every time


def test_the_planner_follows_the_decided_basis() -> None:
    """A standard a person decided to follow is planned from at once, before its
    attributes are approved; the client's procedures never apply the standard; with no
    decision and no approved library attribute the control is planned by its kind."""
    leaver = _facts(
        control_ref="ITGC-SAP-02",
        title="Access is removed timely upon termination",
        activity="IT Security locks the SAP user within 1 business day of the termination.",
        library_key="access-termination",
    )
    standard_design = "Read the access policy's removal period"
    decided = _plan(replace(leaver, test_basis="STANDARD", basis_decided=True))
    assert decided.phase("DESIGN").procedures[0].startswith(standard_design)
    client = _plan(replace(leaver, test_basis="CLIENT", basis_decided=True))
    assert not any(item.startswith(standard_design) for item in client.phase("DESIGN").procedures)
    undecided = _plan(leaver)
    assert not any(
        item.startswith(standard_design) for item in undecided.phase("DESIGN").procedures
    )


def test_a_standard_with_an_evidence_suite_plans_its_evidence_from_it() -> None:
    """A control that follows a version 4 standard asks for the suite's items, phase by
    phase: the population and its support, then each item's attribute evidence depending
    on the population, worded with what makes it complete and what does not serve. The
    engagement's own change requirements stay; a configured control takes no sample."""
    from ai_workforce_api.definition_registry import BY_LIBRARY_KEY

    leaver = BY_LIBRARY_KEY["access-termination"]
    facts = _facts(
        control_ref="ITGC-SAP-02",
        title="Access is removed upon termination",
        activity="IT Security locks the SAP user within the period the policy allows.",
        attributes=tuple(item.text for item in leaver.approved),
        library_key="access-termination",
        test_basis="STANDARD",
        basis_decided=True,
    )
    plan = _plan(facts)
    design = {item.key: item for item in plan.phase("DESIGN").requirements}
    assert "design-ac02-e1" in design and design["design-ac02-e1"].categories == [
        "PROCESS_DOCUMENTATION"
    ]
    interim = {item.key: item for item in plan.phase("INTERIM").requirements}
    population = interim["interim-ac02-e3"]
    assert population.categories == ["POPULATION"]
    assert population.population_kind == "TRANSACTIONS"
    assert "Not sufficient:" in population.description
    assert "Completeness:" in population.description
    # The item is worded for the owner without repeating its own title, and reads back.
    assert population.title not in population.description
    wording = suite_wording(population.description)
    assert wording is not None and wording.include and wording.not_sufficient
    assert wording.note == ""
    # A sentence a person appends after it is theirs: kept apart, so the request still asks
    # for it, and written back in place.
    added = suite_wording(
        population.description + " Include each monthly access listing as its own sheet."
    )
    assert added is not None
    assert added.not_sufficient == wording.not_sufficient
    assert added.note == "Include each monthly access listing as its own sheet."
    assert suite_wording(suite_description(added)) == added
    sample = interim["interim-ac02-e5"]
    assert "SAMPLE" in sample.categories
    assert sample.depends_on == "interim-ac02-e3"
    assert sample.sample_selection.startswith("The audit team selects")
    assert sample.attributes and all(text in facts.attributes for text in sample.attributes)
    # The generic requirements are replaced; the roll-forward keeps the changes question.
    assert "interim-population" not in interim
    roll = {item.key for item in plan.phase("ROLLFORWARD").requirements}
    assert "rollforward-changes" in roll and "rollforward-ac02-e8" in roll
    # The client's own procedures leave the suite aside.
    client = _plan(replace(facts, test_basis="CLIENT"))
    assert "interim-population" in {i.key for i in client.phase("INTERIM").requirements}
    # A configured control's suite is tested without a sample.
    settings = BY_LIBRARY_KEY["access-authentication"]
    configured = _plan(
        _facts(
            control_ref="ITGC-AC-05",
            title="Authentication settings meet policy",
            activity="The system enforces the authentication settings the policy requires.",
            frequency="RECURRING",
            nature="AUTOMATED",
            attributes=tuple(item.text for item in settings.approved),
            library_key="access-authentication",
            test_basis="STANDARD",
            basis_decided=True,
        )
    )
    categories = {
        category
        for item in configured.phase("INTERIM").requirements
        for category in item.categories
    }
    assert "SAMPLE" not in categories and {"CONFIGURATION", "CHANGE_HISTORY"} <= categories


def test_every_version_4_standard_plans_and_validates() -> None:
    from ai_workforce_api.controls import BY_KEY
    from ai_workforce_api.definition_registry import DEFINITIONS

    for definition in DEFINITIONS:
        if definition.version < 4:
            continue
        control = BY_KEY[definition.library_key]
        facts = _facts(
            control_ref=control.control_ref,
            title=control.title,
            activity=control.activity,
            risk=control.risk,
            domain=control.domain,
            frequency=control.frequency,
            nature=control.nature,
            attributes=tuple(item.text for item in definition.approved),
            library_key=definition.library_key,
            test_basis="STANDARD",
            basis_decided=True,
        )
        plan = _plan(facts)
        for phase in plan.phases:
            keys = [item.key for item in phase.requirements]
            assert keys and any(key.endswith("-e1") or "-e" in key for key in keys), (
                definition.control_ref,
                phase.phase,
            )


def test_every_control_is_planned_for_all_three_phases() -> None:
    for facts in (_mfa(), _access_review(), _change_approval(), _management_review()):
        plan = _plan(facts)
        assert [p.phase for p in plan.phases] == ["DESIGN", "INTERIM", "ROLLFORWARD"]
        assert plan.phase("DESIGN").applicability == "APPLICABLE"
        assert plan.phase("INTERIM").applicability == "APPLICABLE"
        # The roll-forward waits for interim testing, and says so.
        roll = plan.phase("ROLLFORWARD")
        assert roll.applicability == "CONDITIONAL"
        assert "interim testing is signed off effective" in roll.condition
        assert roll.requirements, "a conditional phase still says what it will need"
        for phase in plan.phases:
            assert phase.rationale and phase.objectives and phase.procedures
            for requirement in phase.requirements:
                assert requirement.rationale and requirement.objective
                assert requirement.categories


# Scenario A: a configuration control


def test_a_configuration_control_is_tested_from_its_setting_not_a_sample() -> None:
    facts = _mfa()
    assert traits_of(facts).profile == "CONFIGURATION"
    plan = _plan(facts)
    design = _categories(plan, "DESIGN")
    assert {"CONFIGURATION", "OTHER", "CONTROL_EXECUTION"} <= design
    scope = _requirement(plan, "DESIGN", "design-scope-criteria")
    assert "privileged" in scope.description
    # Interim: the setting at the date and its history over the period, never a sample.
    assert _categories(plan, "INTERIM") == {"CONFIGURATION", "CHANGE_HISTORY"}
    history = _requirement(plan, "INTERIM", "interim-change-history")
    assert "A current screenshot does not prove" in history.rationale
    assert "1 January 2026 to 30 September 2026" in history.description
    # Roll-forward: changes after the interim date and the setting at period end.
    assert _keys(plan, "ROLLFORWARD") == ["rollforward-configuration", "rollforward-change-history"]
    assert (
        "1 October 2026 to 31 December 2026"
        in _requirement(plan, "ROLLFORWARD", "rollforward-change-history").description
    )
    for phase in plan.phases:
        assert not _categories(plan, phase.phase) & {"POPULATION", "SAMPLE"}


def test_a_model_plan_that_samples_an_automated_control_is_rejected() -> None:
    facts = _mfa()
    data = rules_plan(facts).model_dump()
    interim = next(p for p in data["phases"] if p["phase"] == "INTERIM")
    interim["requirements"].append(
        {
            "key": "interim-population",
            "title": "Every sign-in",
            "description": "Every privileged sign-in in the period.",
            "categories": ["POPULATION"],
            "objective": "Test sign-ins",
            "rationale": "To sample sign-ins.",
            "necessity": "REQUIRED",
        }
    )
    with pytest.raises(ValueError, match="not tested on a transaction sample"):
        check_plan(data, facts)


# Scenario B: a quarterly user access review


def test_a_quarterly_access_review_separates_reviews_from_the_accounts_reviewed() -> None:
    plan = _plan(_access_review())
    assert "design-review-criteria" in _keys(plan, "DESIGN")
    assert "PROCESS_DOCUMENTATION" in _categories(plan, "DESIGN")
    population = _requirement(plan, "INTERIM", "interim-population")
    assert population.population_kind == "CONTROL_EXECUTIONS"
    # Three quarters fall in the interim period for a December year end.
    assert "(3 expected" in population.description
    assert "the quarter ending 30 September 2026" in population.description
    listing = _requirement(plan, "INTERIM", "interim-review-listing")
    assert listing.population_kind == "ITEMS_REVIEWED"
    assert listing.depends_on == "interim-population"
    assert "not the population of accounts reviewed" in listing.rationale
    sample = _requirement(plan, "INTERIM", "interim-sample-evidence")
    assert sample.depends_on == "interim-population"
    assert "selects 2" in sample.sample_selection
    assert "not the control owner" in sample.sample_selection
    # The roll-forward covers only the quarter left after the interim date.
    roll = _requirement(plan, "ROLLFORWARD", "rollforward-population")
    assert "(1 expected: the quarter ending 31 December 2026)" in roll.description
    assert (
        "selects 1"
        in _requirement(plan, "ROLLFORWARD", "rollforward-sample-evidence").sample_selection
    )
    assert (
        "interim samples are not repeated"
        in _requirement(plan, "ROLLFORWARD", "rollforward-sample-evidence").sample_selection
    )


# Scenario C: change-management approval


def test_a_change_approval_control_samples_changes_from_a_validated_population() -> None:
    plan = _plan(_change_approval())
    assert {"design-approval-workflow", "design-approvers"} <= set(_keys(plan, "DESIGN"))
    workflow = _requirement(plan, "DESIGN", "design-approval-workflow")
    assert set(workflow.categories) == {"PROCESS_DOCUMENTATION", "CONFIGURATION"}
    population = _requirement(plan, "INTERIM", "interim-population")
    assert population.population_kind == "TRANSACTIONS"
    assert "production change" in population.description
    support = _requirement(plan, "INTERIM", "interim-population-support")
    assert support.necessity == "REQUIRED"
    assert "deployment or change log" in support.description
    sample = _requirement(plan, "INTERIM", "interim-sample-evidence")
    assert sample.depends_on == "interim-population"
    assert sample.attributes == [
        "The change was approved before deployment",
        "The change was tested",
    ]
    assert "selects 25" in sample.sample_selection
    roll_sample = _requirement(plan, "ROLLFORWARD", "rollforward-sample-evidence")
    assert roll_sample.depends_on == "rollforward-population"
    assert "selects 10" in roll_sample.sample_selection


# Scenario D: a management review


def test_a_management_review_needs_its_precision_and_evidence_of_actual_reviews() -> None:
    facts = _management_review()
    assert traits_of(facts).profile == "MANAGEMENT_REVIEW"
    plan = _plan(facts)
    precision = _requirement(plan, "DESIGN", "design-review-precision")
    assert "thresholds" in precision.description
    assert {"POPULATION", "SAMPLE"} <= _categories(plan, "INTERIM")
    sample = _requirement(plan, "INTERIM", "interim-sample-evidence")
    assert "investigated and resolved" in sample.description


def test_a_narrative_alone_never_stands_for_operating_evidence() -> None:
    facts = _management_review()
    data = rules_plan(facts).model_dump()
    interim = next(p for p in data["phases"] if p["phase"] == "INTERIM")
    interim["requirements"] = [
        {
            "key": "interim-narrative",
            "title": "Process narrative",
            "description": "The narrative of the monthly review process.",
            "categories": ["PROCESS_DOCUMENTATION"],
            "objective": "Understand the review",
            "rationale": "Shows how the review works.",
            "necessity": "REQUIRED",
        }
    ]
    with pytest.raises(ValueError, match="needs the population and the sample evidence"):
        check_plan(data, facts)


# Scenario E: an IT-dependent manual control


def test_a_report_review_tracks_report_reliability_apart_from_the_review() -> None:
    plan = _plan(_report_review())
    assert "design-report" in _keys(plan, "DESIGN")
    reliability = _requirement(plan, "INTERIM", "interim-report-reliability")
    review = _requirement(plan, "INTERIM", "interim-sample-evidence")
    assert reliability.categories == ["REPORT_RELIABILITY"]
    assert "SAMPLE" in review.categories and "REPORT_RELIABILITY" not in review.categories
    assert "tracked separately" in reliability.rationale
    assert "rollforward-report-reliability" in _keys(plan, "ROLLFORWARD")


def test_a_report_review_without_report_reliability_is_rejected() -> None:
    facts = _report_review()
    data = rules_plan(facts).model_dump()
    interim = next(p for p in data["phases"] if p["phase"] == "INTERIM")
    interim["requirements"] = [
        r for r in interim["requirements"] if "REPORT_RELIABILITY" not in r["categories"]
    ]
    with pytest.raises(ValueError, match="report the control relies on"):
        check_plan(data, facts)


# Scenario F: a material change after interim


def test_a_change_after_interim_adds_evidence_and_asks_for_auditor_review() -> None:
    change = ControlChange(date(2026, 11, 15), "CONFIGURATION", "MFA moved to a new provider")
    plan = _plan(replace(_mfa(), changes=(change,)))
    assert "rollforward-change-1" in _keys(plan, "ROLLFORWARD")
    evidence = _requirement(plan, "ROLLFORWARD", "rollforward-change-1")
    assert "15 November 2026" in evidence.description
    assert evidence.period_label == "From 15 November 2026"
    assert "design-change-1" in _keys(plan, "DESIGN")
    assert plan.exceptions and "15 November 2026" in plan.exceptions[0]
    assert plan.approvals_required


# Scenario G: process documentation only where it is needed


def test_a_narrative_is_requested_only_when_the_process_is_not_understood() -> None:
    unknown = _facts(
        domain="ORDER_TO_CASH",
        activity="The credit manager approves every credit note over 10,000.",
        classifications=("BUSINESS_PROCESS",),
        process_required=True,
    )
    plan = _plan(unknown)
    narrative = _requirement(plan, "DESIGN", "design-process-narrative")
    assert narrative.necessity == "REQUIRED"
    assert "no confirmed process map or narrative" in narrative.rationale
    # Interim testing is planned regardless: the missing narrative blocks nothing else.
    assert plan.phase("INTERIM").applicability == "APPLICABLE"
    assert plan.understanding.process_understanding_needed is True
    understood = _plan(unknown_with(process_confirmed=True))
    assert "design-process-narrative" not in _keys(understood, "DESIGN")
    documented = _plan(unknown_with(documents=("NARRATIVE",)))
    assert "design-process-narrative" not in _keys(documented, "DESIGN")
    # An IT general control is never asked for a process narrative.
    assert "design-process-narrative" not in _keys(_plan(_change_approval()), "DESIGN")


def unknown_with(**overrides: Any) -> PlanFacts:
    base: dict[str, Any] = {
        "domain": "ORDER_TO_CASH",
        "activity": "The credit manager approves every credit note over 10,000.",
        "classifications": ("BUSINESS_PROCESS",),
        "process_required": True,
    }
    return _facts(**(base | overrides))


def test_a_business_control_whose_process_is_unknown_must_ask_for_it() -> None:
    facts = unknown_with()
    data = rules_plan(facts).model_dump()
    design = next(p for p in data["phases"] if p["phase"] == "DESIGN")
    design["requirements"] = [
        r for r in design["requirements"] if "PROCESS_DOCUMENTATION" not in r["categories"]
    ]
    with pytest.raises(ValueError, match="process is not understood"):
        check_plan(data, facts)


# Scenario J: not applicable, with a reason, never for missing evidence


def test_a_control_introduced_after_interim_has_no_interim_phase_and_says_why() -> None:
    late = replace(
        _change_approval(),
        changes=(ControlChange(date(2026, 11, 1), "INTRODUCED", "New control"),),
    )
    plan = _plan(late)
    interim = plan.phase("INTERIM")
    assert interim.applicability == "NOT_APPLICABLE"
    assert "introduced on 1 November 2026" in interim.rationale
    assert interim.requirements == []
    roll = plan.phase("ROLLFORWARD")
    assert roll.applicability == "APPLICABLE"
    assert phase_periods(late)["ROLLFORWARD"].start == date(2026, 11, 1)


def test_missing_evidence_is_never_a_reason_a_phase_does_not_apply() -> None:
    facts = _access_review()
    data = rules_plan(facts).model_dump()
    interim = next(p for p in data["phases"] if p["phase"] == "INTERIM")
    interim["applicability"] = "NOT_APPLICABLE"
    interim["rationale"] = "The population was not received from the owner, so skip it."
    with pytest.raises(ValueError, match="only for a specific reason"):
        check_plan(data, facts)
    design = next(p for p in data["phases"] if p["phase"] == "DESIGN")
    design["applicability"] = "NOT_APPLICABLE"
    with pytest.raises(ValueError):
        check_plan(data, facts)


def test_unknowns_make_a_phase_pending_with_its_question() -> None:
    plan = _plan(_access_review())
    assert plan.phase("INTERIM").applicability == "APPLICABLE"
    unknown = replace(_access_review(), period_end=None)
    pending = _plan(unknown)
    for phase in ("INTERIM", "ROLLFORWARD"):
        assert pending.phase(phase).applicability == "PENDING"
        assert "period end" in pending.phase(phase).open_question
    assert pending.provisional is True


# The roll-forward follows interim testing


def test_the_roll_forward_follows_the_interim_result() -> None:
    base = _access_review()
    effective = replace(
        base,
        interim=InterimResult("SIGNED_OFF", "EFFECTIVE", date(2026, 9, 30)),
        rollforward_window=(date(2026, 10, 1), YEAR_END),
    )
    assert forced_decisions(effective)["ROLLFORWARD"].applicability == "APPLICABLE"
    failed = replace(base, interim=InterimResult("SIGNED_OFF", "NOT_EFFECTIVE"))
    decision = forced_decisions(failed)["ROLLFORWARD"]
    assert decision.applicability == "PENDING"
    assert "not appropriate" in decision.rationale
    covered = replace(base, interim=InterimResult("SIGNED_OFF", "EFFECTIVE", YEAR_END))
    assert forced_decisions(covered)["ROLLFORWARD"].applicability == "NOT_APPLICABLE"
    # The planner cannot override what the records settle.
    data = rules_plan(failed).model_dump()
    next(p for p in data["phases"] if p["phase"] == "ROLLFORWARD")["applicability"] = "APPLICABLE"
    assert check_plan(data, failed).phase("ROLLFORWARD").applicability == "PENDING"


# The model's answer is checked like any untrusted input


def test_a_plan_never_invents_attributes_claims_results_or_asks_the_owner_to_sample() -> None:
    facts = _change_approval()
    changes: tuple[tuple[dict[str, Any], str], ...] = (
        ({"attributes": ["An attribute nobody wrote"]}, "attribute the control does not have"),
        ({"description": "The population has been received and validated."}, "claims work"),
        (
            {"description": "Please send the population; you select 25 samples."},
            "select samples",
        ),
        ({"description": "Download it from https://example.com/list."}, "link"),
    )
    for change, message in changes:
        data = rules_plan(facts).model_dump()
        interim = next(p for p in data["phases"] if p["phase"] == "INTERIM")
        interim["requirements"][0].update(change)
        with pytest.raises(ValueError, match=message):
            check_plan(data, facts)


def test_sample_evidence_must_depend_on_its_population() -> None:
    facts = _change_approval()
    data = rules_plan(facts).model_dump()
    interim = next(p for p in data["phases"] if p["phase"] == "INTERIM")
    sample = next(r for r in interim["requirements"] if "SAMPLE" in r["categories"])
    sample["depends_on"] = None
    with pytest.raises(ValueError, match="depend on the population"):
        check_plan(data, facts)


def test_the_prompt_carries_the_facts_and_the_decisions_the_records_settle() -> None:
    prompt = prompt_for(_access_review())
    assert "<control>" in prompt
    assert '"decided_by_records"' in prompt
    assert '"suggested_control_type": "POPULATION"' in prompt
    assert '"interim": 2' in prompt


# States: nothing is complete because a request exists or a file arrived


def test_receipt_and_sufficiency_are_separate_states() -> None:
    assert requirement_state("PLANNED", None, None, "NOT_REVIEWED") == "NOT_GENERATED"
    assert requirement_state("AWAITING_DEPENDENCY", None, None, "NOT_REVIEWED") == (
        "AWAITING_DEPENDENCY"
    )
    assert requirement_state("REQUESTED", "DRAFT", "PENDING", "NOT_REVIEWED") == "DRAFT"
    assert requirement_state("REQUESTED", "DRAFT", "DRAFTED", "NOT_REVIEWED") == (
        "READY_FOR_REVIEW"
    )
    assert requirement_state("REQUESTED", "APPROVAL_PENDING", None, "NOT_REVIEWED") == (
        "APPROVAL_PENDING"
    )
    assert requirement_state("REQUESTED", "SENT", None, "NOT_REVIEWED") == "SENT"
    assert requirement_state("REQUESTED", "RECEIVED", None, "NOT_REVIEWED") == "RECEIVED"
    # A partly received request has some of its items in. An item with nothing of its own
    # is still awaited; one with a file that serves it is partly received (22 Oct 2026:
    # every item of a partly received request read as partly received before).
    assert requirement_state("REQUESTED", "PARTIALLY_RECEIVED", None, "NOT_REVIEWED") == "SENT"
    assert requirement_state("REQUESTED", "PARTIALLY_RECEIVED", None, "NOT_REVIEWED", True) == (
        "PARTIALLY_RECEIVED"
    )
    assert requirement_state("REQUESTED", "RECEIVED", None, "ACCEPTED") == "ACCEPTED"
    assert requirement_state("REQUESTED", "RECEIVED", None, "INSUFFICIENT") == "INSUFFICIENT"
    assert requirement_state("REQUESTED", "CLOSED", None, "FOLLOW_UP_REQUIRED") == (
        "FOLLOW_UP_REQUIRED"
    )
    assert requirement_state("WAIVED", None, None, "NOT_REVIEWED") == "NOT_APPLICABLE"
    # A file on a reply the request still waits on has arrived, though no one marked the
    # request received; a person's judgement then stands.
    assert requirement_state("REQUESTED", "SENT", None, "NOT_REVIEWED", True) == (
        "PARTIALLY_RECEIVED"
    )
    assert requirement_state("REQUESTED", "SENT", None, "ACCEPTED", True) == "ACCEPTED"
    assert requirement_state("REQUESTED", "OVERDUE", None, "NOT_REVIEWED") == "OVERDUE"


def test_a_phase_reads_its_own_state_and_an_empty_list_is_never_done() -> None:
    assert phase_state(False, None, False, []) == "NOT_PLANNED"
    assert phase_state(True, "NOT_APPLICABLE", False, []) == "NOT_APPLICABLE"
    assert phase_state(True, "PENDING", False, []) == "AWAITING_CLARIFICATION"
    assert phase_state(True, "CONDITIONAL", False, [("NOT_GENERATED", "REQUIRED")]) == (
        "CONDITIONAL"
    )
    assert phase_state(True, "APPLICABLE", False, []) == "NOT_GENERATED"
    assert phase_state(True, "APPLICABLE", False, [("SENT", "REQUIRED")]) == "OUTSTANDING"
    # Drafted or awaiting approval is not outstanding with the owner: nothing was sent.
    for state in ("DRAFT", "READY_FOR_REVIEW", "APPROVAL_PENDING"):
        assert phase_state(True, "APPLICABLE", False, [(state, "REQUIRED")]) == "NOT_SENT"
    # One item sent and one drafted: the phase is outstanding with the owner.
    assert (
        phase_state(
            True, "APPLICABLE", False, [("SENT", "REQUIRED"), ("READY_FOR_REVIEW", "REQUIRED")]
        )
        == "OUTSTANDING"
    )
    assert phase_state(True, "APPLICABLE", False, [("RECEIVED", "REQUIRED")]) == (
        "RECEIVED_NOT_VALIDATED"
    )
    assert (
        phase_state(
            True,
            "APPLICABLE",
            False,
            [("ACCEPTED", "REQUIRED"), ("AWAITING_DEPENDENCY", "REQUIRED")],
        )
        == "AWAITING_DEPENDENCY"
    )
    accepted = [("ACCEPTED", "REQUIRED"), ("NOT_GENERATED", "OPTIONAL")]
    assert phase_state(True, "APPLICABLE", False, accepted) == "EVIDENCE_ACCEPTED"
    # Complete only when the phase's testing is: never from requests or receipt alone.
    assert phase_state(True, "APPLICABLE", True, accepted) == "COMPLETE"
