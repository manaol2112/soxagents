# Testing

Phase 8 tests each in-scope control from its evidence. Agents do the first pass; people decide. Milestone 8.1 covers the test plan and sample selection. The testing engine (8.2), workpapers (8.3), and roll-forward (8.4) follow.

## Test plans and samples (8.1)

### When a plan is proposed

When a stored file is read as a **population** for a control's request (see [evidence.md](evidence.md#reading-and-classification)), the control's tester proposes a test plan. A person can also ask for one from the file on the Evidence page (**Propose samples**), for example after confirming a file as a population.

An automated control is tested once from its configuration (the screenshot review in 7.4), so it is not sampled. Only `.xlsx` and `.csv` files are populations.

### Population checks

The tester reads the population again from storage, through the custody check, and records the file's SHA-256 with the plan (`sampling.py`). The checks are deterministic:

| Check | What it looks at |
| --- | --- |
| Completeness | The number of rows. A periodic control with fewer rows than it should show in a year (4 quarterly, 12 monthly, about 50 weekly, 1 annual) is an issue to raise with the owner |
| Unique items | The key column (a named ID, ticket, or reference with the most distinct values). Repeated or blank keys are an issue |
| Period | The date column (named like a date, with mostly readable dates). The audit period is the twelve months ending on the period end. Rows dated outside it, or without a readable date, are left out of the sampling frame |

The sampling frame is every row dated in the period, or every row when there is no date column.

### Selection

The sample size comes from the control's frequency and nature (for example 25 for an event-driven manual control, 2 for a quarterly one). Samples are drawn at random from the frame with a recorded seed. The same file, frame, size, and seed always give the same rows, so a reviewer can redraw them. When the frame is smaller than the sample size, every item is tested.

The plan explains the selection in plain words: how many items, from which file and sheet, with which seed, and why that size.

### A person's part

Until the samples are approved, a person with project update rights can:

- **Draw again**, which uses a new seed;
- **Replace a sample** with another row of the population, as a targeted or haphazard pick, with a reason. The reason and the person are kept on the sample;
- **Approve the samples.**

Approval drafts the sample evidence request to the control owner who sent the population: one line per item, with its key and a few columns, asking for the control's per-item evidence. The request is a normal draft and goes out only after the usual approval. An approved plan cannot be redrawn or changed.

Every proposal, replacement, and approval is in the audit trail, with the seed and the population hash.
