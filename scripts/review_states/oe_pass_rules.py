"""OE pass rules (oe-pass-rules, 20 November 2026): the states its design review needs.

Each on an engagement of its own, built with the test suite's helpers through the API as
the team would; the tester's and the reviewer agent's answers are scripted (no model), as
the suite scripts them. One record is changed directly, as the worker does it: a
re-performance that gave up (control_reviews.fail_reperformance, which durable.py calls).
Each state carries the session tokens of the people who view it (8 hours; synthetic users
of this database only).

- oe-sheet            the control's OE Testing step: an open test sheet whose first item's
                      first attribute is the tester's not applicable (a proposal a person
                      confirms with a reason of at least 10 characters), whose second
                      item's pass quotes a negated passage (left for a person), and whose
                      third item's pass rests on a date compared with a time on the same
                      day (not evaluated, left for a person)
- oe-review-partial   the control's Review step after a re-performance the model did for 1
                      of 3 items: the sign-off asks for the reviewer's record of
                      re-performing by hand
- oe-review-failed    the same after a later re-performance gave up: the review, the next
                      step and the queue say to re-perform, never to sign off
- oe-review-none      the Review step after a re-performance whose every model answer was
                      rejected (FALLBACK, 0 of 3 re-performed)
- oe-review-differs   the Review step after a full re-performance that found a difference
                      from the preparer's result (its note left proposed)
- oe-review-signed    the partial review signed off over the reviewer's record of
                      re-performing the rest by hand
- oe-review-signed-failed  the failed review (a later re-performance gave up after the
                      partial one) signed off over the reviewer's record by hand: no
                      failure banner, no "Re-perform", and the reviewer lane not stopped
"""

from typing import Any
from uuid import UUID

from seed_review_states import _token
from test_control_reviews import _all_pass, _prepared_control, _rollforward_decided
from test_evidence_analysis import _Provider
from test_evidence_intake import _accept_population, _engagement, _request
from test_testing_engine import _add, _base, _Citing, _read_all, _sheet, _year

from ai_workforce_api.control_reviews import fail_reperformance, run_reperformance
from ai_workforce_api.db import connect
from ai_workforce_api.testing_engine import run_sheet

NA_NOTE = "No access was granted to this user in the period, so no approval applies."


def _people(seed: Any, team: dict[str, Any]) -> dict[str, str]:
    return {
        "owner": _token(seed.url, team["owner_id"]),
        "reviewer": _token(seed.url, team["reviewer_id"]),
    }


def _granted(item: dict[str, Any]) -> str:
    for entry in item["detail"]:
        values = list(entry.values())
        if any("granted" in str(v).lower() for v in values):
            return str(values[-1])
    raise AssertionError(f"no grant date on {item['detail']}")


