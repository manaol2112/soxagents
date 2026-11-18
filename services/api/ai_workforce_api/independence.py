"""Whether the independent-review rules are enforced.

On (the default, and the only setting for real engagements): only a team member with the
reviewer role decides review notes and signs off a control's review, never on work they
tested or prepared; only the reviewer decides a deficiency change, never one they asked
for; a second Owner or Admin approves a methodology version; and setup needs a named
independent reviewer.

Off (`REVIEW_INDEPENDENCE_REQUIRED=false`): anyone on the engagement team may act as the
reviewer, including on their own work. The pages say so plainly. Approvals of
client-facing actions keep their own rule (the requester never approves).

Off is a development switch, and it takes effect only where the process says it is a
development or test environment (`APP_ENV` one of DEVELOPMENT_ENVIRONMENTS). Security
sweep, 17 November 2026: before, it was refused only under `APP_ENV=production`, so a
deployment that left `APP_ENV` empty could switch segregation of duties off with a
warning. Now `APP_ENV=production` refuses to start, and any other value (empty
included) keeps the rules on and logs that the switch was refused.
"""

import logging

logger = logging.getLogger(__name__)

# Where the independence rules may be switched off. Anything else keeps them on.
DEVELOPMENT_ENVIRONMENTS = frozenset({"development", "dev", "local", "test"})

_required = True


class IndependenceOff(RuntimeError):
    """The independence rules may not be switched off where real engagements run."""


def may_switch_off(app_env: str) -> bool:
    """Whether this environment may switch the independence rules off."""
    return app_env.strip().lower() in DEVELOPMENT_ENVIRONMENTS


def configure(required: bool, app_env: str = "") -> None:
    """Set once when the app is created, from the process settings. Off is refused in
    production (the process does not start), ignored with an error logged in any
    environment that is not explicitly a development or test one, and logged wherever it
    is allowed."""
    global _required
    environment = app_env.strip().lower()
    if not required and environment == "production":
        raise IndependenceOff(
            "REVIEW_INDEPENDENCE_REQUIRED=false is not allowed with APP_ENV=production"
        )
    if not required and not may_switch_off(environment):
        logger.error(
            "REVIEW_INDEPENDENCE_REQUIRED=false was refused: it is allowed only with APP_ENV "
            "set to one of %s. Reviewer independence stays enforced.",
            ", ".join(sorted(DEVELOPMENT_ENVIRONMENTS)),
        )
        required = True
    if not required:
        logger.warning(
            "Reviewer independence is not enforced (development mode): anyone on an "
            "engagement team may act as its reviewer, including on their own work."
        )
    _required = required


def required() -> bool:
    return _required
