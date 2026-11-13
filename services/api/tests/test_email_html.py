"""The evidence request email's layout and wording (email_html.py, request_email.py),
with the real ITGC-AC-03 request as it went out before the redesign: item 2's own list
was unindented, so the layout read each of its lines as a request of its own."""

import re
from datetime import UTC, datetime
from uuid import UUID

from ai_workforce_api.email_html import to_html
from ai_workforce_api.evidence_portal import LINK_PLACEHOLDER
from ai_workforce_api.inbound import references
from ai_workforce_api.outbound import render
from ai_workforce_api.pbc import PbcBody
from ai_workforce_api.pbc_drafting import DraftContent, DraftItem, detail_lines
from ai_workforce_api.pbc_drafting import render as draft_render
from ai_workforce_api.request_email import (
    Facts,
    control_line,
    first_name,
    one_name,
    parse,
    subject,
)

# The real email, word for word (version 2), as it reached the owner.
CURRENT = (
    "Hello,\n"
    "\n"
    "The audit team for SOX FY2027 is requesting the evidence below.\n"
    "\n"
    "Request: PBC-0A3A48A8\n"
    "Control: ITGC-AC-03\n"
    "Due: 23 November 2026\n"
    "\n"
    "Evidence requested:\n"
    "We are documenting the design of the quarterly Active Directory user access "
    "review (ITGC-AC-03). We would be grateful if you could provide the two items "
    "below, or forward this to the person who performs the control.\n"
    "\n"
    "1. Access review policy and designated owners list\n"
    "   Please provide the access review policy or procedure that covers Active "
    "Directory, and the list of designated application owners (the people who sign "
    "off the review). This shows us how the review is defined and who is "
    "authorised to sign it off.\n"
    "   Period: The control as currently designed\n"
    "   Format: Documents as issued (PDF, Word or Excel)\n"
    "   Completeness: The current version of the policy or procedure, with its "
    "date or version, and the full list of designated application owners.\n"
    "\n"
    "2. One completed quarterly review, start to finish\n"
    "   Please provide one complete quarterly review, from any quarter in the "
    "period, with all of the following:\n"
    "1. The listing of all users and roles exported from Active Directory, with "
    "the export date.\n"
    "2. Evidence of the user count check against Active Directory.\n"
    "3. The marked listing showing the keep, remove or change decision for each "
    "user.\n"
    "4. The sign-offs of the Business process owner and the Application Owner, "
    "with dates.\n"
    "5. The tickets raised for the removals and changes requested.\n"
    "6. Active Directory evidence that those changes were made.\n"
    "7. Any investigation of inappropriate access, as recorded in the change "
    "ticket.\n"
    "If the quarter you choose had no inappropriate access, please tell us so and "
    "send the rest.\n"
    "   Period: The control as currently designed\n"
    "   Include: Export date of the listing; User count in Active Directory and on "
    "the listing; Keep/remove/change decision per user; Sign-off names and dates; "
    "Ticket numbers, closure dates; Active Directory change evidence\n"
    "   Format: Original files or screenshots/exports (Excel, PDF, ticket exports)\n"
    "   Completeness: All seven parts for the same single quarter, so that we can "
    "follow it from listing to completed changes.\n"
    "\n"
    "Upload the evidence through your secure link:\n"
    "[secure upload link, added when the request is sent]\n"
    "\n"
    "The link opens every open request the audit team has sent you for this "
    "engagement. When you open it, a one-time code is emailed to this address. "
    "Files sent as email attachments are not accepted as evidence.\n"
    "\n"
    "If you have a question, reply to this email and keep PBC-0A3A48A8 in the "
    "subject.\n"
    "\n"
    "Thank you."
)
CURRENT_SUBJECT = "[PBC-0A3A48A8] Evidence request: ITGC-AC-03"
DESCRIPTION = CURRENT.split("Evidence requested:\n", 1)[1].split("\n\nUpload the evidence", 1)[0]
URL = "https://portal.example/r/abc123"
_ITEM_CARD_V2 = "min-width:22px"
_ITEM_CARD_V3 = "width:24px;height:24px;line-height:24px;border-radius:6px"


