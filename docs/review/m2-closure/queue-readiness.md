# Drafted-request readiness in the queue: before and after the closure

Before (M2d): a drafted request was ready unless it had no recipient or was held for planning; the approval page's own checks (recipient allowlist, request type, phase release, quality) could still refuse it. After: the queue reads `request_details.draft_blockers`, the same rule the approval endpoint applies, batched for the engagement; a held item is BLOCKED with that reason and belongs to the preparer who resolves it; the endpoint applies the rule again, with its own settings and the record's version, when the action is taken.

## 155 controls (ai_workforce_scale)

| Reading | Drafts | MINE (approver) | BLOCKED (preparer) | Top holds | Queue time |
| --- | --- | --- | --- | --- | --- |
| Before: record facts only (no settings) | 287 | 287 | 0 | none | 205 ms |
| After, client domain allowlisted | 287 | 283 | 4 | Release the roll-forward phase for this control first: its r (2); Confirm the type (Exception evidence). (1); Confirm the type (Other). (1) | 581 ms |
| After, allowlist naming another domain | 287 | 0 | 287 | ops@client.example cannot receive evidence requests. (110); iam@client.example cannot receive evidence requests. (95); release@client.example cannot receive evidence requests. (80) | 562 ms |

## 403 controls (ai_workforce_scale400)

| Reading | Drafts | MINE (approver) | BLOCKED (preparer) | Top holds | Queue time |
| --- | --- | --- | --- | --- | --- |
| Before: record facts only (no settings) | 747 | 747 | 0 | none | 297 ms |
| After, client domain allowlisted | 747 | 715 | 32 | Approve the control's test plan first. (26); Release the roll-forward phase for this control first: its r (5); Confirm the type (Exception evidence). (1) | 808 ms |
| After, allowlist naming another domain | 747 | 0 | 747 | ops@client.example cannot receive evidence requests. (286); iam@client.example cannot receive evidence requests. (252); release@client.example cannot receive evidence requests. (208) | 962 ms |

