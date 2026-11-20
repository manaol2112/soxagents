## What and why

<!-- One or two sentences: the behaviour that changes and the reason. -->

## Risk class (docs/engineering-standards.md)

- [ ] Low: local and reversible
- [ ] Medium: shared behaviour or an interface between modules
- [ ] High: authorization, tenant isolation, migrations, approvals, outbound email, model safeguards, or a public contract

For Medium and High: what else this could affect, and how that was checked.

## Audit invariants touched (docs/audit-invariants.md)

<!-- The ids (I1 to I16) this change could affect. For High: the "what happens later"
answers, each naming the invariant and the test that holds it, or the increment that
will. A new model entry point joins services/api/tests/test_model_contract.py. -->

## Checks actually run

<!-- Commands and their results. Say what was not run and why. -->

- [ ] New failures: none. Known failures are listed in docs/test-baseline.md
- [ ] No test was deleted or weakened
- [ ] High risk only: reviewed by someone, or an agent, that did not write the change

## Not included

<!-- Follow-ups, limitations, anything deliberately left out. -->
