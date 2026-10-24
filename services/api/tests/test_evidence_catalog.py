"""Release 2a (docs/release-2a.md): the evidence catalog, evidence specifications, the
compatibility rules, and the read-only consolidation analysis."""

import re
from collections import Counter
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

import psycopg
import pytest
from support import Database
from test_evidence_intake import _client, _Scheduler
from test_onboarding import _new_engagement
from test_outbound import migrated
from test_shared_plans import _approve, _base, _engagement, _families

from ai_workforce_api.consolidation import (
    Row,
    SpecificationStale,
    packages,
    require_fresh,
    staleness,
)
from ai_workforce_api.db import connect
from ai_workforce_api.evidence_catalog import (
    ITEM_KINDS,
    REVIEWED_NOT_SENSITIVE,
    SENSITIVE_ITEMS,
    RequirementFacts,
    Spec,
    catalog_review,
    compatibility,
    spec_hash,
    specification,
)

_ = migrated

# The catalog


def test_every_library_evidence_item_is_classified_and_reviewed() -> None:
    """A change detector for methodology review: a library item added, removed, or moved
    to another kind changes these counts, and the catalog is reviewed with it."""
    rows = catalog_review()
    items = {row["item"] for row in rows}
    assert set(ITEM_KINDS) <= items, set(ITEM_KINDS) - items
    assert len(rows) == 350
    assert Counter(row["kind"] for row in rows) == {
        "CONTROL_SPECIFIC": 298,
        "POLICY_DOCUMENT": 31,
        "CHANGE_RIGHTS": 13,
        "DEPLOYMENT_LOG": 3,
        "DAY_CALENDAR": 3,
        "HR_LEAVERS": 1,
        "HR_TRANSFERS": 1,
    }


def test_sensitivity_is_reviewed_item_by_item_never_guessed_from_words() -> None:
    """Words only prompt the review: every library item whose wording mentions HR,
    payroll, employees, leavers or transfers must be in one of the two reviewed lists,
    and only the lists decide."""
    rows = {row["item"]: row for row in catalog_review()}
    assert not SENSITIVE_ITEMS & REVIEWED_NOT_SENSITIVE
    assert (SENSITIVE_ITEMS | REVIEWED_NOT_SENSITIVE) <= set(rows)
    words = re.compile(
        r"\b(hr|payroll|employees?|salar(y|ies)|leavers?|terminations?|transfers?|hires?|"
        r"manager relationship|wages?|personnel)\b",
        re.IGNORECASE,
    )
    prompted = {item for item, row in rows.items() if words.search(row["text"])}
    assert prompted <= SENSITIVE_ITEMS | REVIEWED_NOT_SENSITIVE, sorted(
        prompted - SENSITIVE_ITEMS - REVIEWED_NOT_SENSITIVE
    )
    assert {item for item, row in rows.items() if row["sensitivity"] == "PERSONAL"} == (
        SENSITIVE_ITEMS
    )


def _facts(**change: Any) -> RequirementFacts:
    fields: dict[str, Any] = {
        "requirement_key": "interim-ac02-e3", "phase": "INTERIM", "title": "HR leavers",
        "categories": ("POPULATION",), "origin": "RULES", "period_start": date(2026, 7, 1),
        "period_end": date(2026, 9, 30), "as_of": None, "control_id": "c-sap",
        "library_key": "access-termination", "application_id": "sap",
        "implementation_key": "sap",
    }  # fmt: skip
    fields.update(change)
    return RequirementFacts(**fields)


