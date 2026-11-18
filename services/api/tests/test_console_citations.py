"""Citations in the agent's answers: checked against the file, or dropped."""

from typing import Any
from uuid import UUID, uuid4

from support import Database
from test_console import _reply, _Script
from test_evidence_analysis import _no_ocr
from test_evidence_intake import _base, _engagement, _request, _settings
from test_outbound import migrated

from ai_workforce_api.console import run_turn
from ai_workforce_api.console_citations import find_quote, location_of, unchecked_hidden
from ai_workforce_api.db import connect
from ai_workforce_api.evidence_analysis import run_analysis
from ai_workforce_api.settings import Settings

_ = migrated

POLICY = (
    "[Page 1]\nInformation Security Standard ISS-07\n"
    "[Page 2]\n4.1 Passwords must be at least 12 characters long.\n"
    "4.2 Accounts lock after five failed attempts for 30 minutes.\n"
)


def test_a_quote_is_found_loosely_and_placed_on_its_page() -> None:
    span = find_quote(POLICY, "passwords must be at least  12 characters")
    assert span is not None
    assert POLICY[span[0] : span[1]] == "Passwords must be at least 12 characters"
    assert location_of(POLICY, span[0]) == "Page 2"
    # Curly quotes and dashes fold to plain ones; words must match exactly.
    assert find_quote("It’s the admin’s job — weekly.", "it's the admin's job - weekly") is not None
    assert find_quote(POLICY, "Passwords must be at least 14 characters") is None
    assert find_quote(POLICY, "ab") is None
    assert location_of("## Sheet: Users\nu1,Ann", 20) == "Sheet Users"
    assert location_of("no markers here", 5) == ""


def test_an_answer_keeps_only_citations_the_file_supports(migrated: Database) -> None:
    team, client, scheduler = _engagement(migrated, "cite")
    request = _request(migrated, team, "ITGC-AC-05")
    added = client.post(
        f"{_base(team)}/evidence-uploads",
        params={"batch_id": str(uuid4()), "name": "ISS-07.txt", "request_id": request["id"]},
        content=POLICY.encode(),
        headers={"content-type": "text/plain"},
    )
    assert added.status_code == 200, added.text
    file_id = added.json()["file_id"]
    with connect(migrated.url) as connection:
        for analysis_id in scheduler.analyses:
            run_analysis(connection, _settings(migrated), None, analysis_id, _no_ocr)
    asked = client.post(
        f"{_base(team)}/console/messages", json={"text": "What does the policy require?"}
    )
    assert asked.status_code == 200, asked.text
    message_id = UUID(asked.json()["messages"][-1]["id"])
    answer = (
        f'Passwords need 12 characters [cite:{file_id} "Passwords must be at least 12 '
        f'characters long"]. Lockout is after five attempts [cite:{file_id} "lock after five '
        f'failed attempts"]. MFA is required [cite:{file_id} "MFA is required for all users"]. '
        f'Again, 12 characters [cite:{file_id} "passwords must be at least 12 characters long"]. '
        f'Another engagement\'s file [cite:{uuid4()} "anything at all"].'
    )
    with connect(migrated.url) as connection:
        run_turn(
            connection, Settings(database_url=migrated.url), _Script([_reply(answer)]), message_id
        )
    thread = client.get(f"{_base(team)}/console").json()
    agent: dict[str, Any] = thread["messages"][-1]
    # The invented quote and the unknown file are dropped; the repeat reuses its number.
    assert agent["content"] == (
        "Passwords need 12 characters [^1]. Lockout is after five attempts [^2]. "
        "MFA is required. Again, 12 characters [^1]. Another engagement's file."
    )
    citations = agent["citations"]
    assert [c["number"] for c in citations] == [1, 2]
    first = citations[0]
    assert first["evidence_file_id"] == file_id
    assert first["file_name"] == "ISS-07.txt"
    assert first["quote"] == "Passwords must be at least 12 characters long"
    assert first["location"] == "Page 2"
    assert "4.1" in first["before"]
    assert citations[1]["quote"] == "lock after five failed attempts"