def _pbc(description: str = DESCRIPTION) -> PbcBody:
    return PbcBody(
        id=UUID("01a1d313-e1be-7d83-8ca6-98db0a3a48a8"),
        project_id=UUID(int=1),
        operation_key="x" * 64,
        control_ref="ITGC-AC-03",
        owner_user_id=UUID(int=2),
        recipient="owner@client.example",
        due_at=datetime(2026, 11, 23, 17, tzinfo=UTC),
        evidence_description=description,
        status="DRAFT",
        outbound_message_id=None,
        thread_id="thread-1",
        first_response_at=None,
        received_at=None,
        attachment_refs=[],
        follow_up_after_days=3,
        max_follow_ups=3,
        escalation_state="NONE",
        cancellation_reason="",
        version=1,
        testing_phase="DESIGN",
        engagement_control_id=UUID(int=3),
    )


FACTS = Facts(
    control_title="Periodic User Access Review",
    control_line=control_line("Periodic User Access Review", "QUARTERLY", "Active Directory"),
    system="Active Directory",
    recipient_name="Joanna Rose Manaol",
)


def test_an_unindented_list_inside_an_item_is_read_as_part_of_that_item() -> None:
    wording = parse(DESCRIPTION)
    assert [item.number for item in wording.items] == [1, 2]
    second = wording.items[1]
    entries = [line for line in second.lines if line.startswith("- ")]
    assert len(entries) == 7 and entries[0].startswith("- The listing of all users")
    assert second.lines[8].startswith("If the quarter you choose")
    assert [second.lines[i].split(":")[0] for i in second.rows] == [
        "Covers", "Make sure it shows", "Format", "Complete when",
    ]  # fmt: skip
    # A list that goes on to the next item stays a list of items; a person's plain
    # numbered list is items, not one item's list.
    plain = parse("1. A listing\n2. A report\n\n3. A policy")
    assert [(i.number, i.title) for i in plain.items] == [
        (1, "A listing"), (2, "A report"), (3, "A policy"),
    ]  # fmt: skip


def _titles(description: str) -> list[tuple[int, str]]:
    return [(item.number, item.title) for item in parse(description).items]


def test_an_items_own_list_never_swallows_the_next_item() -> None:
    """The independent review's cases (13 November 2026): an item's own list goes on only
    within its paragraph, and a paragraph that starts with a number is a new item."""
    # An inner list with as many entries as the item's number, then the next item.
    swallowed = (
        "Intro.\n\n1. Policy\n   The policy.\n\n2. Change tickets\n   For each change "
        "provide:\n1. Approval\n2. Testing evidence\n\n3. Deployment log\n   Period: Q3\n\n"
        "4. Change listing\n   Period: FY"
    )
    assert _titles(swallowed) == [
        (1, "Policy"), (2, "Change tickets"), (3, "Deployment log"), (4, "Change listing"),
    ]  # fmt: skip
    assert parse(swallowed).items[1].lines == [
        "For each change provide:", "- Approval", "- Testing evidence",
    ]  # fmt: skip
    message = render(_pbc(swallowed), "SOX FY2027", FACTS)
    assert ": 4 items due " in message.subject
    # Seven entries inside item 1, then item 2.
    seven = "1. Review\n   All of:\n1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n\n2. Policy"
    assert _titles(seven) == [(1, "Review"), (2, "Policy")]
    # Two numbered sections: four items, and the heading between them stays where it is.
    parts = "Part one:\n\n1. A\n   detail a\n\n2. B\n   detail b\n\nPart two:\n\n1. C\n2. D"
    assert _titles(parts) == [(1, "A"), (2, "B"), (1, "C"), (2, "D")]
    body = render(_pbc(parts), "SOX FY2027", FACTS).body
    assert "2. B\n   detail b\n\nPart two:\n\n1. C\n\n2. D\n\nHOW TO SEND IT" in body
    # A sentence that wraps onto a line starting with a number stays in its item.
    assert _titles("1. A\n   see section\n3. of the policy\n2. B") == [(1, "A"), (2, "B")]
    # Line endings of any kind.
    assert _titles("Intro.\r1. A\r2. B") == [(1, "A"), (2, "B")]
    assert _titles("Intro.\r\n\r\n1. A\r\n   Period: Q1\r\n\r\n2. B") == [(1, "A"), (2, "B")]