def test_a_specification_names_the_artifact_and_its_scope() -> None:
    leavers = specification(_facts())
    assert (leavers.kind, leavers.level, leavers.sensitivity) == (
        "HR_LEAVERS",
        "ORGANIZATION",
        "PERSONAL",
    )
    # Organization-wide: the system is not part of what the artifact is.
    assert leavers.system is None and leavers.units == []
    other_system = specification(_facts(control_id="c-ad", application_id="ad",
                                        implementation_key="ad"))  # fmt: skip
    assert spec_hash(leavers) == spec_hash(other_system)
    # A split implementation carries its units, and they are part of the fingerprint.
    uk = specification(_facts(implementation_key="sap:u-uk"))
    assert uk.units == ["u-uk"] and spec_hash(uk) != spec_hash(leavers)
    # A policy item: one document per item; a rules-generated procedure is the control's own.
    policy = specification(_facts(requirement_key="design-ac02-e1", phase="DESIGN",
                                  categories=("PROCESS_DOCUMENTATION",)))  # fmt: skip
    assert (policy.kind, policy.identity) == ("POLICY_DOCUMENT", {"document": "ac02-e1"})
    procedure = specification(
        _facts(requirement_key="design-procedure", phase="DESIGN", library_key="",
               categories=("PROCESS_DOCUMENTATION",))
    )  # fmt: skip
    assert procedure.kind == "POLICY_DOCUMENT"
    assert procedure.identity == {"document": "c-sap:procedure"}
    # A custom control (no library entry): its sensitivity is not established.
    assert procedure.sensitivity == "UNKNOWN"
    changes = specification(_facts(requirement_key="rollforward-changes", phase="ROLLFORWARD",
                                   library_key=""))  # fmt: skip
    assert changes.kind == "CONTROL_SPECIFIC" and changes.control == "c-sap"
    assert changes.sensitivity == "UNKNOWN"
    # A payroll control's evidence is personal data; its documented procedure is not.
    payroll = {"library_key": "h2r-payroll-changes", "domain": "HIRE_TO_RETIRE"}
    assert specification(_facts(requirement_key="interim-population", **payroll)).sensitivity == (
        "PERSONAL"
    )
    assert specification(_facts(requirement_key="design-procedure", phase="DESIGN",
                                **payroll)).sensitivity == "STANDARD"  # fmt: skip
    # Reviewed: a leaver's IT account record is not HR data; a manager of record is.
    leaver_accounts = specification(_facts(requirement_key="interim-ac02-e5"))
    assert leaver_accounts.sensitivity == "STANDARD"
    manager = specification(_facts(requirement_key="interim-ac07-e7",
                                   library_key="access-transfer"))  # fmt: skip
    assert manager.sensitivity == "PERSONAL"
    # Outside the catalog: written by a person, or a library item the catalog does not know.
    written = specification(_facts(origin="PERSON", requirement_key="interim-extra"))
    assert written.kind is None and "not from the library" in written.unmapped_reason
    assert written.sensitivity == "UNKNOWN"
    unknown = specification(_facts(requirement_key="interim-zz99-e1", library_key="nothing"))
    assert unknown.kind is None
    # Who provides it is delivery, not identity.
    assert spec_hash(leavers) == spec_hash(leavers.model_copy(update={"provider": "Someone"}))


# The rules


def _spec(**change: Any) -> Spec:
    fields: dict[str, Any] = {
        "kind": "DEPLOYMENT_LOG", "identity": {"selection": "all deployments"},
        "level": "SYSTEM", "system": "sap", "period_type": "WINDOW",
        "period_start": date(2026, 7, 1), "period_end": date(2026, 9, 30),
        "sensitivity": "STANDARD",
    }  # fmt: skip
    fields.update(change)
    return Spec(**fields)


