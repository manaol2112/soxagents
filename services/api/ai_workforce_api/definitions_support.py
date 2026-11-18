"""Builders for version 4 testing definitions: numbered steps that name the evidence they
use, and a standard evidence suite per control (standard library, milestone L3a).

A version 4 definition is written as: the evidence suite first, then the procedures as
steps that refer to suite items by key, then the attributes with the keys they are judged
from. The builder derives each procedure's and attribute's evidence names from the suite,
so a step cannot name evidence the suite does not define: an unknown key fails at import.

The shared steps below are the parts of a test that are the same for every sampled
control (validating a population, selecting at random, evaluating a deviation, concluding),
worded once so that every definition says them the same way. Each takes the control's own
nouns and evidence keys; none decides anything a person must decide.
"""

from typing import Any

from ai_workforce_api.testing_definitions import (
    AttributeDef,
    EvidenceDef,
    EvidenceForm,
    EvidencePurpose,
    ProcedureDef,
    ProcedurePhase,
    Step,
)

ROLL_LIMIT = (
    "Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that "
    "the control stopped working is assessed as low; that assessment is a reviewer's decision."
)

WALKTHROUGH_LIMIT = (
    "A walkthrough of one instance shows the design is implemented; it does not show the "
    "control operated throughout the period."
)


def ev(
    key: str,
    name: str,
    form: EvidenceForm,
    provider: str,
    phases: tuple[ProcedurePhase, ...],
    purpose: EvidencePurpose,
    period: str,
    contents: tuple[str, ...],
    *,
    completeness: str = "",
    not_acceptable: str = "",
    alternatives: tuple[str, ...] = (),
    attributes: tuple[str, ...] = (),
) -> EvidenceDef:
    return EvidenceDef(
        key=key,
        name=name,
        form=form,
        provider=provider,
        phases=phases,
        purpose=purpose,
        period=period,
        contents=contents,
        completeness=completeness,
        not_acceptable=not_acceptable,
        alternatives=alternatives,
        attributes=attributes,
    )


def step(
    action: str, evidence: tuple[str, ...] = (), record: str = "", exception: str = ""
) -> Step:
    return Step(action=action, evidence=evidence, record=record, exception=exception)


class Suite:
    """A control's evidence suite, and the procedures and attributes written against it."""

    def __init__(self, items: tuple[EvidenceDef, ...]) -> None:
        keys = [item.key for item in items]
        if len(set(keys)) != len(keys):
            raise ValueError("evidence keys repeat")
        self.items = items
        self.by_key = {item.key: item for item in items}

    def names(self, keys: tuple[str, ...]) -> tuple[str, ...]:
        return tuple(self.by_key[key].name for key in keys)

    def proc(
        self,
        key: str,
        phase: ProcedurePhase,
        objective: str,
        action: str,
        steps: tuple[Step, ...],
        attributes: tuple[str, ...] = (),
        limitation: str = "",
    ) -> ProcedureDef:
        used: list[str] = []
        for item in steps:
            for evidence_key in item.evidence:
                if evidence_key not in self.by_key:
                    raise KeyError(f"{key}: step names unknown evidence {evidence_key}")
                if evidence_key not in used:
                    used.append(evidence_key)
        return ProcedureDef(
            key=key,
            phase=phase,
            objective=objective,
            action=action,
            evidence=self.names(tuple(used)),
            attributes=attributes,
            limitation=limitation,
            steps=steps,
        )

    def attr(
        self, key: str, text: str, evidence_keys: tuple[str, ...], **fields: Any
    ) -> AttributeDef:
        for evidence_key in evidence_keys:
            if evidence_key not in self.by_key:
                raise KeyError(f"{key}: attribute names unknown evidence {evidence_key}")
        return AttributeDef(
            key=key, text=text, evidence=self.names(evidence_keys),
            evidence_keys=evidence_keys, **fields,
        )  # fmt: skip


# Shared steps. Each is one step of a procedure; the definition decides where it sits.


def read_design(what: str, evidence: tuple[str, ...]) -> Step:
    return step(
        f"Read {what}. Note who performs the control, who approves or reviews, the criteria "
        "they apply, how often it runs, what record it leaves, and how an exception is handled.",
        evidence,
        "The performer, the reviewer, the criteria, the frequency, the record left, and the "
        "exception handling, each with the document and page it comes from.",
        "Where the client has no written procedure, record how the performer describes the "
        "control and treat the description as unconfirmed until the walkthrough shows it.",
    )


def client_values(values: str) -> Step:
    return step(
        f"Record the client's values the test depends on: {values}. Take each from the "
        "document that sets it, not from the performer's recollection.",
        (),
        "Each value, its source document, and its effective date.",
        "A value no document sets is recorded as missing with the question to the control "
        "owner; testing of the attribute that depends on it waits for the answer.",
    )


def walkthrough(instance: str, evidence: tuple[str, ...]) -> Step:
    return step(
        f"Walk one recent instance of {instance} from its trigger to its evidence of "
        "completion (AS 2201.37-.38), using the same records the performer used. Ask the "
        "performer what they check, what they do when something does not match, and how they "
        "know the information they rely on is complete.",
        evidence,
        "The instance's identifier, each step traced with its record, the performer's answers, "
        "and anything the walkthrough showed that the procedure does not describe.",
        "A step the records do not show is recorded as not evidenced; the design is not "
        "assessed as implemented on the performer's word alone.",
    )


