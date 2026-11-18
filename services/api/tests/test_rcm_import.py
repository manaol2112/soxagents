import io

import pytest
from openpyxl import Workbook

from ai_workforce_api.rcm_import import (
    CUSTOM,
    DEFAULT_ATTRIBUTE,
    MAX_BYTES,
    RcmFileError,
    best_sheet,
    build,
    column_values,
    detect_header,
    field_value,
    headers,
    parse_file,
    suggest_fields,
    suggest_value,
    value_choices,
    value_key,
)

# A synthetic client RCM: a title row, the client's own headings, and its own terms.
CLIENT_CSV = (
    "Acme Corp ITGC Risk & Control Matrix FY27,,,,,,,,,,\n"
    "Ctrl #,What Could Go Wrong,Control Activity,How Often,Manual / Automated,"
    "Process,Control Owner,Systems,Region,Test Steps,PBC\n"
    'AC 1.01,Access is not approved,"Managers approve new access.",As needed,Manual,'
    'User Access,Dana Ruiz,"SAP ERP; Workday",EMEA,"1. Request exists\n2. Approval precedes '
    'access",New user listing\n'
    "CM 2.01,Changes are not tested,Changes are tested before release.,Semi-annually,"
    "ITDM,Program Change,Lee Park,SAP ERP,Global,,Change ticket listing\n"
    ",,,,,,,,,,\n"
    "OP 3.01,Jobs fail unnoticed,Job failures are resolved.,Multiple times a day,System,"
    "Computer Operations,ops@client.example,SAP ERP,Global,,\n"
    "AC 1.01,Duplicate,Duplicate row.,Daily,Manual,User Access,Dana Ruiz,SAP ERP,EMEA,,\n"
    ",Missing ID,Has no control ID.,Daily,Manual,User Access,Dana Ruiz,SAP ERP,EMEA,,\n"
    "AC 9.99,Secret,password = Winter2027x,Daily,Manual,User Access,Dana,SAP ERP,EMEA,,\n"
)


def _sheet() -> list[list[str]]:
    _kind, sheets = parse_file("acme-rcm.csv", CLIENT_CSV.encode())
    return sheets[0].rows


def test_client_headings_are_matched_and_extra_columns_are_kept() -> None:
    rows = _sheet()
    assert detect_header(rows) == 2
    names = headers(rows, 2)
    fields = suggest_fields(names)
    assert dict(zip(names, fields, strict=True)) == {
        "Ctrl #": "control_ref",
        "What Could Go Wrong": "risk",
        "Control Activity": "activity",
        "How Often": "frequency",
        "Manual / Automated": "nature",
        "Process": "domain",
        "Control Owner": "owner_name",
        "Systems": "applications",
        "Region": CUSTOM,
        "Test Steps": "test_attributes",
        "PBC": "pbc_items",
    }
    remembered = suggest_fields(names, {"region": "ignore"})
    assert remembered[names.index("Region")] == "ignore"


def test_client_terms_get_a_suggested_standard_value() -> None:
    expectations = {
        ("frequency", "As needed"): "EVENT_DRIVEN",
        ("frequency", "Semi-annually"): "QUARTERLY",
        ("frequency", "Multiple times a day"): "RECURRING",
        ("frequency", "Qtrly"): None,
        ("frequency", "Quarterly"): "QUARTERLY",
        ("frequency", "Yearly"): "ANNUAL",
        ("frequency", "Bi-weekly"): "WEEKLY",
        ("frequency", "Per release cycle"): "EVENT_DRIVEN",
        ("frequency", "Ad-hoc"): "EVENT_DRIVEN",
        ("frequency", "EVENT_DRIVEN"): "EVENT_DRIVEN",
        ("nature", "ITDM"): "IT_DEPENDENT_MANUAL",
        ("nature", "Semi-automated"): "IT_DEPENDENT_MANUAL",
        ("nature", "System"): "AUTOMATED",
        ("nature", "Manual"): "MANUAL",
        ("domain", "Program Change"): "CHANGE",
        ("domain", "Access to programs and data"): "ACCESS",
        ("domain", "Computer Operations"): "OPERATIONS",
        ("domain", "Treasury"): "TREASURY",
        ("domain", "Accounts Payable"): "PROCURE_TO_PAY",
        ("domain", "Revenue"): "ORDER_TO_CASH",
        ("domain", "Exchange rates"): "TREASURY",
        ("domain", "Financial Close"): "RECORD_TO_REPORT",
        ("domain", "Key Reports (IPE)"): "IPE",
        ("domain", "Fraud"): None,
        ("domain", ""): None,
    }
    for (field, value), expected in expectations.items():
        assert suggest_value(field, value) == expected, (field, value)