AWKWARD = (
    DESCRIPTION,
    "1. A listing\n   Period: Q1\n\nQuestions for you:\n1. Who performs it?\n2. How often?",
    "1. A listing\n\nQuestions for you:\n- Who performs it?\n  (the owner or a delegate)\n"
    "- How often?",
    "1. A listing\n\nQuestions for you:\n\n- Who performs it?\n\nWhat tool is used?",
    "Intro.\n\n1. A\n   Period: Q1\n\nQuestions for you:\n- Who performs it?\n\n"
    "Please reply by Friday.\nKind regards, Dana",
    "1. A listing\n   Period: Q1\n   Note: the listing must be system-generated.\n   More text",
    "1. A\n   Period: Q1\n\nThank you.",
    "Part one:\n\n1. A\n   detail a\n\n2. B\n   detail b\n\nPart two:\n\n1. C\n2. D",
    "1.\n2. \n3. Real",
    "1. A\n   see section\n3. of the policy\n2. B",
    "Send the access list please.\n\nQuestions for you:\nWho owns it?\nAnd since when?",
    "Reference: see the prior-year file PY-22.\n\n1. A listing\n\n   A second paragraph.",
    "Intro.\n\n1. A\n   Period: Q1\n\nHOW TO SEND IT\n\nWHAT WE NEED\n\nBy post, please.",
)
_MARKER = re.compile(r"^\s*(?:\d{1,2}[.)]|[-•*])\s+")
_LABEL = re.compile(r"^(Period|Include|Format|Show|Completeness|If not available):\s*")


def test_no_line_of_the_wording_is_left_out_of_the_email() -> None:
    """Every non-empty line of the approved wording is in the plain text: its words, in
    their order (a list marker or a label may be written differently, never the words)."""
    for description in AWKWARD:
        body = render(_pbc(description), "SOX FY2027", FACTS).body
        text = " ".join(body.split()).lower()
        at = 0
        for line in description.replace("\r", "\n").split("\n"):
            words = _LABEL.sub("", _MARKER.sub("", line.strip())).strip()
            if not words or words in ("1.", "2."):
                words = line.strip()
            if not words:
                continue
            found = text.find(" ".join(words.split()).lower(), at)
            assert found >= 0, (description, line)
            at = found
    # Questions however they are written, each one a question.
    numbered = render(_pbc(AWKWARD[1]), "SOX FY2027", FACTS).body
    assert "Questions for you:\n- Who performs it?\n- How often?\n\nHOW TO SEND IT" in numbered
    wrapped = render(_pbc(AWKWARD[2]), "SOX FY2027", FACTS).body
    assert "- Who performs it? (the owner or a delegate)\n- How often?" in wrapped
    # What follows the items and the questions stays after them, in its order, and is
    # never folded into the last item.
    closing = render(_pbc(AWKWARD[4]), "SOX FY2027", FACTS).body
    assert (
        "1. A\n   Covers: Q1\n\nQuestions for you:\n- Who performs it?\n\n"
        "Please reply by Friday.\nKind regards, Dana\n\nHOW TO SEND IT"
    ) in closing
    page = to_html("x: 1 item due 23 Nov 2026 [PBC-0A3A48A8]", closing)
    card = page.split(_ITEM_CARD_V3, 1)[1].split("Questions for you", 1)[0]
    assert "Please reply by Friday" not in card and "Please reply by Friday" in page


