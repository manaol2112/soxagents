## What and why

<!-- One or two sentences: the behaviour that changes and the reason. -->

## Risk class (docs/engineering-standards.md)

- [ ] Low: local and reversible
- [ ] Medium: shared behaviour or an interface between modules
- [ ] High: authorization, tenant isolation, migrations, approvals, outbound email, model safeguards, or a public contract

For Medium and High: what else this could affect, and how that was checked.

## Checks actually run

<!-- Commands and their results. Say what was not run and why. -->

- [ ] New failures: none. Known failures are listed in docs/test-baseline.md
- [ ] No test was deleted or weakened
- [ ] High risk only: reviewed by someone, or an agent, that did not write the change

## Not included

<!-- Follow-ups, limitations, anything deliberately left out. -->
