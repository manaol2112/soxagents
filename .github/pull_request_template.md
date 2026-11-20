## What and why

<!-- One or two sentences: the behaviour that changes and the reason. -->

## Risk class (docs/engineering-standards.md)

<!-- Tick exactly one. The risk-class check (.github/workflows/risk.yml) computes a minimum
from the changed paths (.github/risk-paths.toml); ticking below it fails. There is no
per-PR exception: a wrong minimum is fixed in the mapping, itself a High change. -->
- [ ] Low: local and reversible
- [ ] Medium: shared behaviour or an interface between modules
- [ ] High: authorization, tenant isolation, migrations, approvals, outbound email, model safeguards, or a public contract

For Medium and High: what else this could affect, and how that was checked.

## Design and risk note (High only)

<!-- A committed Markdown file under docs/ (at least 150 words), or "inline" with the two
subsections below (at least 50 words each). The repository is public: a note with secrets,
client data or exploit detail stays private, written "private (owner-held), summary below",
and the two subsections then hold its summary. -->
Design-note: <a docs/ path, or inline, or private (owner-held), summary below>

### What could go wrong

### What happens later

## Audit invariants touched (docs/audit-invariants.md)

<!-- The ids (I1 to I16) this change could affect, or "none: <why>" on one line. For High:
the "what happens later" answers, each naming the invariant and the test that holds it, or
the increment that will. A new model entry point joins
services/api/tests/test_model_contract.py. -->

## Independent review (High only)

<!-- The last SHIP verdict's record. The check verifies that it is present, names a commit
of this pull request, and that no High path of it changed after that commit (then: review
again). It cannot prove who reviewed, or that the review happened or was independent.
Findings: each "<id> fixed in <sha>", separated by semicolons, or "none". -->
Reviewed-commit: <the full or 7+ character SHA the last SHIP verdict reviewed>
Reviewer: <a person's name, or the agent and its workflow label>
Verdict: <SHIP>
Findings: <B1 fixed in abc1234; B2 fixed in def5678; or none>

## Checks actually run

<!-- Commands and their results. Say what was not run and why. -->

- [ ] New failures: none. Known failures are listed in docs/test-baseline.md
- [ ] No test was deleted or weakened
- [ ] High risk only: reviewed by someone, or an agent, that did not write the change

## Not included

<!-- Follow-ups, limitations, anything deliberately left out. -->