def _sheet_states(seed: Any) -> None:
    team, client, scheduler = _engagement(seed.database, "oe-sheet")
    base = _base(team)
    kickoff = _request(seed.database, team, "ITGC-AC-01")
    year = _year(seed.database, team)
    population = "User ID,Name,Date granted\n" + "".join(
        f"u000{n},Demo User {n},{year}-0{n}-10\n" for n in range(1, 4)
    )
    _add(client, team, "access population.csv", population, kickoff["id"])
    _read_all(seed.database, scheduler)
    plan = client.get(f"{base}/control-tests").json()[0]
    _accept_population(client, team, plan["engagement_control_id"])
    approved = client.post(
        f"{base}/control-tests/{plan['id']}/approve", json={"version": plan["version"]}
    ).json()
    sheet = _sheet(client, team)
    items = sheet["items"]
    assert len(items) == 3, items
    first, second, third = (item["label"] for item in items)
    granted = _granted(items[2])
    tickets = (
        f"Ticket T-0 for {first}: access request approved by Demo Manager.\n"
        f"Ticket T-1 for {second}: the access request was not approved by Demo Manager.\n"
        f"Ticket T-2 for {third}: access request approved by Demo Manager at {granted}T09:30.\n"
    )
    _add(client, team, "access tickets.txt", tickets, approved["sample_request_id"])
    _read_all(seed.database, scheduler)
    attributes = len(sheet["attributes"])
    rest = [
        {"index": i, "result": "PASS", "note": "Seen: the ticket shows the approval."}
        for i in range(1, attributes)
    ]
    answers = [
        {"results": [{"index": 0, "result": "NOT_APPLICABLE", "note": NA_NOTE}, *rest]},
        {
            "results": [
                {
                    "index": 0,
                    "result": "PASS",
                    "note": "Seen: the ticket names the approver.",
                    "citations": [
                        {"file": 0, "quote": "the access request was not approved by Demo Manager"}
                    ],
                },
                *rest,
            ]
        },
        {
            "results": [
                {
                    "index": 0,
                    "result": "PASS",
                    "note": "Seen: approved on the day access was granted.",
                    "checks": [
                        {
                            "kind": "on_or_before",
                            "left": {
                                "label": "Approved",
                                "value": f"{granted}T09:30",
                                "file": 0,
                                "quote": f"approved by Demo Manager at {granted}T09:30",
                            },
                            "right": {"label": "Date granted", "value": granted, "file": -1},
                        }
                    ],
                },
                *rest,
            ]
        },
    ]
    with connect(seed.url) as connection:
        run_sheet(connection, _Citing(answers), UUID(sheet["id"]))
    sheet = _sheet(client, team)
    cells = [item["cells"][0] for item in sheet["items"]]
    assert (cells[0]["proposed"], cells[0]["final"]) == ("NOT_APPLICABLE", "REVIEW"), cells[0]
    assert cells[1]["final"] in ("REVIEW", "UNABLE"), cells[1]
    assert cells[2]["final"] in ("REVIEW", "UNABLE"), cells[2]
    seed.add(
        "oe-sheet",
        seed.href(team, section="controls", control=sheet["control_id"], step="oetesting"),
        tokens=_people(seed, team),
        viewer="owner",
        labels=[first, second, third],
        finals=[cell["final"] for cell in cells],
        notes=[cell["note"] for cell in cells],
    )


def _reviewer(seed: Any, team: dict[str, Any]) -> Any:
    from test_control_reviews import _session as session

    return session(seed.database, team["reviewer_id"])


def _dismiss_proposed(seed: Any, team: dict[str, Any], client: Any, review_id: str) -> None:
    base = seed.base(team)
    reviewer = _reviewer(seed, team)
    review = next(r for r in client.get(f"{base}/reviews").json() if r["id"] == review_id)
    for note in review["notes"]:
        if note["status"] == "PROPOSED":
            decided = reviewer.post(
                f"{base}/reviews/{review_id}/notes/{note['id']}/decide",
                json={"version": review["version"], "action": "DISMISS",
                      "reason": "Reviewed against the tickets."},
            )  # fmt: skip
            assert decided.status_code == 200, decided.text
            review = decided.json()


REJECTED = {"results": [{"index": 99, "result": "PASS", "note": "x"}]}


def _reviewed(
    seed: Any, slug: str, answers: str = "partial", dismiss: bool = True
) -> tuple[dict[str, Any], Any, str, dict[str, Any]]:
    team, client, sheet, _file = _prepared_control(seed.database, slug, "DISMISS")
    control = sheet["control_id"]
    _rollforward_decided(seed.database, team, client, control)
    review = client.get(f"{seed.base(team)}/reviews").json()[0]
    attributes = len(sheet["attributes"])
    passing = _all_pass(attributes)
    differs = {
        "results": [
            {"index": 0, "result": "EXCEPTION", "note": "The approval is dated after access."}
        ]
        + passing["results"][1:]
    }
    scripted = {
        "partial": [passing, REJECTED, REJECTED],
        "none": [REJECTED, REJECTED, REJECTED],
        "differs": [differs, passing, passing],
    }[answers]
    with connect(seed.url) as connection:
        assert run_reperformance(connection, _Provider(scripted), UUID(review["id"])) == "DONE"
    if dismiss:
        _dismiss_proposed(seed, team, client, review["id"])
    review = client.get(f"{seed.base(team)}/reviews").json()[0]
    record = review["reperformance"]
    expected = {
        "partial": ("MODEL", 3, 1),
        "none": ("FALLBACK", 3, 0),
        "differs": ("MODEL", 3, 3),
    }[answers]
    assert (record["source"], record["due"], record["done"]) == expected, record
    assert review["attestation_needed"] is (answers != "differs"), review
    return team, client, control, review


