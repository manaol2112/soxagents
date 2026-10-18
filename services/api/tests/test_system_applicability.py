"""The system applicability wizard (Milestone 8.10).

The agent recommends which controls apply to a system and whether a SOC 1 report is
relevant; an uploaded SOC 1 report gives the CUECs, each found in the report's text. Every
answer is checked before it is kept, and nothing joins or leaves scope until a person
saves the selection.
"""

from typing import Any
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from support import Database
from test_execution import _add_project_member, _add_user, _ready
from test_onboarding import _base, _new_engagement
from test_outbound import _session, migrated

from ai_workforce_api.db import connect
from ai_workforce_api.models import ModelConfig, ModelRaw, ModelRequest
from ai_workforce_api.system_applicability import check_report
from ai_workforce_api.system_scoping import gather, run_review

__all__ = ["migrated"]

ITGC = ["ACCESS", "CHANGE", "OPERATIONS"]


class _Scripted:
    """A model that answers in turn, with the pages a web search 'returned'."""

    def __init__(
        self,
        outputs: list[dict[str, Any] | None],
        sources: tuple[tuple[str, str], ...] = (),
    ) -> None:
        self.outputs = outputs
        self.sources = sources
        self.requests: list[ModelRequest] = []

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        del config
        self.requests.append(request)
        output = self.outputs[min(len(self.requests), len(self.outputs)) - 1]
        searched = request.web_search > 0
        return ModelRaw(output, (), 900, 300,
                        sources=self.sources if searched else (), searched=searched)  # fmt: skip


def _setup(
    database: Database, name: str = "Workday"
) -> tuple[TestClient, str, str, dict[str, Any]]:
    team = _new_engagement(database, "wizard")
    owner, base = team["owner"], _base(team["org"], team["project"])
    with connect(database.url) as connection:
        connection.execute(
            "UPDATE engagement_settings SET client_name = 'Raul Corp' WHERE project_id = %s",
            (team["project"],),
        )
    added = owner.post(f"{base}/applications/known", json={"names": [name]})
    assert added.status_code == 200, added.text
    owner.post(f"{base}/controls/load-library", json={"domains": ITGC})
    system = next(a for a in owner.get(base).json()["applications"] if a["name"] == name)
    return owner, base, system["id"], team


def _system(owner: TestClient, base: str, system_id: str) -> dict[str, Any]:
    found: dict[str, Any] = next(
        a for a in owner.get(base).json()["applications"] if a["id"] == system_id
    )
    return found


def _wand(database: Database, owner: TestClient, base: str, system_id: str,
          provider: Any = None) -> dict[str, Any]:  # fmt: skip
    """The magic wand: ask for the assessment, and run it."""
    asked = owner.post(f"{base}/systems/{system_id}/review")
    assert asked.status_code == 200, asked.text
    with connect(database.url) as connection:
        assert run_review(connection, provider, UUID(system_id)) == "DONE"
    return _system(owner, base, system_id)


def _answer(candidates: list[str], **overrides: Any) -> dict[str, Any]:
    answer: dict[str, Any] = {
        "summary": "Workday is a SaaS HR system the client configures.",
        "hosting": "SAAS",
        "hosting_basis": "Workday runs its service for all customers.",
        "soc_status": "RELEVANT",
        "soc_availability": "STATED_AVAILABLE",
        "soc_provider": "Workday, Inc.",
        "soc_basis": "Payroll data processed in Workday feeds the ledger.",
        "soc_sources": [
            {"url": "https://www.workday.com/en-us/why-workday/trust/compliance.html",
             "title": "Compliance"},
            {"url": "https://made-up.example/soc1", "title": "Not returned"},
        ],
        "assumptions": ["Payroll is processed in Workday."],
        "questions": [],
        "controls": [
            {"control_ref": ref, "status": "RECOMMENDED", "rationale": f"{ref} applies.",
             "support": "System details", "missing": "", "confidence": "HIGH"}
            for ref in candidates
        ]
        + [{"control_ref": "NOT-A-CONTROL", "status": "RECOMMENDED", "rationale": "x"}],
    }  # fmt: skip
    answer.update(overrides)
    return answer


# Adding a system and the magic wand