def test_a_control_with_many_files_lists_every_one_to_the_agent(migrated: Database) -> None:
    # Seen live: full readings for seven files filled the tool result, and the agent
    # never saw the last files. Each file is now listed in brief; read_evidence has it all.
    from ai_workforce_api.authorization import Principal, PrincipalKind
    from ai_workforce_api.console_tools import (
        RESULT_CHARS,
        ToolContext,
        execute,
        parse,
        result_text,
    )

    team, client, scheduler = _engagement(migrated, "manyfiles")
    request = _request(migrated, team, "ITGC-AC-05")
    long_text = "Setting,Value\n" + "".join(f"Parameter {n},value {n}\n" for n in range(300))
    for number in range(30):
        added = client.post(
            f"{_base(team)}/evidence-uploads",
            params={
                "batch_id": str(uuid4()),
                "name": f"settings-{number:02d}.csv",
                "request_id": request["id"],
            },
            content=long_text.encode(),
            headers={"content-type": "text/csv"},
        )
        assert added.status_code == 200, added.text
    with connect(migrated.url) as connection:
        for analysis_id in scheduler.analyses:
            run_analysis(connection, _settings(migrated), None, analysis_id, _no_ocr)
        context = ToolContext(
            connection=connection,
            settings=_settings(migrated),
            principal=Principal(kind=PrincipalKind.USER, id=team["owner_id"]),
            organization_id=team["org"],
            project_id=team["project"],
        )
        tool, args = parse("get_control", {"control_ref": "ITGC-AC-05"})
        shown = execute(tool, args, context)
        assert len(shown["evidence_files"]) == 30
        assert len(result_text(shown)) < RESULT_CHARS
        first = shown["evidence_files"][0]
        tool, args = parse("read_evidence", {"evidence_file_id": first["evidence_file_id"]})
        full = execute(tool, args, context)
    assert full["reading"]["classification"]["kind"]
    assert "Parameter 0 | value 0" in full["text"]


def test_an_answer_keeps_what_the_agent_said_before_its_last_round(
    migrated: Database,
) -> None:
    # Seen live: the analysis came with a tool call, and only the closing line was kept.
    from test_console import _call

    team, client, _scheduler = _engagement(migrated, "rounds")
    asked = client.post(f"{_base(team)}/console/messages", json={"text": "Where is AC-05?"})
    message_id = UUID(asked.json()["messages"][-1]["id"])
    script = _Script(
        [
            _reply(
                "AC-05 is waiting on its owner.", _call("get_control", control_ref="ITGC-AC-05")
            ),
            _reply("I proposed no steps."),
        ]
    )
    with connect(migrated.url) as connection:
        run_turn(connection, Settings(database_url=migrated.url), script, message_id)
    agent = client.get(f"{_base(team)}/console").json()["messages"][-1]
    assert agent["content"] == "AC-05 is waiting on its owner.\n\nI proposed no steps."


def test_an_answer_being_written_hides_its_citations_until_they_are_checked() -> None:
    file = "11111111-1111-7111-8111-111111111111"
    whole = f'Lockout is five attempts [cite:{file} "locked after five attempts"].'
    assert unchecked_hidden(whole) == "Lockout is five attempts."
    # Part way through a marker, nothing of it shows: not the quote, not the file.
    for cut in (len("Lockout is five attempts ["), len("Lockout is five attempts [ci"), 40, 70):
        assert unchecked_hidden(whole[:cut]) == "Lockout is five attempts"
    # A marker the model got wrong is hidden as well; the check later drops it.
    assert unchecked_hidden('Length is 12 [cite:not-a-file "12"] long') == "Length is 12 long"
    # Ordinary brackets stay.
    assert unchecked_hidden("Rows [1-3] are sampled") == "Rows [1-3] are sampled"
