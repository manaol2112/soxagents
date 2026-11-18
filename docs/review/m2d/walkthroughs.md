# M2d cross-role walkthroughs (ai_workforce_scale, 155 controls)

## J1 The preparer (Dana Whitfield, lead) completes planning and evidence work
- Plan of ITGC-AC-05 · ServiceNow before: state NEEDS_CLARIFICATION, revision 2
- Clicked: clicked: Approve plan; plan after: state APPROVED, approved revision 2, decisions 2
  Approval went through the plan review embedded in the Plan step (the same component and route as Testing › Plans); the API recorded the decision.
- Checks before approval on the drafts inspected: [] failing somewhere; chosen ITGC-AC-04 · Oracle EBS with failing []
- Drafted request on ITGC-AC-04 · Oracle EBS: clicked: Approve; request status DRAFT → APPROVAL_PENDING
- Population of ITGC-AC-03 · Workday: clicked: Accept; sufficiency of the population requirement: ['ACCEPTED']
  The samples item for the control now reads bucket BLOCKED (was BLOCKED on the population).

## J2 The independent reviewer (Riley Okafor) completes testing review
- Review of ITGC-AC-01 · Salesforce: 1 proposed notes, status OPEN
- Clicks: skipped: one note left | submitted the dismissal | filled reason | n/a
- Notes after: ['OPEN', 'DISMISSED']; review status OPEN; an accepted note is now the preparer's to answer (queue), so sign-off waits.
- Independence: the lead's attempt to sign off the review was refused by the API with 409

## J3 The audit manager oversees many controls (the lead's session, navigation only)
- Menu: ["Home","Controls","Testing","Evidence","Reports","Settings"]; Results filtered to decide/sign off: 4 rows; Review and Reports opened; the register opened. No legacy page was needed.

## J4 The control owner answers an evidence request through the client portal
- A portal link minted for iam@client.example (SIMULATED: no email went out; the link's token is hashed at rest).
- The code is requested on the page itself; the preview code is read from the API's answer (mock mail, no email provider).
- Portal: clicked: Email me a code | typed the previewed code | clicked: Continue | buttons after: ["Help","I\niam@client.example","5\nAll requests","5\nAwaiting your response","0\nIn progress","0\nSubmitted","0\nCompleted","Interim testing evidence for ITGC-AC-07: User Acce","Interim testing evidence for ITGC-AC-07: User Acce","Interim testing evidence for ITGC-AC-07: User Acce","Interim testing evidence for ITGC-AC-07: User Acce","Interim testing evidence for ITGC-AC-07: User Acce"] | not found: HR transfer listing for the wi (0 matches: ) | opened: Interim testing evidence for ITGC-AC-07: User Access Modification upon Transfer
PBC-92994503
ITGC-AC-07
Access listing
Oct 17, 2026
PAST DUE
0 of 2
Awaiting your response | no form
- Files now on the request 01a15b59: 1 (names: ['owner-evidence.csv'])
- Portal page after upload says: ['owner-evidence.csv', 'owner-evidence.csv was received.']

## J5 A concluded control with immutable sign-off history
- ITGC-AC-01 · SAP ERP: testing sign-offs on record 1 (signed by ['Dana Whitfield']); reviews [('SIGNED_OFF', 'Riley Okafor')]
- The Review step shows: {"receipts":["Interim testing signed off effective by Dana Whitfield (version 1, plan revision 1) Â· Oct 20, 2026","Review signed off by Riley Okafor (version 5) Â· Oct 20, 2026"],"conclusion":"Conclusion\n\nEffective, on the signed-off review by Riley Okafor."}
- The activity record (older ?tab=activity link): {"open":true,"items":28}
- Signing the signed-off sheet again is refused by the API (409); the recorded sign-offs stay as they are.

## J6 A deficiency progresses through remediation to retest
- D-001 on ITGC-AC-06: status REMEDIATION_IN_PROGRESS
- filled remediated_on | clicked Ready for retest | landed on 2d09c2771&deficiency=01a15b5a-0e69-747c-85d2-bbcddff01c05&notice=saved
- Deficiency after: status READY_FOR_RETEST, remediated on 2026-07-17; retest rounds: [('RETEST', 'REQUESTED')]
- The control's Test step now shows the phases: ["Design & implementation Released, evidence to request","Interim Signed off Â· released early","Remediation Released, evidence to request","Retest Released, evidence to request"]
- Queue items on the retest round: ['round/UPCOMING: Retest testing not due yet']

(J6 is from the first run, when D-001 stood in remediation; later runs found it already ready for retest. J1, J2 and J4 are from the third run, after the dismiss form and the portal's code step were driven correctly; each run chose a control not yet acted on.)