def test_adding_a_system_asks_nothing_and_runs_nothing_until_the_wand(
    migrated: Database,
) -> None:
    owner, base, system_id, _team = _setup(migrated)
    system = _system(owner, base, system_id)
    # No hosting or SOC question, no generic CUECs, and the agent has not run.
    assert system["assessment"]["status"] == "IDLE"
    assert system["assessment"]["source"] == "NONE"
    assert all(c["status"] is None for c in system["assessment"]["candidates"])
    assert system["review"]["cuecs"] == []
    assert system["soc_reports"] == []
    details = owner.patch(
        f"{base}/systems/{system_id}/details",
        json={"description": "HR and payroll", "purpose": "Pays employees",
              "processes": "Hire to retire", "owner": "HR Director"},
    )  # fmt: skip
    assert details.status_code == 200, details.text
    system = _system(owner, base, system_id)
    assert (system["purpose"], system["owner"]) == ("Pays employees", "HR Director")
    in_scope = [c["control_ref"] for c in system["assessment"]["candidates"] if c["in_scope"]]
    # Without a model, the reviewed rules stand in and say how little they know.
    system = _wand(migrated, owner, base, system_id)
    assessment = system["assessment"]
    assert assessment["source"] == "RULES" and assessment["soc_status"] == "UNDETERMINED"
    assert assessment["soc_availability"] == "NOT_RESEARCHED"
    calls = {c["control_ref"]: c for c in assessment["candidates"]}
    assert calls["ITGC-AC-01"]["status"] == "RECOMMENDED"
    assert {c["status"] for c in calls.values()} <= {"RECOMMENDED", "POTENTIAL", "JUDGMENT"}
    # A recommendation changes no scope.
    after = [c["control_ref"] for c in assessment["candidates"] if c["in_scope"]]
    assert after == in_scope


def test_the_agent_recommends_and_cites_only_what_its_search_returned(
    migrated: Database,
) -> None:
    owner, base, system_id, _team = _setup(migrated)
    with connect(migrated.url) as connection:
        facts = gather(connection, UUID(system_id))
    assert facts is not None
    refs = [c.control_ref for c in facts.candidates]
    agent = _Scripted(
        [_answer(refs[:-1])],
        sources=(("https://www.workday.com/en-us/why-workday/trust/compliance.html",
                  "Compliance"),),
    )  # fmt: skip
    system = _wand(migrated, owner, base, system_id, agent)
    request = agent.requests[0]
    assert request.web_search == 3
    # The client's name never goes to the model the searches start from.
    assert "Raul Corp" not in request.prompt and "Workday" in request.prompt
    assessment = system["assessment"]
    assert assessment["source"] == "AGENT"
    assert (assessment["soc_status"], assessment["soc_availability"]) == (
        "RELEVANT", "STATED_AVAILABLE",
    )  # fmt: skip
    assert [s["url"] for s in assessment["soc_sources"]] == [
        "https://www.workday.com/en-us/why-workday/trust/compliance.html"
    ]
    calls = {c["control_ref"]: c for c in assessment["candidates"]}
    assert "NOT-A-CONTROL" not in calls
    assert calls[refs[0]]["status"] == "RECOMMENDED" and calls[refs[0]]["confidence"] == "HIGH"
    # A control the agent skipped is left for a person.
    assert calls[refs[-1]]["status"] == "JUDGMENT"
    # Claimed availability with no page the search returned is not relied on.
    unsourced = _Scripted([_answer(refs, soc_sources=[])], sources=())
    system = _wand(migrated, owner, base, system_id, unsourced)
    assert system["assessment"]["soc_availability"] == "NOT_RESEARCHED"
    assert "cited no page" in system["assessment"]["note"]