@pytest.mark.parametrize(
    ("a", "b", "verdict", "words"),
    [
        ({}, {}, "IDENTICAL", ""),
        ({"units": ["u-uk"]}, {"units": ["u-us"]}, "INCOMPATIBLE", "operating units"),
        # Entity isolation decides first, before anything else could match.
        ({"units": ["u-uk"], "sample": True}, {"units": []}, "INCOMPATIBLE", "operating units"),
        ({"sample": True}, {}, "INCOMPATIBLE", "sample"),
        # Evidence whose sensitivity is not established is never shared.
        ({"sensitivity": "UNKNOWN"}, {}, "INCOMPATIBLE", "sensitivity not established"),
        ({"sensitivity": "UNKNOWN"}, {"sensitivity": "UNKNOWN"}, "INCOMPATIBLE",
         "sensitivity not established"),
        ({"sensitivity": "PERSONAL"}, {}, "INCOMPATIBLE", "different sensitivity"),
        ({"kind": None}, {}, "INCOMPATIBLE", "catalog"),
        ({"kind": "CONTROL_SPECIFIC"}, {"kind": "CONTROL_SPECIFIC"}, "INCOMPATIBLE", "one control"),
        ({"kind": "HR_LEAVERS", "level": "ORGANIZATION", "system": None}, {}, "INCOMPATIBLE",
         "kinds"),
        ({"system": "ad"}, {}, "INCOMPATIBLE", "systems"),
        ({"identity": {"selection": "releases"}}, {}, "DIFFERENCES", "selection"),
        ({"period_start": date(2026, 8, 1)}, {}, "DIFFERENCES", "periods"),
        ({"period_start": date(2026, 10, 1), "period_end": date(2026, 12, 31)}, {},
         "INCOMPATIBLE", "overlap"),
        ({"kind": "CHANGE_RIGHTS", "period_type": "AS_OF", "as_of": date(2026, 9, 30)},
         {"kind": "CHANGE_RIGHTS", "period_type": "AS_OF", "as_of": date(2026, 12, 31)},
         "INCOMPATIBLE", "dates"),
        ({"kind": "POLICY_DOCUMENT", "level": "ORGANIZATION", "system": None,
          "identity": {"document": "ac01-e1"}},
         {"kind": "POLICY_DOCUMENT", "level": "ORGANIZATION", "system": None,
          "identity": {"document": "ac02-e1"}}, "INCOMPATIBLE", "policy"),
    ],
)  # fmt: skip
def test_two_requirements_share_an_artifact_only_by_the_rules(
    a: dict[str, Any], b: dict[str, Any], verdict: str, words: str
) -> None:
    found = compatibility(_spec(**a), _spec(**b))
    assert found.verdict == verdict
    assert words in " ".join(found.reasons + found.differences)
    # The same either way round.
    assert compatibility(_spec(**b), _spec(**a)).verdict == verdict


# Delivery grouping


def _row(n: int, **change: Any) -> Row:
    fields: dict[str, Any] = {
        "requirement_id": UUID(int=n), "version": 1,
        "updated_at": datetime(2026, 10, 24, tzinfo=UTC), "phase": "INTERIM",
        "title": f"Item {n}", "categories": ["PROCESS_DOCUMENTATION"],
        "control_id": UUID(int=1000 + n % 12), "control_ref": f"AC-{n % 12:02d}",
        "domain": "ACCESS", "application": "SAP ERP", "request_id": None,
        "request_status": None, "recipient": "owner@example.com",
        "recipient_basis": "CONTROL_OWNER", "due": None, "plan_revision": 1,
        "spec": _spec(kind="CONTROL_SPECIFIC", level="CONTROL"), "spec_hash": "0" * 64,
    }  # fmt: skip
    fields.update(change)
    return Row(**fields)


