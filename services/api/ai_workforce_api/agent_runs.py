"""An agent's run on a record, as the person sees it: queued, running, or not running.

The records keep a lease status (PENDING, WORKING, IDLE). PENDING is work handed to the
background and not yet picked up; WORKING is an agent executing it now. A WORKING run whose
lease ran out is still shown as running: the worker resumes it.
"""

from typing import Any, Literal

RunState = Literal["IDLE", "QUEUED", "RUNNING"]


def run_state(status: Any) -> RunState:
    if status == "PENDING":
        return "QUEUED"
    if status == "WORKING":
        return "RUNNING"
    return "IDLE"