def test_the_team_saves_the_selection_beside_the_recommendations(migrated: Database) -> None:
    owner, base, system_id, _team = _setup(migrated)
    with connect(migrated.url) as connection:
        facts = gather(connection, UUID(system_id))
    assert facts is not None
    refs = [c.control_ref for c in facts.candidates]
    answer = _answer(refs)
    answer["controls"][1]["status"] = "NOT_RECOMMENDED"
    _wand(migrated, owner, base, system_id, _Scripted([answer]))
    url = f"{base}/systems/{system_id}/applicability"
    # Leaving out a recommended control needs a reason.
    refused = owner.put(url, json={"selections": [{"control_ref": refs[0], "selected": False}]})
    assert refused.status_code == 409
    assert refused.json()["detail"] == "say why a recommended control is not selected"
    assert owner.put(url, json={"selections": [
        {"control_ref": "NOPE", "selected": True}]}).status_code == 409  # fmt: skip
    saved = owner.put(url, json={"selections": [
        {"control_ref": refs[0], "selected": False, "note": "The vendor grants all access."},
        {"control_ref": refs[1], "selected": True},
    ]})  # fmt: skip
    assert saved.status_code == 200, saved.text
    system = next(a for a in saved.json()["applications"] if a["id"] == system_id)
    calls = {c["control_ref"]: c for c in system["assessment"]["candidates"]}
    assert (calls[refs[0]]["status"], calls[refs[0]]["decision"]) == (
        "RECOMMENDED", "NOT_SELECTED",
    )  # fmt: skip
    assert calls[refs[0]]["in_scope"] is False
    assert calls[refs[0]]["decision_note"] == "The vendor grants all access."
    assert (calls[refs[1]]["status"], calls[refs[1]]["decision"]) == (
        "NOT_RECOMMENDED", "SELECTED",
    )  # fmt: skip
    assert calls[refs[1]]["in_scope"] is True and system["assessment"]["decided"] is True
    with connect(migrated.url) as connection:
        audit = connection.execute(
            "SELECT payload FROM audit_events WHERE action = 'onboarding.system_applicability' "
            "ORDER BY created_at DESC LIMIT 1"
        ).fetchone()
    assert audit is not None
    assert set(audit[0]["against_recommendation"]) == {refs[0], refs[1]}
    # A new assessment keeps the team's decisions.
    _wand(migrated, owner, base, system_id, _Scripted([_answer(refs)]))
    calls = {c["control_ref"]: c for c in _system(owner, base, system_id)["assessment"][
        "candidates"]}  # fmt: skip
    assert calls[refs[0]]["decision"] == "NOT_SELECTED"


# SOC 1 reports

REPORT = (
    "[Page 1]\nIndependent Service Auditor's Report on Workday's description of its system "
    "for the period January 1, 2027 to September 30, 2027.\n"
    "[Page 2]\nIn our opinion, in all material respects, the description fairly presents "
    "the system that was designed and implemented.\n"
    "[Page 14]\nComplementary User Entity Controls. User entities are responsible for "
    "ensuring that access to the Workday tenant is approved by authorized personnel "
    "before it is granted.\n"
)


def _read(candidates: list[str]) -> dict[str, Any]:
    return {
        "report_kind": "SOC1",
        "service_organization": "Workday, Inc.",
        "report_type": "TYPE_2",
        "period_start": "2027-01-01",
        "period_end": "2027-09-30",
        "opinion": "UNQUALIFIED",
        "opinion_quote": "in all material respects, the description fairly presents the system",
        "scope": "Workday HCM and payroll.",
        "control_objectives": [],
        "exceptions": [],
        "subservice": [],
        "cuecs": [
            {"ref": "CUEC-1",
             "text": "Access to the tenant is approved before it is granted.",
             "quote": "access to the Workday tenant is approved by authorized personnel "
                      "before it is granted",
             "controls": [{"control_ref": candidates[0], "rationale": "Provisioning."}],
             "coverage": "FULL", "limitations": ""},
            {"ref": "CUEC-2", "text": "Backups are tested by the client.",
             "quote": "user entities must test restores of backups every quarter",
             "controls": [], "coverage": "NONE"},
        ],
    }  # fmt: skip


def test_report_wording_is_kept_only_where_it_is_found_and_placed_on_its_page() -> None:
    class _C:
        def __init__(self, ref: str) -> None:
            self.control_ref, self.library_key = ref, ref.lower()

    read = check_report(_read(["ITGC-AC-01"]), REPORT, [_C("ITGC-AC-01")])
    assert (read.opinion, read.opinion_page) == ("UNQUALIFIED", 2)
    assert [c.ref for c in read.cuecs] == ["CUEC-1"]
    assert read.cuecs[0].page == 14 and read.cuecs[0].status == "ADDRESSED"
    assert read.dropped == 1 and "could not be found" in read.note
    # A quote that is not in the report sinks the opinion too.
    wrong = _read(["ITGC-AC-01"]) | {"opinion_quote": "a clean opinion with no exceptions"}
    assert check_report(wrong, REPORT, [_C("ITGC-AC-01")]).opinion == "UNKNOWN"
    soc2 = check_report(_read(["ITGC-AC-01"]) | {"report_kind": "SOC2"}, REPORT, [])
    assert "not a substitute" in soc2.note and soc2.cuecs[0].controls == []


