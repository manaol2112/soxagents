# Evidence assurance evaluation set

The known-answer set for the evidence assurance chain (`docs/evidence-assurance.md`,
section 8). Every file is synthetic: the invented company Northwind Fabrics, invented
people, SAP S/4HANA, and the audit period 1 January to 31 December 2026. No client
evidence goes in here.

- `cases/*.json`: one case per file. Each holds the control, the requirement's
  categories (with the files' kinds they set the lens in code, and the case states it),
  the attributes with their criteria and links, the files (`lines`, plus generated
  `rows` for the long change log), and per attribute the verdict a competent IT auditor
  would reach, with a one-line reason and the careful reader's answer element by element
  (quotes copied from the files). An ISSUE lists every agreed result an auditor would
  accept; `unsettled_acceptable` says whether UNSETTLED is acceptable; `code_gap` marks an
  attribute where the code's rules keep the chain from the auditor's verdict even with
  perfect readings, and what it gives instead.
- `case_set.py`: the typed schema, and how a case becomes the chain's own `ChainInput`
  (stored text as the reader stores it, cut at `MAX_TEXT`).
- `score.py`: the scoring command.
- `tests/test_assurance_eval_set.py` (fast tier, no model): the cases validate and build,
  the reviewer's prompt carries nothing of the assessor's, the dry run and the refusals
  work, and with the scripted perfect answers there is no false SUPPORTED and no false
  ISSUE outside the documented code gaps.

## Dry run (free)

From `services/api`:

```
uv run --env-file ../../.env python -m evals.assurance.score --dry-run
```

It prints each case's prompt size for both readings and the estimated cost from the
configured tier prices: the input cost, and the worst case with the full output
allowance (8,192 tokens a reading), which is what the budget checks use. Nothing is
called and nothing is written.

## Live run (costs money)

A live run calls the configured model twice per case, exactly as the database run
does. **It spends money and needs the product owner's approval before it is started.**
It is never part of a test tier.

```
uv run --env-file ../../.env python -m evals.assurance.score --max-cost-usd 5
uv run --env-file ../../.env python -m evals.assurance.score --max-cost-usd 1 --case walkthrough_complete
```

It refuses to start without `--max-cost-usd` or without a live model
(`MODEL_PROVIDER=anthropic` and `MODEL_API_KEY`), and stops before any call whose worst
case would pass the cap. A case the configured per-call or per-job budget would refuse
is reported as refused, with no call, as the database run would. Nothing is written to
the database.

## Reading the results

Each run writes `results/<UTC timestamp>.json` and prints the same summary.

- Per case: the lens, the model and tier, each call's status, tokens and cost, each
  file's share of the case's tokens and cost (apportioned by its share of the files'
  text, since usage is reported per call), quotes dropped and passages set aside per
  reading, and per attribute the expected and actual verdict and result, both readings'
  results, and an `outcome`.
- `outcome`: `correct`; `false_supported` (expected anything but SUPPORTED, got
  SUPPORTED: the error that matters most); `false_issue`; `missed_issue`;
  `issue_wrong_result` (an ISSUE, but with a result the case does not accept);
  `unsettled_acceptable` / `unsettled_not_acceptable`; `other_mismatch`.
- `totals`: those counts, the UNSETTLED rate, the agreement rate of the two readings,
  how many errors come from documented code gaps, tokens, cost and cost per file.
- A case whose reading failed is reported as failed and not scored (the database run
  shows nothing of it either).

Record the first live figures in `docs/evidence-assurance.md`, section 8, with the date,
model and prompt versions the result file names.
