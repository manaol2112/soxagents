"""Every library control's statement (Milestone 8.9), and the structural checks on them.

The checks show the statements are complete and consistent with the definitions; they say
nothing about whether a statement describes the client's control, which a person confirms.
"""

import re

from ai_workforce_api.control_statements import Statement
from ai_workforce_api.statements_business import STATEMENTS as BUSINESS
from ai_workforce_api.statements_itgc import STATEMENTS as ITGC

STATEMENTS: dict[str, Statement] = {**ITGC, **BUSINESS}

ITGC_DOMAINS = ("ACCESS", "CHANGE", "OPERATIONS")
PLACEHOLDER = re.compile(r"\[([^\]]+)\]")


def statement_for(library_key: str) -> Statement | None:
    return STATEMENTS.get(library_key)


def problems() -> list[str]:
    """What is missing or inconsistent across the statements, the library, and the
    definitions."""
    from ai_workforce_api.controls import LIBRARY
    from ai_workforce_api.definition_registry import definition_for

    found: list[str] = []
    refs = {control.control_ref for control in LIBRARY}
    for control in LIBRARY:
        statement = STATEMENTS.get(control.key)
        if statement is None:
            found.append(f"{control.control_ref}: no statement")
            continue
        where = control.control_ref
        declared = [slot.key for slot in statement.slots]
        used = statement.keys_used()
        if len(set(declared)) != len(declared):
            found.append(f"{where}: a slot repeats")
        for key in sorted(used - set(declared)):
            found.append(f"{where}: slot {key} is used but not declared")
        for key in sorted(set(declared) - used):
            found.append(f"{where}: slot {key} is declared but not used")
        if control.domain in ITGC_DOMAINS:
            if statement.assertions or not statement.it_risk:
                found.append(f"{where}: an IT general control states its IT risk, not assertions")
        elif control.domain == "ENTITY":
            if not statement.principle:
                found.append(f"{where}: an entity-level control names its COSO principle")
        elif not statement.assertions:
            found.append(f"{where}: a process control names its assertions")
        for ref in statement.itgcs:
            if ref not in refs:
                found.append(f"{where}: relies on unknown control {ref}")
        for info in statement.information:
            if info.ipe and info.ipe not in refs:
                found.append(f"{where}: names unknown report control {info.ipe}")
            if not info.elements:
                found.append(f"{where}: {info.name} has no data elements")
        if statement.nature == "AUTOMATED" and not statement.itgcs:
            found.append(f"{where}: an automated control names the IT general controls it needs")
        if not statement.precision or not statement.investigation or not statement.evidence:
            found.append(f"{where}: precision, investigation, and evidence are required")
        definition = definition_for(control.key)
        if definition is None:
            found.append(f"{where}: no definition")
            continue
        if definition.control_ref != control.control_ref:
            found.append(f"{where}: the definition is for {definition.control_ref}")
        fills = {slot.fills: slot for slot in statement.slots}
        for item in definition.attributes:
            for placeholder in PLACEHOLDER.findall(item.text):
                slot = fills.get(placeholder)
                if slot is None:
                    found.append(f"{where}: {item.key} needs a slot for [{placeholder}]")
                elif item.blocks and not slot.blocks:
                    found.append(f"{where}: {item.key} blocks but slot {slot.key} does not")
    for key in STATEMENTS:
        if not any(control.key == key for control in LIBRARY):
            found.append(f"{key}: a statement for a control not in the library")
    return found