def test_rows_become_controls_and_unusable_rows_are_listed() -> None:
    rows = _sheet()
    fields = suggest_fields(headers(rows, 2))
    choices = value_choices(rows, 2, fields)
    assert {item.value for item in choices["frequency"]} == {
        "As needed",
        "Semi-annually",
        "Multiple times a day",
        "Daily",
    }
    unmapped = build(rows, 2, fields, {})
    assert unmapped.controls == []
    assert any("frequency values" in problem for problem in unmapped.problems)
    maps = {
        key: {value_key(item.value): item.suggested or "MANUAL" for item in items}
        for key, items in choices.items()
    }
    result = build(rows, 2, fields, maps)
    assert result.problems == []
    assert [control.control_ref for control in result.controls] == ["AC 1.01", "CM 2.01", "OP 3.01"]
    assert [(item.row, item.reason) for item in result.skipped] == [
        (7, "Control ID repeats row 3."),
        (8, "No control ID."),
        (9, "The row looks like it holds a secret."),
    ]
    access, change, operations = result.controls
    assert access.frequency == "EVENT_DRIVEN"
    assert access.frequency_label == "As needed"
    assert access.domain == "ACCESS"
    assert access.domain_label == "User Access"
    assert access.title == "Managers approve new access."
    assert access.applications == ["SAP ERP", "Workday"]
    assert access.test_attributes == ["Request exists", "Approval precedes access"]
    assert access.custom_fields == [("Region", "EMEA")]
    assert change.nature == "IT_DEPENDENT_MANUAL"
    assert change.nature_label == "ITDM"
    assert change.test_attributes == [DEFAULT_ATTRIBUTE]
    # An owner column holding an email address becomes the owner's email.
    assert (operations.owner_name, operations.owner_email) == ("", "ops@client.example")
    assert operations.frequency == "RECURRING"


def test_a_blank_value_is_mapped_like_any_other_client_term() -> None:
    text = "ID,Description,Frequency\nC1,First control,\nC2,Second control,Monthly\n"
    _kind, sheets = parse_file("rcm.csv", text.encode())
    rows = sheets[0].rows
    fields = suggest_fields(headers(rows, 1))
    assert fields == ["control_ref", "activity", "frequency"]
    maps = {"domain": {"": "ACCESS"}, "nature": {"": "MANUAL"}, "frequency": {"monthly": "MONTHLY"}}
    assert any("(blank)" in problem for problem in build(rows, 1, fields, maps).problems)
    maps["frequency"][""] = "ANNUAL"
    result = build(rows, 1, fields, maps)
    assert [c.frequency for c in result.controls] == ["ANNUAL", "MONTHLY"]
    assert result.controls[0].key_control is True


def test_a_row_without_a_control_id_adds_no_terms_to_map() -> None:
    text = "ID,Description,Frequency\nC1,First control,Monthly\n,Notes row,\n"
    _kind, sheets = parse_file("rcm.csv", text.encode())
    rows = sheets[0].rows
    choices = value_choices(rows, 1, ["control_ref", "activity", "frequency"])
    assert [item.value for item in choices["frequency"]] == ["Monthly"]


def test_a_required_field_without_a_column_blocks_the_import() -> None:
    text = "ID,Notes\nC1,Something\n"
    _kind, sheets = parse_file("rcm.csv", text.encode())
    rows = sheets[0].rows
    result = build(rows, 1, ["control_ref", CUSTOM], {})
    assert "Choose the column for Control description." in result.problems
    with pytest.raises(ValueError):
        build(rows, 1, ["control_ref", "control_ref"], {})


def test_a_workbook_is_read_as_values_only() -> None:
    workbook = Workbook()
    cover = workbook.active
    assert cover is not None
    cover.title = "Cover"
    cover.append(["Prepared by", "Internal Audit"])
    cover.append(["Version", "3"])
    rcm = workbook.create_sheet("ITGC RCM")
    rcm.append(["Control ID", "Control Description", "Frequency", "Key Control", "Sample"])
    rcm.append(["AC-01", "Access is approved", "Quarterly", "Yes", "=1+1"])
    rcm.append(["AC-02", "Access is reviewed", "Annual", "No", 4.0])
    buffer = io.BytesIO()
    workbook.save(buffer)
    kind, sheets = parse_file("client.xlsx", buffer.getvalue())
    assert kind == "XLSX"
    assert [sheet.name for sheet in sheets] == ["Cover", "ITGC RCM"]
    assert best_sheet(sheets) == 1
    rows = sheets[1].rows
    # The formula is never evaluated or kept as text. A file saved without cached
    # values reads as blank, and whole numbers read without a decimal point.
    assert rows[1][4] == ""
    assert rows[2][4] == "4"
    fields = suggest_fields(headers(rows, 1))
    assert fields[:4] == ["control_ref", "activity", "frequency", "key_control"]
    maps = {
        "domain": {"": "ACCESS"},
        "nature": {"": "MANUAL"},
        "frequency": {"quarterly": "QUARTERLY", "annual": "ANNUAL"},
    }
    result = build(rows, 1, fields, maps)
    assert [c.key_control for c in result.controls] == [True, False]


