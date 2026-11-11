# Control Understanding: the draft to review, and the conversation for the gaps

The product owner decided this on 9 November 2026, in three steps:

1. "I want an agentic experience here. When the user goes to the control understanding, an agent would greet the user to start the conversation. The agent could intelligently offer if the user wants to copy other systems too if those are applicable."
2. On the first build (a conversation asking every point in turn), the owner asked: "is that the best UX you can offer?" It was not. The agent asked about things it already knew, and treated a carried-forward answer like a real gap.
3. The owner agreed to "show the draft, then the user updates", on one condition: "make sure that questions would cover all the needed information to draft the evidence and finalize the attributes."
4. On the simplified draft, the owner said: "The overall UI of this sucks... does not feel premium or enterprise grade." A clickable mock-up was made first and approved ("I like the mock up"). It is the layout below.

Governing documents also moved out of Control Understanding into D&I Evidence. Nothing waited on them there, and the policy is already a D&I evidence item.

## Journey

1. The person opens Control Understanding. The step's drawer keeps its title and status chip; the review carries **one header**:
   - the engagement planner's avatar;
   - "Confirm how ITGC-AC-02 runs", with one line on what it was drafted from and why it is confirmed;
   - **Paste walkthrough notes** and **Ask the planner** as quiet actions, plus **Process** for a business process control;
   - one segmented progress bar, "n of N confirmed".

   The step frame's "Needed from you" card, its title and the agent strip are not repeated above it, and neither is the drawer's own count, so the progress has one measure.
2. **The understanding, on the left,** reads as a document:
   - The control's statement is set in the display serif, with each answer in place.
   - An answer on record is tinted, a suggestion is dashed, a gap is marked, and the point being asked is outlined.
   - Each slot opens its point. A slot already on record opens it in **On record**.
   - Under it, **two readiness lines** in the gates' own terms:
     - "D&I evidence can be requested": the same check as the D&I release, `phase_release.understanding_waits`.
     - "Attributes can be finalized": every value an attribute reads in brackets is answered, and no attribute or source question is open, as `evidence_plans.ATTRIBUTES_SETTLED_SQL` requires.
   - **On record** (folded): the answers held, with their source, each can be changed in place, and the RCM facts the evidence planner reads.
3. **One point at a time, on the right:**
   - **Last year's answers come first, as one step.** Each is ticked. "Confirm n and continue" accepts the ticked ones, each recorded as an accepted proposal. One the person unticks is asked on its own, straight after.
   - **Then each point that needs the person,** in the review's order (what testing waits for first):
     - a question with no answer;
     - a usual-practice suggestion, pre-selected and tagged "Usual", never confirmed in bulk because it is a guess, not a fact about this client;
     - the agents' open questions ("Answer with the planner");
     - a business process control's process understanding ("Confirm the process");
     - the governing policy, optional, linked in D&I Evidence.
   - **What each point shows:**
     - chips for where its proposal comes from and what it is needed for (D&I evidence, attributes, testing);
     - the question;
     - large pill choices, two to a row, with "Other (specify)";
     - "Why this is asked", folded;
     - "Point n of N" and "Skip for now";
     - Back, and "Save & continue".
   - **The course is fixed at the first read,** so Back returns to a point already answered, shown as "On record". A point a later read raises is added at the end.
   - **When no point is open,** the review either says the control is understood, lists its answers and offers "Continue to D&I evidence", or lists the points still open, each with "Answer".
   - **On a phone,** the understanding folds into a bar above the question, and Back with the step's action stays pinned at the foot of the screen.
4. **Use these answers on the other systems:** where the same control runs on other systems in the engagement, the person chooses each system to copy the answers to, under the understanding: one checkbox where there is one other system, a checkbox per system where there are several (the product owner, 10 November 2026: "what if the user only wants to apply it to one application and not all?"). Beside each system, it says what a copy would fill there and what it keeps. Each answer is copied only to the systems ticked, and only where that system has no answer. The server decides at the moment of the copy what each system lacks, and never overwrites an answer a system holds.
5. **Paste walkthrough notes** opens a dialog. The person pastes notes from a walkthrough or a client's email.
   - **What the planner returns:** an answer for each question the notes answer, each with the exact words of the notes it rests on. A proposal whose quoted words are not in the notes is dropped, so the planner cannot answer from what the notes do not say.
   - **Without a model:** an offered answer the notes name word for word is proposed, with its sentence. The longest names are matched first, and words that two questions both offer answer neither, because which one is meant cannot be told.
   - **Choosing:** the person ticks the answers to use. A new answer starts ticked; one that would replace an answer on record starts unticked.
   - **Saving:** the chosen answers save together in one call, through the same validated route. The notes are not kept as a record. Like every agent call's prompt, they are kept encrypted until the retention expiry only where the firm keeps model contents, and otherwise as a hash.