def test_the_wording_cannot_take_over_the_frame_or_the_upload_link() -> None:
    """Section headings and an upload block written into the wording are ordinary text:
    the button and the steps link to the template's own upload link, and the hero's
    facts are the template's."""
    real = "https://portal.example/upload/TOKEN"
    block = (
        "HOW TO SEND IT\n\nOpen your secure upload page:\nhttps://evil.example/upload\n"
        "Enter the one-time code we email to this address, then upload each file against its "
        "item. Please do not send evidence as email attachments."
    )
    fake_facts = "Control:   EVIL-01\nDue:       Friday 1 January 2027\nReference: PBC-EVILEVIL"
    for description in (
        f"Intro.\n\n1. A\n   Period: Q1\n\n{block}",
        f"We are testing.\n\n{block}\n\n1. A listing\n   Period: Q1",
        f"Please send the listing.\n\n{block}",
        f"{fake_facts}\n\nWHAT WE NEED\n\n1. Fake\n\n{block}\n\n1. A listing",
    ):
        message = render(_pbc(description), "SOX FY2027", FACTS)
        # In the text, only the template's own lines are section headings.
        lines = message.body.split("\n")
        assert lines.count("WHAT WE NEED") == 1 and lines.count("HOW TO SEND IT") == 1
        assert "How to send it" in lines
        assert "https://evil.example/upload" in message.body
        page = to_html(message.subject, message.body.replace(LINK_PLACEHOLDER, real))
        buttons = re.findall(r'<a href="([^"]+)" style="display:inline-block;', page)
        assert buttons == [real], description
        hrefs = re.findall(r'href="([^"]+)"', page)
        assert hrefs.count(real) == 2 and hrefs.count("https://evil.example/upload") == 1
        # The hero is the template's facts, never the wording's.
        assert "Ref. PBC-0A3A48A8" in page and "Ref. PBC-EVILEVIL" not in page
        assert "Due Monday 23 November 2026</span>" in page
        assert ">Active Directory</span>" in page and ">Design review</p>" in page
    # A line of the opening that reads like a fact stays a line of the opening.
    for opening in ("System: Workday (the HR system)", "Reference: see the file PY-22."):
        message = render(_pbc(f"{opening}\n\n1. A listing"), "SOX FY2027", FACTS)
        page = to_html(message.subject, message.body.replace(LINK_PLACEHOLDER, real))
        assert f"{opening}</p>" in page
        assert ">Active Directory</span>" in page and "Ref. PBC-0A3A48A8" in page
        assert ">Workday (the HR system)</span>" not in page


def test_a_greeting_by_name_only_for_one_persons_name() -> None:
    cases = {
        "Joanna Rose Manaol": "Joanna",
        "Dr. Dana Lee": "Dana",
        "Mr John Smith": "John",
        "Prof Ann Wu": "Ann",
        "Dana Lee (contractor)": "Dana",
        "Jean-Luc Picard": "Jean-Luc",
        "Zoë Ångström": "Zoë",
        "Grace Hall": "Grace",
        "Mohammed bin Salman": "Mohammed",
        "Ana de la Cruz": "Ana",
        # Not a person's name of two words, first name first: no name in the greeting.
        "": "",
        "Dana": "",
        "Ms. Lee": "",
        "Lee, Dana": "",
        "de la Cruz, Ana": "",
        "Dana Lee, CISA": "",
        "LEE Dana": "",
        "J. Smith": "",
        "J Smith": "",
        "o'Brien": "",
        "李伟": "",
        "Dana Lee / Sam Ortiz": "",
        "Dana and Sam": "",
        "dana lee": "",
        "owner@client.example": "",
        # A role, a team or a mailbox.
        "Access administrator": "",
        "Treasury": "",
        "Procurement": "",
        "Legal": "",
        "Tax": "",
        "AP Shared Inbox": "",
        "Database Administration": "",
        "DBA": "",
        "Change Advisory Board": "",
        "SAP Basis": "",
        "Network": "",
        "Payables": "",
        "Receivables": "",
        "Sales Ops": "",
        "Cloud Platform": "",
        "Workday Support Team": "",
        "Will Owner": "",
        "Hanna Group": "",
    }
    assert {name: first_name(name) for name in cases} == cases
    # An address held under more than one name is a shared mailbox: no name.
    assert one_name(["Dana Lee"]) == "Dana Lee"
    assert one_name(["Dana Lee", "Dana  Lee", "Dana M Lee"]) == "Dana Lee"
    assert one_name(["Dana Lee", "Sam Ortiz"]) == ""
    assert one_name(["Dana Lee", "AP Shared Inbox"]) == ""
    assert one_name([]) == "" and one_name(["", " "]) == ""


