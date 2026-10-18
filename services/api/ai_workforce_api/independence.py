"""Whether the independent-review rules are enforced.

On (the default, and the only setting for real engagements): only a team member with the
reviewer role decides review notes and signs off a control's review, never on work they
tested or prepared; only the reviewer decides a deficiency change, never one they asked
for; and setup needs a named independent reviewer.

Off (`REVIEW_INDEPENDENCE_REQUIRED=false`, for development): anyone on the engagement
team may act as the reviewer, including on their own work. The pages say so plainly.
Approvals of client-facing actions keep their own rule (the requester never approves).
"""

import logging

logger = logging.getLogger(__name__)

_required = True


class IndependenceOff(RuntimeError):
    """The independence rules may not be switched off where real engagements run."""


def configure(required: bool, app_env: str = "") -> None:
    """Set once when the app is created, from the process settings. Off is refused in
    production, and logged wherever it is allowed."""
    global _required
    if not required and app_env.strip().lower() == "production":
        raise IndependenceOff(
            "REVIEW_INDEPENDENCE_REQUIRED=false is not allowed with APP_ENV=production"
        )
    if not required:
        logger.warning(
            "Reviewer independence is not enforced (development mode): anyone on an "
            "engagement team may act as its reviewer, including on their own work."
        )
    _required = required


def required() -> bool:
    return _required
