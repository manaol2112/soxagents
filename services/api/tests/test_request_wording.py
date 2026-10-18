"""A request is never cut: every planned item goes out whole, and an email that cannot hold
the full wording carries every item in brief with the secure link to the full request."""

from datetime import date
from pathlib import Path
from uuid import UUID

from support import Database
from test_evidence_intake import _engagement
from test_evidence_plans import _control, _phase, _plan
from test_outbound import migrated
from test_pbc_drafting import _context

from ai_workforce_api import pbc_drafting
from ai_workforce_api.db import connect
from ai_workforce_api.evidence_plans import _Line
from ai_workforce_api.evidence_plans import render as plan_render
from ai_workforce_api.outbound import SUMMARY_NOTE, _read_pbc, render, request_summary
from ai_workforce_api.outbound import _engagement as engagement_name
from ai_workforce_api.pbc_drafting import (
    MAX_DESCRIPTION,
    DraftContent,
    DraftItem,
    PlannedItem,
    planned_draft,
)

_ = migrated


def _long(number: int) -> str:
    """A requirement's description at its full length, with the item's number in it."""
    sentence = f"Item {number} needs every user, role, approver, and date in the window. "
    return (sentence * 40)[:1500].rsplit(" ", 1)[0] + "."


def test_every_planned_item_goes_out_whole() -> None:
    planned = tuple(
        PlannedItem(f"Evidence item {n} for the window", _long(n), ("POPULATION",),
                    "REQUIRED", "1 January to 30 September 2027")
        for n in range(1, 15)
    )  # fmt: skip
    content = planned_draft(_context(phase="INTERIM", planned=planned))
    assert len(content.items) == 14
    text = pbc_drafting.render(content)
    for n in range(1, 15):
        # The whole description, not a clipped one.
        assert _long(n) in text
        assert f"{n}. Evidence item {n} for the window" in text
    assert "shortened" not in text


def test_the_longest_possible_request_fits_a_request() -> None:
    """The draft's own limits keep a request inside what the database holds."""
    item = DraftItem(
        kind="population", title="t" * 220, detail="d" * 1500, period="p" * 200,
        format="f" * 160, fields=["x" * 80] * 15, parameters="a" * 400,
        completeness="c" * 500,
    )  # fmt: skip
    content = DraftContent(
        summary="s" * 500, items=[item] * 14, questions=["q" * 300] * 5, assumptions=[]
    )
    assert len(pbc_drafting.render(content)) <= MAX_DESCRIPTION
    migration = Path(__file__).parents[3] / "migrations" / "0073_evidence_workspace.sql"
    assert f"BETWEEN 1 AND {MAX_DESCRIPTION}" in migration.read_text(encoding="utf-8")


def test_a_plan_request_keeps_every_requirement_whole() -> None:
    lines = [_Line(f"Requirement {n}", _long(n), "The interim window", "REQUIRED")
             for n in range(1, 15)]  # fmt: skip
    text = plan_render(
        "ITGC-AC-01", "New user access", "INTERIM", lines, (date(2027, 1, 1), date(2027, 9, 30))
    )
    for n in range(1, 15):
        assert _long(n) in text
    assert "shortened" not in text


def test_a_summary_lists_every_item_and_says_where_the_rest_is() -> None:
    description = "\n\n".join(
        ["Interim testing evidence for ITGC-AC-01.", "Please provide:"]
        + [f"{n}. Item {n}\n   {_long(n)}\n   Period: Q{n % 4 + 1} 2027" for n in range(1, 13)]
        + ["Please label each file with the number of the item it answers."]
    )
    summary = request_summary(description)
    assert summary.startswith("Interim testing evidence for ITGC-AC-01.\n\nPlease provide:")
    for n in range(1, 13):
        assert f"{n}. Item {n}\n   Period: Q{n % 4 + 1} 2027" in summary
        assert _long(n) not in summary
    assert summary.endswith(SUMMARY_NOTE)


def test_a_long_request_emails_a_summary_and_a_short_one_its_full_wording(
    migrated: Database,
) -> None:
    team, client, _scheduler = _engagement(migrated, "wording")
    control = _control(migrated, team, "ITGC-AC-01")
    request_id = _phase(_plan(client, team, control), "INTERIM")["requests"][0]["id"]
    long_text = "\n\n".join(
        ["Interim testing evidence for ITGC-AC-01."]
        + [f"{n}. Item {n}\n   {_long(n)}\n   Period: 2027" for n in range(1, 8)]
    )
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_requests SET evidence_description = %s, recipient = %s WHERE id = %s",
            (long_text, "dana@client.example", request_id),
        )
        connection.commit()
        pbc = _read_pbc(connection, team["org"], team["project"], UUID(request_id))
        engagement = engagement_name(connection, team["org"], team["project"])
    # The database keeps the full wording.
    assert pbc.evidence_description == long_text
    message = render(pbc, engagement)
    assert len(message.body) <= 4000
    for n in range(1, 8):
        assert f"{n}. Item {n}" in message.body
    assert SUMMARY_NOTE in message.body
    short = render(pbc.model_copy(update={"evidence_description": "1. The user listing."}),
                   engagement)  # fmt: skip
    assert "1. The user listing." in short.body and SUMMARY_NOTE not in short.body