6. **Ask the planner** opens the conversation. It covers the agents' questions (as interviews), any point the person wants to discuss, and typed answers that the planner reads and shows back before anything is recorded. "Back to the draft" returns.

## Sign-in and password settings (ITGC-AC-05, 10 November 2026)

The product owner: "Is there a way for you to provide options at least for the password controls? Should handle SSO, local login, password attributes, and etc. This could be obtained from the password policy if and only if uploaded. If not, should ask the user to provide the password parameters and identify whether the user login via SSO, local, or both. If local and both, should require the user to input the critical password attributes including MFA."

Decided the same day:

- **How users sign in is asked first:** single sign-on, local sign-in, or both. Only the settings that apply follow, each with typical answers and "Other (specify)":
  - **Single sign-on, or both:** the identity provider, and whether it requires MFA.
  - **Single sign-on only:** the accounts that can still sign in locally (none, break-glass, service). The password settings are the identity provider's, tested on its own control.
  - **Local sign-in, or both:**
    - **Required, the core six:** minimum length, complexity, maximum age, history, lockout threshold, and MFA.
    - **Optional:** lockout duration, idle timeout, and a change at first sign-in.
- **A policy is read only if one governs the system.** The planner proposes each setting with the exact words it rests on, as it does for walkthrough notes, and the person chooses. A proposal whose words are not in the policy is dropped. A replacement of a setting on record starts unticked.
- **No policy:** the person states the settings, recorded as stated by the client. The page says so, and the D&I assessment weighs the missing policy. Nothing is blocked.

How it is built (`authentication_profile.py`, `authentication-point.tsx`):

- **Storage:** each setting is a client value of its own.
- **The statement's settings:** composed from the settings once every required one for the method is answered. The statement, the attributes and the D&I release read that sentence as before, so the evidence waits until the critical settings are known.
- **No typing as one phrase:** the sentence is never typed directly. The values route refuses it.
- **Changing the method:** a change that leaves a required setting unanswered clears what the settings composed.
- **Copies:** they carry the settings to the same control on another system that has none.

## Coverage

The coverage the owner asked for is enforced in three places:

- **The control library.** `statement_registry.problems()` fails if any attribute in any library control has a bracketed value with no question to fill it. `test_control_statements` asserts that, and today it holds for 82 controls and 370 questions.
- **Each control in an engagement.** `understanding_chat.understanding_review` lists everything the control needs:
  - each question its statement asks, marked as needed for the evidence, for the attributes (when an attribute reads it) and for testing (when testing waits for it);
  - each document question;
  - the agents' open questions;
  - the process understanding;
  - the RCM facts the evidence planner reads.

  `test_understanding_chat` checks it across every control of a two-system engagement: every attribute placeholder is listed as needed for the attributes, every statement question is listed, and ready-for-evidence equals the D&I release gate exactly.
- **A firm's own controls**, which are not from the library, have no predefined questions. Their gaps are the agents' open questions, which hold both readiness lines until they are answered.

## Safeguards

- **Saving.** Every answer saves through the existing validated route, so credentials are refused, answers are limited to 300 characters, and who answered is recorded. A last-year answer is recorded as an accepted proposal.
- **The screen agrees with the server.** An answer shows as on record, and its progress segment fills, only once the server has confirmed it. The readiness lines show as updating until the gates are read again, and are never computed in the page.
- **Typed text is read by the planner.** It is a schema-checked model call, tiered, budgeted and recorded, in which the person's text is data and never instructions. Without a model, the words are used as written. Nothing is saved until the person uses the reading.
- **Copying is a person's action.** It is authorized as an answer (TASK_UPDATE), recorded on each system it changed with where it came from (`control.understanding_copied`), and never overwrites.
- **No new tables.**

## Not in this increment

- **The agent linking the governing policy by itself in D&I Evidence.**
- **Editing an RCM fact in place.** Frequency, nature and owner are changed in RCM / Control Setup.