def test_the_control_line_and_the_subject_keep_what_they_are_given() -> None:
    # The control's name keeps its own capitals: proper nouns and systems are not lowered.
    assert control_line("Periodic User Access Review", "QUARTERLY", "Active Directory") == (
        "Quarterly Active Directory User Access Review"
    )
    assert control_line("Review of Microsoft Azure Admins", "", "Azure") == (
        "Review of Microsoft Azure Admins"
    )
    assert control_line("SAP change management", "", "SAP") == "SAP change management"
    assert control_line("Review of the IPE Report", "ANNUAL", "") == (
        "Annual Review of the IPE Report"
    )
    # The subject never exceeds 200 characters: the references go first, then the title.
    due = datetime(2026, 11, 23, tzinfo=UTC)
    long_refs = ", ".join(["ITGC-" + "A" * 60] * 3)
    bounded = subject("SOX FY2027 audit", long_refs, 3, due, "PBC-0A3A48A8")
    assert bounded == "SOX FY2027 audit: 3 items due 23 Nov 2026 [PBC-0A3A48A8]"
    assert len(subject("T" * 400, "ITGC-AC-03", 3, due, "PBC-0A3A48A8")) <= 200
    assert references(subject("x [PBC-11111111]", "y]", 1, due, "PBC-0A3A48A8")) == ("0A3A48A8",)
    # A title that holds ": " is still read as the title.
    odd = render(_pbc(), "SOX FY2027", Facts(control_title="Access: review of users (quarterly)"))
    page = to_html(odd.subject, odd.body.replace(LINK_PLACEHOLDER, URL))
    assert "2 items needed for the Access: review of users (quarterly)</h1>" in page


def test_the_button_is_safe_in_outlook_and_in_dark_mode() -> None:
    message = render(_pbc(), "SOX FY2027", FACTS)
    page = to_html(message.subject, message.body.replace(LINK_PLACEHOLDER, URL))
    # The cell carries the colour and the padding; the link fills it.
    assert re.search(
        r'<td style="padding:12px 22px;border-radius:8px;background:#3b5bdb;" '
        rf'bgcolor="#3b5bdb"><a href="{re.escape(URL)}"',
        page,
    )
    # Outlook ignores max-width: a fixed-width wrapper, for it alone.
    assert '<!--[if mso]><table role="presentation" width="640"' in page
    assert page.count("<!--[if mso]>") == page.count("<![endif]-->") == 2
    assert "<style" not in page and "@media" not in page


def test_the_new_request_email_for_the_real_itgc_ac_03_text() -> None:
    message = render(_pbc(), "SOX FY2027", FACTS)
    assert message.subject == (
        "Periodic User Access Review (ITGC-AC-03): 2 items due 23 Nov 2026 [PBC-0A3A48A8]"
    )
    body = message.body
    assert body.startswith("Hello Joanna,\n\nWe are documenting the design")
    assert (
        "Control:   ITGC-AC-03, Quarterly Active Directory User Access Review\n"
        "System:    Active Directory\n"
        "Stage:     Design review\n"
        "Due:       Monday 23 November 2026\n"
        "Reference: PBC-0A3A48A8\n\nWHAT WE NEED\n\n1. Access review policy"
    ) in body
    assert "   - The listing of all users and roles exported from Active Directory" in body
    assert "\n1. The listing" not in body and "Period:" not in body
    assert "   Make sure it shows: Export date of the listing; User count" in body
    assert "   Complete when: All seven parts" in body
    assert body.count("attachments") == 1
    assert body.endswith(
        "Thank you,\nThe SOX FY2027 audit team\n\n"
        "Questions? Reply to this email and keep PBC-0A3A48A8 in the subject."
    )
    # Replies are still matched on the reference in the subject.
    assert references(message.subject) == ("0A3A48A8",)
    assert references(f"Re: {message.subject}") == ("0A3A48A8",)
    # Without a name on record, no name is made up.
    unnamed = render(_pbc(), "SOX FY2027", Facts(control_title="Periodic User Access Review"))
    assert unnamed.body.startswith("Hello,\n\n")