@pytest.mark.parametrize(
    ("name", "content", "detail"),
    [
        ("rcm.csv", b"", "file is empty"),
        ("rcm.xls", b"\xd0\xcf\x11\xe0" + b"\x00" * 64, "save the workbook as .xlsx or .csv"),
        ("rcm.xlsx", b"PK\x03\x04not really a zip", "file is not a readable workbook"),
        ("rcm.xlsx", b"just text", "file is not a readable workbook"),
        ("rcm.csv", b"only one line\n", "file has no table of controls"),
        ("rcm.csv", b"a,b\n" * (MAX_BYTES // 4 + 1), "file is too large"),
        ("rcm.bin", b"\x00\x01\x02binary", "file is not a CSV or workbook"),
    ],
    ids=["empty", "xls", "bad-zip", "not-a-zip", "one-line", "too-large", "binary"],
)
def test_unreadable_files_are_refused(name: str, content: bytes, detail: str) -> None:
    with pytest.raises(RcmFileError) as raised:
        parse_file(name, content)
    assert raised.value.detail == detail


def test_ordinary_control_wording_is_not_mistaken_for_a_secret() -> None:
    text = (
        "ID,Description\n"
        "C1,Risk-based review of password settings: length = 8 and complexity enabled\n"
        "C2,Service account api_key: rotated quarterly\n"
    )
    _kind, sheets = parse_file("rcm.csv", text.encode())
    rows = sheets[0].rows
    maps = {"domain": {"": "ACCESS"}, "nature": {"": "MANUAL"}, "frequency": {"": "ANNUAL"}}
    result = build(rows, 1, ["control_ref", "activity"], maps)
    assert [c.control_ref for c in result.controls] == ["C1", "C2"]


def test_columns_are_matched_by_their_values_as_well_as_their_headings() -> None:
    """A heading names a field; the values confirm it, veto it, or pick between columns."""
    names = [
        "Control ID",
        "Control Category",
        "Process",
        "Risk ID",
        "Risk (What Could Go Wrong)",
        "Control Description",
        "Nature",
        "Type",
        "Frequency",
        "Key Control",
        "System(s)",
    ]
    samples = [
        ["BP-SAP-01", "ITGC-SF-02", "IPE-WD-03"],
        ["Business Process", "ITGC", "Key Report (IPE)"],
        ["Procure-to-Pay", "Order-to-Cash / Revenue", "ITGC – Program Change"],
        ["R-P2P-01", "R-O2C-04", "R-ITGC-02"],
        ["Invoices are paid without a valid purchase order.", "Revenue is recorded early."],
        ["Three-way match is performed before an invoice is released for payment."],
        ["Preventive", "Detective"],
        ["Automated", "IT-Dependent Manual", "Manual"],
        ["Monthly", "Quarterly", "As needed"],
        ["Y", "N"],
        ["SAP", "Salesforce; Workday"],
    ]
    fields = suggest_fields(names, samples=samples)
    assert dict(zip(names, fields, strict=True)) == {
        "Control ID": "control_ref",
        # Both the category and the process read as the area, together.
        "Control Category": "domain",
        "Process": "domain",
        # The risk is the wording, not the identifier.
        "Risk ID": "custom",
        "Risk (What Could Go Wrong)": "risk",
        "Control Description": "activity",
        # Preventive or detective is the control's type, never its nature.
        "Nature": "custom",
        "Type": "nature",
        "Frequency": "frequency",
        "Key Control": "key_control",
        "System(s)": "applications",
    }


def test_a_category_and_a_process_give_each_control_its_own_area() -> None:
    cases = {
        "Business Process / Order-to-Cash / Revenue": "ORDER_TO_CASH",
        "Business Process / Procure-to-Pay": "PROCURE_TO_PAY",
        "Business Process / Hire-to-Retire / Payroll": "HIRE_TO_RETIRE",
        "Business Process / Record-to-Report": "RECORD_TO_REPORT",
        "ITGC / ITGC – Logical Access": "ACCESS",
        "ITGC / ITGC – Program Change": "CHANGE",
        # Within ITGC, vendor management is IT operations, not procure to pay.
        "ITGC / ITGC – Vendor Management": "OPERATIONS",
        "Key Report (IPE) / Procure-to-Pay": "IPE",
        "IT Application Control / Hire-to-Retire": "ITAC",
        "ELC / Governance": "ENTITY",
        # One column still works as before.
        "Logical access": "ACCESS",
        "Revenue": "ORDER_TO_CASH",
        "ITGC": None,
    }
    for term, expected in cases.items():
        assert suggest_value("domain", term) == expected, term
    row = ["BP-01", "Business Process", "Order-to-Cash / Revenue", "x"]
    fields = ["control_ref", "domain", "domain", "custom"]
    assert field_value(row, fields, "domain") == "Business Process / Order-to-Cash / Revenue"
    assert column_values([["a", "b"], ["1", "x"], ["2", "x"], ["", "y"]], 1) == [
        ["1", "2"],
        ["x", "y"],
    ]
