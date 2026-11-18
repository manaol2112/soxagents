# M3a live model smoke (21 October 2026)

`MODEL_LIVE_TESTS=1 uv run pytest -s services/api/tests/test_live_model.py`, against the
Anthropic API with the owner's key, on a test database cloned from the migrations
(0094 applied). Two tests, 2 passed in 31 s. Nothing confidential: the control is the
fixture library's ITGC-AC-01 and the evidence is the three synthetic lines the testing
engine's own tests use.

## Models verified before being pinned

The provider's model list (`GET /v1/models`, 20 October 2026) contains `claude-haiku-5-5`,
`claude-sonnet-5-5` and `claude-opus-5-5` (and older generations). Each answered a
structured-output call through the `record_output` tool (`stop_reason: tool_use`, input
`{"answer": "ok", "n": 3}`). Prices from the published pricing page the same day:
Haiku 5.5 $0.10 / $0.50 per million tokens (prompts up to 100,000 tokens), Sonnet 5.5
$2 / $10, Opus 5.5 $4 / $20.

## One structured call per tier

| Tier | Model that answered | Input tokens | Output tokens | Cost | Duration |
| --- | --- | --- | --- | --- | --- |
| FAST | claude-haiku-5-5 | 421 | 70 | $0.000078 | 1,728 ms |
| BALANCED | claude-sonnet-5-5 | 421 | 70 | $0.001542 | 1,420 ms |
| DEEP | claude-opus-5-5 | 421 | 70 | $0.003084 | 1,840 ms |

Each call's row in `model_calls` carried the model name, the tier, the prompt and output
hashes, the tokens, a cost above zero and a duration; each answer matched the schema
exactly.

## The tester on synthetic evidence (BALANCED, `control-tester/1`)

Three samples (u0001, u0002, u0003) of an access-provisioning control with five approved
attributes. The evidence is deliberately thin: a two-row `approvals.csv` naming tickets
A-1 and A-2, and a one-line note "Approved by Demo Manager." for u0003.

| Item | Source | Results (5 attributes) | Citations kept |
| --- | --- | --- | --- |
| u0001 | MODEL | UNABLE × 5 | 1 (the ticket line) |
| u0002 | MODEL | UNABLE × 5 | 1 |
| u0003 | MODEL | UNABLE × 5 | 4 (the approval note) |

The tester invented no pass: every result is "unable to tell" with a note saying what is
missing (the request naming the access, the approver's relationship, the approval date,
the system's grant record, who granted it) and citing the words it did have. Proposed
conclusion INCOMPLETE; nothing is concluded without a person.

| Call | Model | Status | Input | Output | Cost | Duration |
| --- | --- | --- | --- | --- | --- | --- |
| u0001 | claude-sonnet-5-5 | SUCCEEDED | 3,755 | 405 | $0.01156 | 3,573 ms |
| u0002 | claude-sonnet-5-5 | SUCCEEDED | 3,755 | 548 | $0.01299 | 4,084 ms |
| u0003 | claude-sonnet-5-5 | SUCCEEDED | 3,751 | 596 | $0.01346 | 4,595 ms |

Total for the smoke: $0.0427. Sample notes the tester wrote (u0001, attribute 1):
"approvals.csv only lists ticket A-1 for u0001. It doesn't show the access requested, and
the ticket ID doesn't match population ticket REQ-1. Need the REQ-1 access request showing
user and specific role, plus the system grant record."

Not validated here: the reviewer's re-performance and the screenshot review against the
live model (stubbed in the gate; live in M3c and M3b), Temporal as the worker (the smoke
called the job functions directly), and any evidence beyond the synthetic lines.
