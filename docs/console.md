# Agent console

The engagement opens on the agent console. A person tells the workforce what they want in plain language. The lead agent answers from the engagement's records, does routine work at once, and brings everything else back as steps the person confirms.

## What a person sees

- **The conversation.** Questions and instructions in, briefings and plans out. The agent leads with the answer, cites control IDs, request IDs, and file names, and formats with short paragraphs, bullets, and tables.
- **Steps to confirm.** A proposed action shows as a numbered step with what it does and what it touches (for example "Submit the evidence request for approval: ITGC-AC-02"). Each step has **Confirm** and **Cancel**; several have **Confirm all**. A step shows who confirmed it and whether it ran.
- **Routine work.** Work the agent did at once (a redraft, a reread, a sample proposal) is listed under its reply.
- **Waiting on you.** Approvals another person asked for, samples to approve, screenshot reviews to sign off, and drafted requests.
- **Agent activity.** What the agents did recently: drafted, read, reviewed, proposed.
- **Conversations.** Every conversation stays available, newest first, named after its first message. **New conversation** starts a fresh one (an empty one is reused), and any earlier one opens again from the list. Each person sees only their own.

The agent is proactive: when an answer finds something that should happen next, it proposes the step in the same turn, with the wording or values filled in, instead of asking. Steps run in the order proposed, each on the latest state, so dependent steps (reword a draft, then submit it) go in one plan.

The registers and records (Controls, Evidence, Deficiencies, Plan) stay as reference views.

## How a turn runs

Sending a message stores it and starts an agent turn in the background (the local worker, or the `console_turn` workflow on Temporal). One message is answered at a time per conversation. The page refreshes until the answer arrives.

The lead agent is Claude, through the provider-neutral chat interface in `models.py` (`ChatProvider.converse`). In a turn it can call tools up to eight times. Every model call is recorded with its token use. Without a configured model, the console says so.

The agent sees the last twelve messages of the conversation and a short snapshot of the engagement. The conversation is not the system of record: every effect lands in the engagement's own tables and audit trail.

## Tools

Tools are registered in `console_tools.py` with a schema and a risk class. Only registered tools with valid arguments run.

| Risk | Runs | Tools |
| --- | --- | --- |
| Read | At once | Engagement summary, list controls, open a control (definition, attributes, requests, every evidence file with what was read from it and its screenshot review, the test plan and samples, deficiencies), read evidence text, list requests, list deficiencies, read the plan, list pending approvals |
| Routine | At once, listed on the reply | Redraft a request, read a file again, propose samples |
| Confirm | When the person confirms, as that person | Reword a draft request, draft a new request or follow-up, mark a request partly received, received, or closed (or cancel it with a reason), submit a request for approval, send an approved request, decide an approval, approve samples, replace a sample, confirm an evidence kind, sign off a screenshot review, log a deficiency, change phase dates, change a milestone |

A confirmed step calls the same service function as the page, with the same authorization: a role without rights fails safely and says so, an approval still needs a second person, and live email stays off unless configured. A step is claimed before it runs, so confirming twice cannot run it twice. Each step commits on its own; in **Confirm all**, the first failure stops the rest. At most 25 steps are proposed in one turn.

## Safety

- Evidence text returned to the agent is marked as client data, and the agent is told to ignore instructions inside it.
- Tool results are bounded (24,000 characters; evidence text 8,000 at a time).
- The agent cannot change permissions, approve its own requests, or run anything unregistered.
- Routine tool runs and confirmed steps are audited (`console.tool_ran`, `console.step_confirmed`), with the tool and outcome, not the content.
