"""The tester cites the evidence each result rests on; every citation is checked."""

from typing import Any
from uuid import uuid4

from support import Database
from test_evidence_intake import _base, _engagement
from test_outbound import migrated

from ai_workforce_api.evidence import preview_type
from ai_workforce_api.test_citations import CitedFile, check_citations
from ai_workforce_api.testing_engine import ItemFile, check_results

_ = migrated

POLICY = "[Page 1]\nIdentity standard\n[Page 2]\nMinimum password length 12 characters\n"
SCREEN = "[Image 1]\nPSO-Finance-Legacy MinPasswordLength 8\n"


def _files() -> tuple[CitedFile, ...]:
    return (
        CitedFile(uuid4(), "ISS-07.pdf", POLICY, False),
        CitedFile(uuid4(), "PWD-02.png", SCREEN, True),
    )


def test_a_citation_is_kept_only_where_the_words_or_the_box_check_out() -> None:
    files = _files()
    kept = check_citations(
        [
            # Found on page 2 of the policy: the file's own words are kept.
            {"file": 0, "quote": "minimum password length 12"},
            # Not in the text, on a file the tester did not see as an image: dropped.
            {"file": 0, "quote": "passwords never expire"},
            # In the OCR text of a screenshot, with a box inside the image.
            {
                "file": 1,
                "quote": "MinPasswordLength 8",
                "box": {"x": 0.1, "y": 0.4, "w": 0.3, "h": 0.05},
            },
            # Words the OCR missed, but a valid box on the image: kept, marked not found.
            {"file": 1, "quote": "Lockout 0", "box": {"x": 0.5, "y": 0.5, "w": 0.2, "h": 0.04}},
            # A box outside the image, words not read: dropped.
            {"file": 1, "quote": "nothing", "box": {"x": 0.9, "y": 0.9, "w": 0.3, "h": 0.3}},
            # A file that is not the item's: dropped.
            {"file": 5, "quote": "Identity standard"},
        ],
        files,
    )
    assert [(c["file_name"], c["found"], c["page"]) for c in kept] == [
        ("ISS-07.pdf", True, 2),
        ("PWD-02.png", True, None),
        ("PWD-02.png", False, None),
    ]
    assert kept[0]["quote"] == "Minimum password length 12"
    assert kept[0]["location"] == "Page 2"
    assert kept[1]["box"] == {"x": 0.1, "y": 0.4, "w": 0.3, "h": 0.05}
    # The policy was not shown as an image, so a box on it means nothing.
    on_text = check_citations(
        [{"file": 0, "quote": "Identity standard", "box": {"x": 0, "y": 0, "w": 0.5, "h": 0.1}}],
        files,
    )
    assert on_text[0]["box"] is None
    assert check_citations("not a list", files) == []
    # A box covering the whole image, or a speck, is not a box.
    assert (
        check_citations(
            [{"file": 1, "quote": "zzz", "box": {"x": 0, "y": 0, "w": 1, "h": 1}}], files
        )
        == []
    )


def test_results_carry_their_checked_citations() -> None:
    files = (
        ItemFile("ISS-07.pdf", "policy", POLICY, None, uuid4(), False),
        ItemFile("PWD-02.png", "configuration", SCREEN, None, uuid4(), True),
    )
    results = check_results(
        {
            "results": [
                {
                    "index": 0,
                    "result": "EXCEPTION",
                    "note": "Length 8 is below 12.",
                    "citations": [
                        {"file": 0, "quote": "Minimum password length 12 characters"},
                        {"file": 1, "quote": "MinPasswordLength 8"},
                    ],
                },
                {"index": 1, "result": "UNABLE", "note": "No history."},
            ]
        },
        2,
        files,
    )
    assert [len(item["citations"]) for item in results] == [2, 0]
    assert results[0]["citations"][1]["file_id"] == str(files[1].file_id)
    # Without the files, as before, results carry no citations.
    plain = check_results({"results": [{"index": 0, "result": "PASS", "note": "ok"}]}, 1)
    assert plain[0]["citations"] == []


def test_only_real_pdfs_and_images_are_previewed() -> None:
    assert preview_type(b"%PDF-1.7\n...") == "application/pdf"
    assert preview_type(b"\x89PNG\r\n\x1a\n....") == "image/png"
    assert preview_type(b"\xff\xd8\xff\xe0....") == "image/jpeg"
    assert preview_type(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "image/webp"
    # An HTML or SVG file named .pdf is never shown inline.
    assert preview_type(b"<html><script>alert(1)</script>") is None
    assert preview_type(b"<svg xmlns='http://www.w3.org/2000/svg'/>") is None


def test_a_preview_shows_images_inline_sandboxed_and_text_for_the_rest(migrated: Database) -> None:
    team, client, _scheduler = _engagement(migrated, "preview")
    base = _base(team)
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    shown = _upload_bytes(client, team, "screen.png", png, "image/png")
    sheet = _upload_bytes(client, team, "users.csv", b"id,name\nu1,Ann\n", "text/csv")
    preview = client.get(f"{base}/evidence-files/{shown}/preview")
    assert preview.status_code == 200
    assert preview.headers["content-type"] == "image/png"
    assert preview.headers["content-disposition"].startswith("inline")
    assert "sandbox" in preview.headers["content-security-policy"]
    assert preview.headers["x-content-type-options"] == "nosniff"
    assert client.get(f"{base}/evidence-files/{sheet}/preview").status_code == 415
    reading = client.get(f"{base}/evidence-files/{sheet}/reading")
    assert reading.status_code == 200
    assert reading.json()["file_name"] == "users.csv"
    assert client.get(f"{base}/evidence-files/{uuid4()}/reading").status_code == 404


def _upload_bytes(
    client: Any, team: dict[str, Any], name: str, content: bytes, content_type: str
) -> str:
    added = client.post(
        f"{_base(team)}/evidence-uploads",
        params={"batch_id": str(uuid4()), "name": name},
        content=content,
        headers={"content-type": content_type},
    )
    assert added.status_code == 200, added.text
    file_id: str = added.json()["file_id"]
    return file_id