def test_requests_are_grouped_into_tasks_one_person_can_follow() -> None:
    systems = ["SAP ERP", "Microsoft Active Directory", "AWS IAM"]
    # One owner, one family, three systems, 60 items: never one giant request.
    many = [_row(n, application=systems[n % 3]) for n in range(60)]
    found = packages(many)
    assert sorted(p.items for p in found) == [20, 20, 20]
    assert all(len(p.sections) == 1 for p in found)
    # Small enough to read as one: kept together, with sections per system.
    few = packages([_row(n, application=systems[n % 3]) for n in range(9)])
    assert len(few) == 1 and few[0].sections == sorted(systems) and few[0].items == 9
    # Nobody named: one request to assign per system, never one per provider role.
    unnamed = [
        _row(n, recipient=f"Not yet assigned: {systems[n % 2]}", recipient_basis="PROVIDER_ROLE")
        for n in range(8)
    ]
    assert sorted((p.recipient, p.items) for p in packages(unnamed)) == [
        ("Not yet assigned: Microsoft Active Directory", 4),
        ("Not yet assigned: SAP ERP", 4),
    ]
    # Personal data travels on its own; samples and populations are their own tasks.
    mixed = [
        _row(1),
        _row(2, spec=_spec(kind="HR_LEAVERS", level="ORGANIZATION", system=None,
                           sensitivity="PERSONAL")),
        _row(3, categories=["SAMPLE", "CONTROL_EXECUTION"]),
        _row(4, categories=["POPULATION"]),
    ]  # fmt: skip
    assert sorted((p.workflow, p.sensitivity) for p in packages(mixed)) == [
        ("documents", "PERSONAL"), ("documents", "STANDARD"), ("populations", "STANDARD"),
        ("samples", "STANDARD"),
    ]  # fmt: skip
    # Evidence of unknown sensitivity is never grouped with other evidence, and no request
    # without a known recipient and a known sensitivity is sendable.
    custom = packages([_row(1), _row(2, spec=_spec(kind=None, sensitivity="UNKNOWN"))])
    assert sorted((p.sensitivity, p.items, p.sendable) for p in custom) == [
        ("STANDARD", 1, True), ("UNKNOWN", 1, False),
    ]  # fmt: skip
    assert all(not p.sendable and p.recipient_status == "UNASSIGNED" for p in packages(unnamed))
    # Confirmed only from a request's recipient; a control's recorded owner is a suggestion.
    statuses = {p.recipient_status for p in packages(
        [_row(1, recipient_basis="REQUEST"), _row(2, recipient="o@example.com")])}  # fmt: skip
    assert statuses == {"CONFIRMED", "SUGGESTED"}
    # One person's request mixing confirmed and suggested items is still to be confirmed.
    mixed_basis = packages([_row(1, recipient_basis="REQUEST"), _row(2)])
    assert [p.recipient_status for p in mixed_basis] == ["SUGGESTED"]
    assert packages([_row(1, recipient_basis="REQUEST")])[0].recipient_status == "CONFIRMED"
    assert packages([_row(1)])[0].recipient_status == "SUGGESTED"
    # Due dates weeks apart are two tasks; the earliest heads each.
    dated = [_row(1, due=date(2026, 11, 2)), _row(2, due=date(2026, 11, 6)),
             _row(3, due=date(2026, 12, 15))]  # fmt: skip
    assert sorted(p.due for p in packages(dated) if p.due) == [
        date(2026, 11, 2),
        date(2026, 12, 15),
    ]


# The analysis


_TABLES = ("evidence_requirements", "pbc_requests", "evidence_files", "evidence_matches",
           "plan_decisions", "approvals", "control_tests")  # fmt: skip


def _fingerprint(connection: psycopg.Connection[Any], project: Any) -> dict[str, Any]:
    prints = {}
    for table in _TABLES:
        prints[table] = connection.execute(
            f"SELECT count(*), md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) "
            f"FROM {table} t WHERE t.project_id = %s",
            (project,),
        ).fetchone()
    return prints