def authority(who: str) -> Step:
    return step(
        f"Confirm that {who} hold the authority and competence the control requires "
        "(AS 2201.42-.44): their role or a documented delegation gives them the authority, and "
        "they could explain in the walkthrough what they check and why.",
        (),
        "Each performer's and approver's role, the delegation if any, and the basis for the "
        "competence judgment.",
        "A performer whose role does not carry the authority, or who could not explain the "
        "check, is a design matter for a person to assess; it is not resolved by inquiry.",
    )


def assess_design(addresses: str) -> Step:
    return step(
        f"Assess whether the control as designed addresses its risk (AS 2201.42-.43): {addresses}",
        (),
        "The design conclusion with its reasons, and each gap between the control as "
        "described and as performed.",
        "A gap that would leave the risk unaddressed is a design deficiency for a person to "
        "evaluate before operating effectiveness is tested.",
    )


def information_used(report: str, evidence: tuple[str, ...]) -> Step:
    return step(
        f"Identify the information the performer relies on ({report}): the system it comes "
        "from, the report or query, its parameters, and who runs it. Decide how its "
        "completeness and accuracy will be tested (AS 1105.10): by an attribute of this "
        "control, or by a separate control over the report.",
        evidence,
        "The report's name, source, parameters, and the way its reliability is tested.",
        "Information whose source cannot be established is recorded as unreliable until the "
        "client shows how it is produced.",
    )


def obtain_population(
    what: str, evidence: tuple[str, ...], window: str = "the window tested"
) -> Step:
    return step(
        f"Obtain the population of {what} for {window}, from the system's own records, with "
        "the report or query it came from, its parameters, the run date, and the record count "
        "taken when it ran.",
        evidence,
        "The source, parameters, run date, record count, and the first and last dates in the "
        "population.",
        "A population from a tracker or ticketing tool alone, or without its parameters and "
        "record count, is not validated: ask for it from the system's records before sampling.",
    )


def validate_population(agree_to: str, evidence: tuple[str, ...]) -> Step:
    return step(
        "Validate the population's completeness and accuracy (AS 1105.10): agree the record "
        f"count to the support, agree a selection of items both ways between the population "
        f"and {agree_to}, and check that the parameters cover the whole window and every "
        "in-scope system or entity without an excluding filter.",
        evidence,
        "Each agreement made, the items traced both ways, and the parameters checked.",
        "Do not select the sample until a difference is explained and the population "
        "corrected; an unexplained difference is raised to the control owner.",
    )


def select_sample(frequency: str, what: str) -> Step:
    return step(
        f"Select the sample of {what} at random from the validated population, with the size "
        f"the firm's table gives for {frequency} control (AS 2315.39) and a recorded seed. "
        "The audit team selects; the control owner does not. At the roll-forward, interim "
        "items are not reselected.",
        (),
        "The sample size and the table it comes from, the seed, and each selected item's "
        "identifier and date.",
        "Where the population is smaller than the table's size, every item is tested and the "
        "table's size is recorded as not reached.",
    )


def evaluate_exceptions(item: str) -> Step:
    return step(
        f"For each {item} that did not meet an attribute, record what the evidence shows and "
        "what it does not, obtain the control owner's explanation, and ask for any further "
        "evidence the item needs. Do not conclude on the control: a person evaluates each "
        "deviation (AS 2201.48) and decides whether it is a deficiency.",
        (),
        "Per deviation: the attribute, the facts from the evidence, the owner's explanation, "
        "the further evidence requested, and the person who will evaluate it.",
        "An item whose evidence cannot be obtained after follow-up is treated as a deviation "
        "only by a person's decision (AS 2315.40); the agent records it as unable to test.",
    )


def conclude(phase: str) -> Step:
    return step(
        f"Record the {phase} results: per item and per attribute, the result and the evidence "
        "it rests on, with the values compared; then the sample's results as a whole for the "
        "reviewer, with every deviation and every item left untested listed.",
        (),
        "The test sheet with each result cited to its evidence, and the summary.",
        "A result that rests on judgment the definition reserves for a person is recorded as "
        "needing review, not as a pass or an exception.",
    )


def inquire_changes(evidence: tuple[str, ...]) -> Step:
    return step(
        "Ask the control owner whether the control, the people who perform or approve it, or "
        "the systems it relies on changed since the interim date, and inspect the "
        "documentation of any change (AS 2201.55-.56). Inquiry alone is not relied on.",
        evidence,
        "Each change with its date and documentation, or the owner's statement that nothing "
        "changed and the evidence corroborating it.",
        "A change to the control's design means the interim results do not carry to the "
        "remaining period: a person decides whether to test the changed control afresh.",
    )


def update_sample(what: str) -> Step:
    return step(
        f"Select an update sample of {what} at random from the remaining period's validated "
        "population, with the size the firm's roll-forward table gives, and test each item "
        "against the same attributes as at interim. Do not reselect interim items.",
        (),
        "The update sample size, the seed, each item's identifier and date, and each result.",
        "A deviation in the update sample is evaluated with the interim results together; a "
        "person decides whether the control operated for the whole period.",
    )


def config_change_history(setting: str, evidence: tuple[str, ...]) -> Step:
    return step(
        f"Inspect the change history of {setting} for the window: each change with its date, "
        "who made it, the old and new values, and its approval under change management. "
        "Confirm how the history was produced, so that an empty history can be relied on.",
        evidence,
        "Each change found with its approval, or the evidence that the history is complete "
        "and shows none.",
        "A change without an approval is a deviation; a setting whose history the system does "
        "not keep is referred to a person to decide an alternative, since a current value "
        "shows nothing about the window.",
    )