def test_an_uploaded_report_gives_the_cuecs_and_their_mapping(migrated: Database) -> None:
    owner, base, system_id, _team = _setup(migrated)
    with connect(migrated.url) as connection:
        facts = gather(connection, UUID(system_id))
    assert facts is not None
    refs = [c.control_ref for c in facts.candidates]
    uploaded = owner.post(
        f"{base}/systems/{system_id}/soc-reports/upload",
        params={"file_name": "Workday SOC 1 2027.txt"},
        content=REPORT.encode(),
        headers={"content-type": "text/plain"},
    )
    assert uploaded.status_code == 200, uploaded.text
    system = next(a for a in uploaded.json()["applications"] if a["id"] == system_id)
    assert system["soc_reports"][0]["status"] == "READING"
    assert system["assessment"]["status"] == "PENDING"
    agent = _Scripted([_read(refs), _answer(refs)])
    with connect(migrated.url) as connection:
        assert run_review(connection, agent, UUID(system_id)) == "DONE"
    # The report is read first, then the assessment sees its CUECs.
    assert "<report>" in agent.requests[0].prompt and agent.requests[0].web_search == 0
    assert "CUEC-1" in agent.requests[1].prompt
    report = _system(owner, base, system_id)["soc_reports"][0]
    assert (report["status"], report["report_type"], report["opinion"]) == (
        "READ", "TYPE_2", "UNQUALIFIED",
    )  # fmt: skip
    assert report["period_end"] == "2027-09-30"
    (cuec,) = report["cuecs"]
    assert (cuec["ref"], cuec["page"]) == ("CUEC-1", 14)
    assert cuec["controls"][0]["control_ref"] == refs[0]
    # Mapped to a control in scope for the system; taken out, it no longer addresses it.
    assert cuec["status"] == ("ADDRESSED" if cuec["controls"][0]["in_scope"] else "UNADDRESSED")
    owner.put(f"{base}/systems/{system_id}/applicability", json={"selections": [
        {"control_ref": refs[0], "selected": False, "note": "Tested elsewhere."}]})  # fmt: skip
    cuec = _system(owner, base, system_id)["soc_reports"][0]["cuecs"][0]
    assert cuec["status"] == "UNADDRESSED"
    removed = owner.post(f"{base}/systems/soc-reports/{report['id']}/remove")
    assert removed.status_code == 200, removed.text
    assert _system(owner, base, system_id)["soc_reports"] == []


def test_a_report_waits_for_a_model_and_uploads_are_checked(migrated: Database) -> None:
    owner, base, system_id, _team = _setup(migrated)
    url = f"{base}/systems/{system_id}/soc-reports/upload"
    assert owner.post(url, params={"file_name": "a.txt"}, content=b"").status_code == 422
    big = b"x" * (25 * 1024 * 1024 + 1)
    assert owner.post(url, params={"file_name": "a.txt"}, content=big).status_code == 413
    owner.post(url, params={"file_name": "r.txt"}, content=REPORT.encode(),
               headers={"content-type": "text/plain"})  # fmt: skip
    with connect(migrated.url) as connection:
        run_review(connection, None, UUID(system_id))
    report = _system(owner, base, system_id)["soc_reports"][0]
    assert report["status"] == "FAILED" and "model is needed" in report["note"]
    assert report["cuecs"] == []


def test_only_the_engagement_team_uses_the_wizard(migrated: Database) -> None:
    owner, base, system_id, team = _setup(migrated)
    with connect(migrated.url) as connection:
        reader_id = _add_user(
            connection, team["org"], f"reader-{uuid4().hex[:6]}@example.com", "REVIEWER"
        )
        _add_project_member(connection, team["org"], team["project"], reader_id)
    reader = _session(migrated, reader_id)
    body = {"selections": [{"control_ref": "ITGC-AC-01", "selected": False, "note": "x"}]}
    assert reader.put(f"{base}/systems/{system_id}/applicability", json=body).status_code == 403
    assert reader.post(f"{base}/systems/{system_id}/review").status_code == 403
    _other, _project, stranger = _ready(migrated, "stranger")
    assert stranger.patch(f"{base}/systems/{system_id}/details", json={}).status_code == 404