def test_the_analysis_reads_the_engagement_and_changes_nothing_else(migrated: Database) -> None:
    team, client = _engagement(migrated, "consolidation", ["Microsoft Active Directory"],
                               business=True)  # fmt: skip
    base = _base(team)
    # A business control split by entity (Release 1): its entities are never grouped.
    process = next(f for f in _families(client, team).values()
                   if "BUSINESS_PROCESS" in f["classifications"])  # fmt: skip
    units = {}
    for name in ("Acme UK Ltd", "Acme US Inc."):
        added = client.post(f"{base}/scope-units", json={"kind": "ENTITY", "name": name})
        units = {unit["name"]: unit["id"] for unit in added.json()}
    split = client.post(
        f"{base}/controls/{process['implementations'][0]['control_id']}/split",
        json={"unit_ids": list(units.values()),
              "reason": "Each entity's finance team reconciles on its own ledger."},
    )  # fmt: skip
    assert split.status_code == 200, split.text
    assert client.get(f"{base}/evidence-consolidation/analyses/latest").status_code == 404
    # A control taken out of scope has no specification and does not make the run stale.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_controls SET included = false WHERE id = "
            "(SELECT id FROM engagement_controls WHERE project_id = %s "
            "AND control_ref LIKE 'ITGC-OP-%%' ORDER BY id LIMIT 1)",
            (team["project"],),
        )

    with connect(migrated.url) as connection:
        before = _fingerprint(connection, team["project"])
    run = client.post(f"{base}/evidence-consolidation/analyses")
    assert run.status_code == 200, run.text
    body = run.json()
    with connect(migrated.url) as connection:
        after = _fingerprint(connection, team["project"])
        specs = connection.execute(
            """
            SELECT s.kind, s.spec, c.control_ref, c.implementation_key, r.version,
                   s.requirement_version, s.spec_hash
            FROM evidence_specifications s
            JOIN evidence_requirements r ON r.id = s.requirement_id
            JOIN engagement_controls c ON c.id = r.engagement_control_id
            WHERE s.project_id = %s
            """,
            (team["project"],),
        ).fetchall()
        live = connection.execute(
            "SELECT count(*) FROM evidence_requirements r JOIN engagement_controls c "
            "ON c.id = r.engagement_control_id WHERE r.project_id = %s "
            "AND r.status <> 'WAIVED' AND c.included",
            (team["project"],),
        ).fetchone()
    # Read-only: no requirement, request, file, filing, decision, approval, or test changed.
    assert before == after
    summary = body["summary"]
    # Every requirement has its specification, at its own version.
    assert live is not None and len(specs) == live[0] == summary["requirements"] > 0
    assert all(row[4] == row[5] for row in specs)
    assert summary["specifications_changed"] == len(specs)
    # Delivery grouping never makes more requests than today's.
    assert 0 < summary["requests_proposed"] <= summary["requests_today"]
    # The same control's policy on SAP and AD is one artifact; split entities never are.
    identical = [g for g in body["shares"] if g["verdict"] == "IDENTICAL"]
    assert any(g["kind"] == "POLICY_DOCUMENT" and g["requirements"] >= 2 for g in identical)
    ref = process["control_ref"]
    assert not any(ref in g["controls"] for g in body["shares"]), "split entities shared"
    entity_specs = [row for row in specs if row[2] == ref]
    assert {tuple(row[1]["units"]) for row in entity_specs} == {
        (units["Acme UK Ltd"],),
        (units["Acme US Inc."],),
    }
    # Samples are never offered for sharing: what the analysis counts as identical is
    # exactly the shareable, non-sample specifications that repeat.
    assert any(row[1]["sample"] for row in specs), "the engagement has sample items"
    shareable = Counter(
        row[6] for row in specs if row[0] not in (None, "CONTROL_SPECIFIC") and not row[1]["sample"]
    )
    assert summary["identical_requirements"] == sum(n for n in shareable.values() if n > 1)
    # A run cannot be changed, and the latest says when a requirement moved since.
    latest = client.get(f"{base}/evidence-consolidation/analyses/latest")
    assert latest.status_code == 200 and latest.json()["id"] == body["id"]
    assert latest.json()["stale"] is False
    # Each group a person could reconcile is listed once, with every difference named.
    differing = [g for g in body["shares"] if g["verdict"] == "DIFFERENCES"]
    assert differing and all(g["sources"] and g["phases"] for g in differing)
    where = {(g["kind"], tuple(g["controls"]), tuple(g["sources"]), tuple(g["phases"]))
             for g in differing}  # fmt: skip
    assert len(where) == len(differing)
    with connect(migrated.url) as connection, pytest.raises(psycopg.errors.RaiseException):
        connection.execute(
            "UPDATE evidence_consolidation_analyses SET summary = '{}' WHERE id = %s",
            (body["id"],),
        )

    def edit(sql: str) -> None:
        with connect(migrated.url) as connection:
            connection.execute(
                sql + " WHERE id = (SELECT s.requirement_id FROM evidence_specifications s "
                "JOIN evidence_requirements r ON r.id = s.requirement_id "
                "WHERE s.project_id = %s AND s.kind = 'POLICY_DOCUMENT' "
                "AND r.period_end IS NOT NULL ORDER BY s.requirement_id LIMIT 1)",
                (team["project"],),
            )

    def latest_stale() -> bool:
        found = client.get(f"{base}/evidence-consolidation/analyses/latest").json()
        return bool(found["stale"])

    # Wording is not what the artifact is: the specification is refreshed, not changed.
    edit("UPDATE evidence_requirements SET title = title || ' '")
    assert latest_stale() is True
    reworded = client.post(f"{base}/evidence-consolidation/analyses").json()
    assert reworded["summary"]["specifications_changed"] == 0
    assert latest_stale() is False
    # A different period is: the specification changes, and its group with it.
    edit("UPDATE evidence_requirements SET period_end = period_end - 1")
    assert latest_stale() is True
    moved = client.post(f"{base}/evidence-consolidation/analyses").json()
    assert moved["summary"]["specifications_changed"] == 1
    assert latest_stale() is False

    # Requests are generated and approved only from specifications computed against the
    # current, approved revision of their plan: anything else fails safely (R2b's gate).
    family = next(f for f in _families(client, team).values() if f["group"] == "TOGETHER")
    with connect(migrated.url) as connection:
        ids = [
            UUID(str(row[0]))
            for row in connection.execute(
                "SELECT r.id FROM evidence_requirements r JOIN engagement_controls c "
                "ON c.id = r.engagement_control_id WHERE r.project_id = %s "
                "AND c.control_ref = %s AND r.status <> 'WAIVED'",
                (team["project"], family["control_ref"]),
            ).fetchall()
        ]
        assert ids and set(staleness(connection, team["project"], ids).values()) == {
            "PLAN_NOT_APPROVED"
        }
        with pytest.raises(SpecificationStale, match="plan not approved"):
            require_fresh(connection, team["project"], ids)
    assert _approve(client, team, family).status_code == 200
    assert client.post(f"{base}/evidence-consolidation/analyses").status_code == 200
    with connect(migrated.url) as connection:
        require_fresh(connection, team["project"], ids)
        connection.execute(
            # As a reviewer's request for changes does: a new revision, no longer approved.
            "UPDATE evidence_plans SET revision = revision + 1, status = 'CHANGES_REQUESTED' "
            "WHERE engagement_control_id IN "
            "(SELECT id FROM engagement_controls WHERE project_id = %s AND control_ref = %s)",
            (team["project"], family["control_ref"]),
        )
        assert set(staleness(connection, team["project"], ids).values()) == {"PLAN_REVISED"}
        with pytest.raises(SpecificationStale, match="plan revised"):
            require_fresh(connection, team["project"], ids)
        connection.rollback()

    # Another firm's member sees nothing and runs nothing here.
    other = _new_engagement(migrated, "consolidation-other")
    outsider = _client(migrated, other["owner_id"], _Scheduler())
    assert outsider.get(f"{base}/evidence-consolidation/analyses/latest").status_code in (403, 404)
    assert outsider.post(f"{base}/evidence-consolidation/analyses").status_code in (403, 404)