def _add_review(seed: Any, name: str, team: dict[str, Any], control: str, review: Any) -> None:
    seed.add(
        name,
        seed.href(team, section="controls", control=control, step="review"),
        tokens=_people(seed, team),
        viewer="reviewer",
        overview=seed.href(team, section="overview", filter="all"),
        flow=seed.href(team, section="controls", control=control),
        blocking=review["blocking"],
    )


def _review_states(seed: Any) -> None:
    team, client, control, review = _reviewed(seed, "oe-partial")
    seed.add(
        "oe-review-partial",
        seed.href(team, section="controls", control=control, step="review"),
        tokens=_people(seed, team),
        viewer="reviewer",
        overview=seed.href(team, section="overview", filter="all"),
        flow=seed.href(team, section="controls", control=control),
        blocking=review["blocking"],
    )

    team, client, control, review = _reviewed(seed, "oe-failed")
    asked = _reviewer(seed, team).post(
        f"{seed.base(team)}/reviews/{review['id']}/reperform", json={"version": review["version"]}
    )
    assert asked.status_code == 200, asked.text
    with connect(seed.url) as connection:
        fail_reperformance(connection, UUID(review["id"]))
        connection.commit()
    review = client.get(f"{seed.base(team)}/reviews").json()[0]
    assert review["reperformance"]["failed"] is True, review["reperformance"]
    seed.add(
        "oe-review-failed",
        seed.href(team, section="controls", control=control, step="review"),
        tokens=_people(seed, team),
        viewer="reviewer",
        overview=seed.href(team, section="overview", filter="all"),
        flow=seed.href(team, section="controls", control=control),
        blocking=review["blocking"],
    )


def _more_review_states(seed: Any) -> None:
    team, _client, control, review = _reviewed(seed, "oe-none", "none")
    _add_review(seed, "oe-review-none", team, control, review)

    team, _client, control, review = _reviewed(seed, "oe-differs", "differs", dismiss=False)
    assert any(n["target"].get("reviewer_result") for n in review["notes"]), review["notes"]
    _add_review(seed, "oe-review-differs", team, control, review)

    team, client, control, review = _reviewed(seed, "oe-signed")
    signed = _reviewer(seed, team).post(
        f"{seed.base(team)}/reviews/{review['id']}/sign-off",
        json={
            "version": review["version"],
            "note": "Re-performed u0002 and u0003 by hand against the access tickets.",
            "reperformed_by_hand": True,
        },
    )
    assert signed.status_code == 200, signed.text
    review = client.get(f"{seed.base(team)}/reviews").json()[0]
    assert review["status"] == "SIGNED_OFF", review["status"]
    _add_review(seed, "oe-review-signed", team, control, review)

    team, client, control, review = _reviewed(seed, "oe-signed-failed")
    reviewer = _reviewer(seed, team)
    asked = reviewer.post(
        f"{seed.base(team)}/reviews/{review['id']}/reperform", json={"version": review["version"]}
    )
    assert asked.status_code == 200, asked.text
    with connect(seed.url) as connection:
        fail_reperformance(connection, UUID(review["id"]))
        connection.commit()
    review = client.get(f"{seed.base(team)}/reviews").json()[0]
    assert review["reperformance"]["failed"] is True, review["reperformance"]
    signed = reviewer.post(
        f"{seed.base(team)}/reviews/{review['id']}/sign-off",
        json={
            "version": review["version"],
            "note": "Re-performed u0001 to u0003 by hand against the access tickets.",
            "reperformed_by_hand": True,
        },
    )
    assert signed.status_code == 200, signed.text
    review = client.get(f"{seed.base(team)}/reviews").json()[0]
    assert review["status"] == "SIGNED_OFF" and review["failure_note"] == "", review
    _add_review(seed, "oe-review-signed-failed", team, control, review)


def build(seed: Any) -> None:
    _sheet_states(seed)
    _review_states(seed)
    _more_review_states(seed)