def test_the_new_layout_keeps_each_item_whole_and_every_word_escaped() -> None:
    message = render(_pbc(), "SOX FY2027", FACTS)
    page = to_html(message.subject, message.body.replace(LINK_PLACEHOLDER, URL))
    # Two items, two cards: item 2's seven parts are a checklist inside it.
    assert page.count(_ITEM_CARD_V3) == 2
    second = page.split("One completed quarterly review, start to finish", 1)[1]
    assert second.count("border:2px solid #9aa4b5") == 7
    for label in ("Covers", "Make sure it shows", "Format", "Complete when"):
        assert f">{label}</td>" in second
    assert ">Period<" not in page and ">Completeness<" not in page
    assert "Export date of the listing &middot; User count" in page
    # The frame: band, hero, button, the note, the steps, signature and footer.
    for text in (
        '<b style="color:#0b1220;font-weight:600;">SOX FY2027</b> · Audit evidence request',
        "Ref. PBC-0A3A48A8",
        ">Design review</p>",
        "2 items needed for the Periodic User Access Review</h1>",
        "ITGC-AC-03 · Quarterly Active Directory User Access Review",
        "Due Monday 23 November 2026</span>",
        ">Active Directory</span>",
        f'<a href="{URL}" style="display:inline-block;',
        ">Upload evidence</a>",
        "A one-time code is sent to this address when you open it.",
        "Hello Joanna,",
        "Enter the one-time code we email to this address.",
        "The SOX FY2027 audit team</b>",
        "Questions? Reply to this email and keep PBC-0A3A48A8 in the subject.",
        "You are receiving this because you are the contact for ITGC-AC-03 in the SOX "
        "FY2027 audit.",
        "We will never ask for your password or for access to a system by email.",
    ):
        assert text in page, text
    # The preheader, hidden.
    assert re.search(
        r'<div style="display:none;[^"]*">2 items for the SOX FY2027 audit, due Monday 23 '
        r"November 2026\. Upload them through your secure link\.",
        page,
    )
    # Every word is escaped; nothing in the text runs as markup.
    hostile = render(
        _pbc("Intro <script>alert(1)</script>.\n\n1. A <b>listing</b>\n   Period: <i>Q3</i>"),
        "SOX <img src=x>",
        Facts(control_title="Review <svg onload=x>", recipient_name="<Dana>"),
    )
    hostile_page = to_html(hostile.subject, hostile.body.replace(LINK_PLACEHOLDER, URL))
    for markup in ("<script>", "<b>listing", "<i>Q3", "<img src=x>", "<svg", "<Dana>"):
        assert markup not in hostile_page, markup
    assert "&lt;script&gt;" in hostile_page and "&lt;svg onload=x&gt;" in hostile_page
    # Safe in a mail client's dark mode: white text only where its own background is set.
    for style in re.findall(r'style="([^"]*color:#ffffff[^"]*)"', page):
        assert "background:" in style, style


def test_the_old_layout_keeps_the_real_items_inner_list_inside_it() -> None:
    """A message approved on version 2 keeps its layout; its item's unindented list (a
    draft saved before the fix) stays inside the item, with the item's labelled lines."""
    page = to_html(CURRENT_SUBJECT, CURRENT.replace(LINK_PLACEHOLDER, URL))
    # Old: nine cards (item 2 split into seven) and a run-on paragraph; now two.
    assert page.count(_ITEM_CARD_V2) == 2
    second = page.split("One completed quarterly review, start to finish", 1)[1]
    second = second.split("Upload the evidence through your secure link", 1)[0]
    assert second.count("<li") >= 7 + 6
    assert "The listing of all users and roles exported" in second
    assert "If the quarter you choose had no inappropriate access" in second
    for label in ("Period", "Include", "Format", "Completeness"):
        assert f">{label}</td>" in second
    assert "send the rest. Period:" not in page


def test_the_drafter_keeps_an_items_list_inside_the_item() -> None:
    detail = (
        "Please provide one complete quarterly review, with all of the following:\n"
        "1. The listing of all users.\n"
        "2) The sign-offs, with dates.\n"
        "\n"
        "• The tickets raised.\n"
        "If the quarter had no exceptions, please tell us so."
    )
    assert detail_lines(detail) == [
        "   Please provide one complete quarterly review, with all of the following:",
        "   - The listing of all users.",
        "   - The sign-offs, with dates.",
        "   - The tickets raised.",
        "   If the quarter had no exceptions, please tell us so.",
    ]
    text = draft_render(
        DraftContent(
            summary="We are documenting the design of the review.",
            items=[
                DraftItem(kind="policy", title="The policy", detail="The current policy."),
                DraftItem(kind="other", title="One review", detail=detail, period="Q3"),
            ],
        )
    )
    # Every line of the item is under it; no line of it starts a request item of its own.
    assert re.findall(r"^\d+\. .+$", text, re.MULTILINE) == ["1. The policy", "2. One review"]
    assert "   - The sign-offs, with dates.\n   - The tickets raised." in text
    # Read back, laid out, each item is whole.
    assert [len(i.lines) for i in parse(text).items] == [1, 6]
    page = to_html("x", text)
    assert page.count(_ITEM_CARD_V2) == 2
