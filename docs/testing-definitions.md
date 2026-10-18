# Testing definitions (library version 3)

Generated from `services/api/ai_workforce_api/definitions_*.py` (how each control is tested) and `statements_*.py` (how each control is designed) by `python -m ai_workforce_api.definition_registry`. Do not edit by hand.

Each control's statement records what its design documentation should contain: its objective and risk, nature and type, frequency, operator and reviewer with the authority they need, the judgment involved, its precision, how outliers are investigated, the information it uses, and the evidence it leaves (KPMG ICFR Handbook (2025) Q5.4.30, Q7.3.30, Q2.3.60). What only the client knows is a client value in brackets, filled at setup.

**Status: draft for professional review.** These definitions have passed structural checks only. They have not been validated by a SOX methodology reviewer and must not be represented as PCAOB-compliant. See [testing-framework-review.md](testing-framework-review.md) for the source basis and its limits.

## Summary

- Controls reviewed: 53
- Controls whose tested attributes are unchanged from version 2: 0
- Controls with revised, added, or removed attributes: 53
- Version 2 attributes retired, each with its reason: 12
- Controls whose design must be confirmed: 4
- Controls with open questions: 25
- Attributes by confidence: high 109, moderate 11, low 24, not established 2
- Register entries that block automated testing: 16
- Control statements: 53
- Client values to fill at setup: 230, of which 26 hold testing until filled
- Combined version 2 controls split: 4, into 9 controls (each original keeps its ID)

High and moderate attributes are tested. Low and not-established attributes are proposed in each engagement with their question and are not tested until a person approves them. Those marked as blocking hold the control's testing until a person answers them, because without the answer testing would leave out a condition the control description requires (a review's precision, an approval matrix, a policy's deadline); the others can be taken up later without holding testing.

## Agent decision rules for every attribute

PASS only when the cited evidence shows the condition for this item, with the values compared. EXCEPTION only when the evidence shows the condition was not met. INSUFFICIENT (recorded as UNABLE) when the evidence needed is missing, unreadable, cut off, or does not cover this item: say what is needed. REVIEW when the result depends on judgment the definition reserves for a person, on a value the control does not define, or on evidence that contradicts itself. NOT_APPLICABLE only with the reason the attribute cannot apply to this item. A document's presence is never a pass by itself; missing evidence is never an exception by itself.

## Sources

| ID | Reference | Kind | What it says |
| --- | --- | --- | --- |
| AS2201.37 | AS 2201.37-.38 | standard | A walkthrough follows a transaction from origination to the financial records using the same documents and IT, with probing questions where important processing occurs. |
| AS2201.42 | AS 2201.42-.43 | standard | Design effectiveness: whether controls operated as prescribed by persons with the necessary authority and competence satisfy the control objectives; tested by inquiry, observation, and inspection; walkthroughs ordinarily suffice. |
| AS2201.44 | AS 2201.44-.45 | standard | Operating effectiveness: whether the control operates as designed and the performer has the necessary authority and competence; tested by a mix of inquiry, observation, inspection, and re-performance. |
| AS2201.46 | AS 2201.46-.47 | standard | Evidence needed rises with the risk associated with the control; factors include its nature and frequency, reliance on other controls, automation, and judgment. |
| AS2201.48 | AS 2201.48 | standard | The effect of deviations is evaluated; a control need not operate without any deviation to be considered effective. |
| AS2201.50 | AS 2201.50 | standard | Tests ordered from least to most evidence: inquiry, observation, inspection, re-performance. Inquiry alone does not support a conclusion on a control. |
| AS2201.55 | AS 2201.55-.56 | standard | Roll-forward: the additional evidence for the remaining period depends on the control and its risk, interim results and evidence, the remaining period's length, and significant changes; inquiry alone might suffice when risk is low. |
| AS2201.B28 | AS 2201.B28-.B33 | standard | Benchmarking entirely automated application controls when ITGCs are effective and the control has not changed since the baseline; dependence on files, tables, data, and parameters; the baseline is re-established after a period. |
| AS1105.10 | AS 1105.10 | standard | Information produced by the company used as evidence: test its accuracy and completeness, or the controls over them, and evaluate whether it is sufficiently precise and detailed. |
| AS1105.15 | AS 1105.15-.20 | standard | Definitions of inspection, observation (limited to the point in time observed), inquiry (by itself insufficient for a conclusion on a control), recalculation, and re-performance. |
| AS2315.32 | AS 2315.32 | standard | Sampling does not apply to many tests of controls, including those depending on segregation of duties or leaving no documentary evidence. |
| AS2315.38 | AS 2315.34-.39 | standard | Sample size follows the tolerable and expected deviation rates and the allowable risk; selection should be representative, ideally from the entire period. No sample size table is given. |
| AS2315.40 | AS 2315.40 | standard | A selected item to which the planned or alternative procedures cannot be applied is ordinarily considered a deviation. |
| SEC33-8810 | SEC Release 33-8810, section II.A.2.b-c | regulatory | Management's evidence comes from direct testing, ongoing monitoring, or both, varying with ICFR risk; management considers how the control was applied, consistency, and the performer's authority and competence; its assessment needs reasonable support. |
| KPMG-5.5 | KPMG ICFR Handbook (2025) Q5.5.20-5.5.60 | publication | A control attribute is a procedure the control operator performs that addresses the control objective; attributes must be specific enough for a third party to reperform. |
| KPMG-5.10 | KPMG ICFR Handbook (2025) Q5.10-5.11 | publication | Precision, criteria for investigation, and thresholds; management review controls need their precision understood; outliers are identified, investigated, and resolved. |
| KPMG-6 | KPMG ICFR Handbook (2025) ch. 6, Q6.4.70 | publication | The completeness and accuracy of information used in a control is addressed by an attribute of that control or by separate control activities. |
| KPMG-7.3.10 | KPMG ICFR Handbook (2025) Example 7.3.10 | publication | Example manual GITC attributes: access approved per the IT delegation of authority, requested permissions compared with approved roles, provisioned access consistent with the approval; leavers removed within the policy's days; periodic access reviews by managers per the delegation of authority, inappropriate access investigated, and access modified as instructed. |
| DESIGN | Control description | design | The attribute restates what the control description says the performer does. |
| INFERENCE | Professional inference | inference | A control-specific inference that no source prescribes; its rationale is stated. |
| FIRM | Firm methodology | methodology | A methodology choice (sample sizes, tolerance, test of one) that no standard prescribes; it needs a methodology owner's confirmation. |

## Uncertainty register

| Control | Item | Why uncertain | Missing | Action | Blocks testing | Question |
| --- | --- | --- | --- | --- | --- | --- |
| All | Sample sizes (controls.SAMPLE_SIZES and the roll-forward and retest tables) | AS 2315.38 sizes samples from tolerable and expected deviation rates and risk; it gives no table. The table is firm methodology. | The methodology owner's approval of the table, and whether risk changes the size. | Confirm or replace the table; label it in workpapers as firm methodology. | No | Does the firm approve this sample size table for management's testing, and should higher-risk controls use larger samples? |
| All | Zero tolerance: any confirmed exception concludes not effective (decision 8.2) | AS 2201.48 Note: a control need not operate without any deviation to be effective; AS 2315 evaluates against a tolerable rate. | The methodology owner's tolerance rule for each sample size. | Confirm zero tolerance for the table's small samples, or define tolerable rates. | No | Is any deviation in these sample sizes a failure of the control, or does the methodology allow a tolerable rate for larger samples? |
| All | An item that stays untestable after follow-up | AS 2315.40: an item to which planned or alternative procedures cannot be applied is ordinarily treated as a deviation. The agent never concludes this; a person does. | Who decides, and after how many follow-ups. | A person records it as an exception with the reason, on the test sheet. | No | After how many unanswered follow-ups is a sample item treated as a deviation, and who decides? |
| All | Roll-forward by inquiry alone | AS 2201.56 Note permits inquiry alone when risk is low; the platform always asks for evidence. Management's basis is SEC 33-8810, which also varies evidence with risk. | A risk assessment per control. | Keep evidence-based roll-forward; allow inquiry alone only with a reviewer's documented low-risk assessment. | No | Should a reviewer be able to approve inquiry alone as the roll-forward for a control assessed as low risk? |
| All | Test of one for automated controls, and benchmarking | AS 2201.B28-.B33 supports benchmarking in later years when ITGCs are effective; test of one in the first year is common practice, not a standard. | The methodology owner's approval, and the ITGC dependency mapping per application. | Confirm test of one; map each automated control to the ITGCs it relies on. | No | Does the methodology accept a test of one for automated controls, conditional on effective ITGCs for that application? |
| All | Performer competence | AS 2201.44 and SEC 33-8810 name competence; it is assessed in the design walkthrough (inquiry about what the performer checks), not per sample. | Whether the methodology wants a documented competence assessment per control. | Keep in design procedures; add an attribute only where the methodology requires it. | No | Is a per-control competence assessment required, and in what form? |
| All | Amendments after the verified PCAOB edition | Paragraphs were verified against the edition for fiscal years beginning 16 June to 14 December 2024. Later amendments (for example to AS 1105 and AS 2301 on technology-assisted analysis) were not read. | A check of each cited paragraph against the current edition. | A reviewer confirms the citations before release. | No | Has any cited paragraph changed in the edition in force for the engagement period? |
| All | Big Four publications | Only KPMG's public ICFR Handbook (2025) was read. Deloitte, PwC, and EY publications were not reviewed, and no attribute relies on them. | Review of the firm's own methodology, if any. | Compare with the firm's methodology before release. | No | Does the firm's own methodology differ from any attribute here? |
| ITGC-AC-02 | ac02-timely: Access was removed within [the number of days in the access policy] of the HR termination date | LOW: depends on a value or design the description does not hold. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | Yes | How many days after the termination date does the client's policy allow for removing access, and are they business or calendar days? |
| ITGC-AC-03 | ac03-deadline: The review was completed, and its changes made, by [the deadline in the access review procedure] | LOW: depends on a value or design the description does not hold. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | No | What deadline does the access review procedure set for completing each quarterly review and making its changes? |
| ITGC-AC-03 | ac03-investigated: Access the reviewer found inappropriate was investigated to determine whether unauthorized activity was performed with it | NOT ESTABLISHED: not supported by the control description. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | No | Does the client's access review require investigating activity on access found inappropriate? If so, add it to the control description. |
| ITGC-AC-04 | Control design | The description, frequency, or nature do not fit together. | The client's actual control design. | Confirm the design before relying on the definition. | Yes | This control is the quarterly review of who has privileged access, done by someone who does not hold that access. Granting privileged access is a different control. Confirm that the client relies on this review, which layers are in scope (application, database, and operating system), and how the client defines privileged access. |
| ITGC-AC-04 | ac04-complete: The privileged access list management approved agrees to the system's privileged users at the time | LOW: depends on a value or design the description does not hold. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | Yes | Which roles in each layer does the client define as privileged? |
| ITGC-CM-02 | cm02-classified: The change met the procedure's criteria for an emergency change | LOW: depends on a value or design the description does not hold. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | No | What criteria does the client's procedure use for an emergency change? |
| ITGC-CM-02 | cm02-approved: The retrospective approval was given within [the number of days in the emergency change procedure] of deployment | LOW: depends on a value or design the description does not hold. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | Yes | How many days after deployment does the procedure allow for retrospective approval? |
| ITGC-CM-03 | Control design | The description, frequency, or nature do not fit together. | The client's actual control design. | Confirm the design before relying on the definition. | Yes | This control is the quarterly review of who can deploy changes to production. The restriction on deployment access is set through user access. Confirm that the client performs this quarterly review. |
| ITGC-CM-04 | Control | Not stated in the description. | The client's answer. | Ask the control owner. | No | Which configuration objects affect financial processing (the population)? |
| ITGC-CM-04 | cm04-before: The approval is dated before the configuration change was made | LOW: depends on a value or design the description does not hold. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | No | Must configuration changes be approved before they are made, or may they be approved after? |
| ITGC-OP-04 | op04-priority: The incident was logged with a priority under the incident procedure's criteria | LOW: depends on a value or design the description does not hold. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | No | What criteria does the incident procedure use to prioritize incidents? |
| ITGC-OP-04 | op04-root-cause: For a major incident, the root cause was recorded | LOW: depends on a value or design the description does not hold. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | No | How does the client define a major incident? |
| ITGC-OP-05 | Control design | The description, frequency, or nature do not fit together. | The client's actual control design. | Confirm the design before relying on the definition. | Yes | Owned or hosted? For a hosted system the procedure is an evaluation of the provider's SOC 1 report, which this framework has not defined: AS 2601 (service organizations) was not reviewed, and scoping left the SOC review to entity-level controls. |
| ITGC-OP-05 | op05-soc: For a hosted system, the provider's SOC 1 report covers physical access for the period, with an unqualified opinion on it, and a bridge letter covers any gap | NOT ESTABLISHED: not supported by the control description. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | Yes | How is the provider's SOC 1 report evaluated for this control (who, against which criteria), given scoping assigns SOC review to entity-level controls? |
| ITAC-01 | itac01-release: Only authorized users can release a payment block | LOW: depends on a value or design the description does not hold. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | No | Is releasing a blocked invoice part of this control in the client's design? If so, who may release? |
| OTC-01 | otc01-support: The customer master change is supported by [the documents the control requires] | LOW: depends on a value or design the description does not hold. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | No | What support does the client require for new customers and for changes to limits, terms, and bank details? |
| OTC-02 | otc02-window: Every shipment and invoice meeting [the threshold or criteria for investigation the control sets] was identified by the reviewer | LOW: depends on a value or design the description does not hold. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | Yes | How many days before and after period end does the cutoff analysis cover, and from which source are shipments listed? |
| OTC-03 | otc03-aged: Every unapplied item meeting [the threshold or criteria for investigation the control sets] was identified by the reviewer | LOW: depends on a value or design the description does not hold. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | Yes | What age threshold makes an unapplied item one the reviewer must investigate? |
| OTC-04 | otc04-level: The approver held the level the approval matrix requires for the credit memo amount | LOW: depends on a value or design the description does not hold. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | Yes | What threshold brings a credit memo into this control, and what approval matrix applies? |
| PTP-01 | ptp01-support: The vendor change is supported by [the documents the control requires] | LOW: depends on a value or design the description does not hold. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | No | What support does the client require for new vendors and bank changes? |
| PTP-02 | Control design | The description, frequency, or nature do not fit together. | The client's actual control design. | Confirm the design before relying on the definition. | Yes | Approval 'in the system' suggests a configured workflow. If the workflow enforces the delegation of authority, test it as an application control (configuration and one instance) rather than a sample. |
| PTP-03 | ptp03-identified: Every received-not-invoiced balance and subsequent invoice meeting [the threshold or criteria for investigation the control sets] was identified by the reviewer | LOW: depends on a value or design the description does not hold. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | Yes | Which sources, search period after period end, and amount threshold does the accrual review use? |
| PTP-04 | ptp04-reviewed: The payment proposal shows evidence of review against [what the procedure requires the reviewer to check] | LOW: depends on a value or design the description does not hold. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | No | What must the payment run reviewer check (duplicates, vendor bank changes, amounts against invoices)? |
| RTR-01 | rtr01-support: The journal entry is supported by [the documents the control requires] | LOW: depends on a value or design the description does not hold. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | No | What support must accompany a manual journal entry, and what threshold brings an entry into this control? |
| RTR-02 | rtr02-timely: The reconciliation was prepared and reviewed by [the deadline in the reconciliation policy] | LOW: depends on a value or design the description does not hold. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | No | What deadline after month end does the reconciliation policy set for preparation and review? |
| RTR-03 | rtr03-identified: Every change against prior period or budget meeting [the threshold or criteria for investigation the control sets] was identified by the reviewer | LOW: depends on a value or design the description does not hold. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | Yes | What threshold (amount and percentage) makes a change one the flux review must explain? |
| RTR-04 | Control | Not stated in the description. | The client's answer. | Ask the control owner. | No | What does the consolidation reviewer check, and at what tolerance? |
| HTR-01 | htr01-support: The payroll master change is supported by [the documents the control requires] | LOW: depends on a value or design the description does not hold. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | No | What documents must support a hire, a leaver, and a pay rate change? |
| HTR-02 | htr02-identified: Every employee-level change against the prior run meeting [the threshold or criteria for investigation the control sets] was identified by the reviewer | LOW: depends on a value or design the description does not hold. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | Yes | What threshold makes a change against the prior payroll one the reviewer must explain? |
| INV-01 | inv01-identified: Every count difference meeting [the threshold or criteria for investigation the control sets] was identified by the reviewer | LOW: depends on a value or design the description does not hold. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | Yes | What quantity or value threshold makes a count difference one that must be investigated? |
| INV-03 | inv03-support: The standard cost change is supported by [the documents the control requires] | LOW: depends on a value or design the description does not hold. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | No | What support must a standard cost change have (cost build-up, quotes)? |
| FA-02 | fa02-identified: Every variance in the monthly charge meeting [the threshold or criteria for investigation the control sets] was identified by the reviewer | LOW: depends on a value or design the description does not hold. | The answer to the question. | Proposed, not tested, until a person approves it with the answer. | Yes | What threshold makes a variance in the monthly depreciation charge one the reviewer must explain? |
| TAX-01 | Control | Not stated in the description. | The client's answer. | Ask the control owner. | No | What does tax management check in its review, and when is an external advisor used? |

## Definitions

### ITGC-AC-01

- Objective: Only access that an authorized person approved is granted to users.
- Type: preventive; performer: The administrator who grants access; reviewer: The user's manager and, where the policy requires it, the application owner; trigger: A request for new access or a change to access
- Population: Every account created and every access change in the period, from the system's own user or audit records (not from the ticketing tool alone), with the grant date. Completeness support: the report or query, its parameters, and the record count.
- Sampling: Firm methodology table: 25 for an event-driven control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** When a user needs new access or a change to access in the system, a request naming the user and the specific role or permission is raised in [the access request tool]. The user's manager and, where [the access management policy] requires it, the application owner approve the request in the tool. [the role that administers user access] grants only the approved access, and only after the approval is recorded.
- Risk: A user receives access no one with authority approved, or more access than was approved, and can record or change financial data inappropriately.
- IT risk: Unauthorized access to data, which could result in the destruction of data or improper changes to it, including unauthorized or nonexistent transactions.
- Design: preventive, manual, event driven; operator: [the role that administers user access]; reviewer: The user's manager and, where [the access management policy] requires it, the application owner; owner: [the control owner for user access]
- Authority: The approver must be able to judge whether the user's job needs the access and must not be the user; the administrator must not approve the access they grant.
- Judgment: low (The approver decides whether the access fits the user's job; the administrator matches the grant to the approval.)
- Precision: Every grant and change to access in the system: no access is granted without a recorded approval for that user and that access.
- Outliers: A grant found without approval is removed or approved after the fact, and the reason is recorded; the access granted is compared with what was approved.
- Information used: Access request and approval record: User, Access requested, Approver, Approval date
- Information used: User and role change log from the system: User, Role or permission, Date granted, Granted by
- Evidence: The request and its approval in [the access request tool], and the system's own record of the grant with its date.
- Client value: the role that administers user access (role; does not hold testing). The operator: who grants, changes, and removes access.
- Client value: the access management policy (text; does not hold testing). The criteria the approver applies: who may approve which access.
- Client value: the access request tool (system; does not hold testing). Where requests and approvals are recorded.
- Client value: the control owner for user access (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the access management policy for who must approve which access. Walk one recent instance of an access request through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected grant was requested and approved before it was made, for the access granted. For each selected grant, find its request, compare the approver and approval date with the policy and the grant date in the system, and compare the access in the system with the access approved. Tests: ac01-request, ac01-approver, ac01-before, ac01-matches.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of new accounts and access changes for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: ac01-request, ac01-approver, ac01-before, ac01-matches. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **ac01-request** A request exists that names the user and the specific access (application, role, or permission) that was granted | high | The request identifies the same user and the same access as the grant. | Without a request naming the access, the approval cannot be tied to what was granted. | Access request form or ticket | A request names this user and this access. | No request exists for a grant that the evidence shows was made, or the request names different access. | The request is not provided, or it does not show the access requested. | The request describes access in business terms that cannot be matched to the system role without the client's role mapping. | Do not treat an approval email as a request unless it names the user and the access. | Control description, KPMG ICFR Handbook (2025) Example 7.3.10 |
| **ac01-approver** The request was approved by the user's manager and, where the access management policy requires it, by the application owner | high | The approver is the user's manager, plus the application owner when the policy requires it for this access. | The control description names these approvers; an approval by anyone else does not meet it. | Approval record; Organization chart or HR manager field; Policy on application owner approval | The required approvers approved. | The approval is missing, or given by someone who is not the manager or the required application owner. | The approver's relationship to the user cannot be established from the evidence. | Which access needs application owner approval is not defined; a person decides until the policy is provided. | Do not assume a senior title confers authority. | Control description, KPMG ICFR Handbook (2025) Example 7.3.10, AS 2201.44-.45 |
| **ac01-before** The approval is dated on or before the date the access was granted in the system | high | Approval date is on or before the grant date recorded by the system. | The control is preventive: access granted before approval is not prevented. | Approval timestamp; System grant timestamp | Approval is on or before the grant. | Approval is after the grant. | Either date is missing. | Dates are in different time zones or the same day without times. | Do not use the ticket closure date as the grant date. | Control description |
| **ac01-matches** The access granted in the system is the access that was approved, and no more | high | Access in the system equals the access on the approved request. | Approval of one role does not authorize another. | Approved request; System record of the user's access | They match. | The user received access not on the approved request. | The system record of the access granted is not provided. | Role names differ between the request and the system. | Do not infer the granted access from the request. | Control description, KPMG ICFR Handbook (2025) Example 7.3.10 |

### ITGC-AC-02

- Objective: Leavers' access is removed within the period the policy allows.
- Type: preventive; performer: The administrator who removes access; reviewer: None described; trigger: A termination on the HR termination list
- Population: Every termination in the period from the HR system, with termination dates, and its completeness support. Each leaver is matched to their application accounts.
- Sampling: Firm methodology table: 25 for an event-driven control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** HR records each termination in [the HR system]. [the role that administers user access] receives the termination list [how often IT receives terminations] and disables or removes the leaver's accounts in the system within [the number of days the access policy allows for removal] of the termination date.
- Risk: A former employee or contractor keeps access and records or changes financial data after leaving, or their account is used by someone else.
- IT risk: Unauthorized access to data by users who have left the organization.
- Design: preventive, manual, event driven; operator: [the role that administers user access]; reviewer: None: the removal itself is the control; owner: [the control owner for user access]
- Authority: The administrator must have rights to disable accounts in the system.
- Judgment: low (Matching the leaver to their accounts is mechanical once accounts are named consistently; it needs judgment when they are not.)
- Precision: Every termination in the period: each leaver's accounts are disabled within [the number of days the access policy allows for removal] of the termination date.
- Outliers: An account removed late is checked for activity after the termination date, and any activity is investigated with the business owner.
- Information used: HR termination listing: Employee, Termination date
- Information used: System user listing with disable dates: User, Status, Date disabled
- Evidence: The termination record and the system's own record of when each account was disabled.
- Client value: the role that administers user access (role; does not hold testing). The operator: who grants, changes, and removes access.
- Client value: the HR system (system; does not hold testing). The source of termination dates.
- Client value: how often IT receives terminations (text; does not hold testing). How quickly IT can act on a termination.
- Client value: the number of days the access policy allows for removal (days; testing waits for it). The control's precision: what counts as late.
- Client value: the control owner for user access (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the policy setting the removal period and how the HR list reaches IT. Walk one recent instance of a termination through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected leaver's access was removed within the policy period. For each selected leaver, find the account in the application, the date access was disabled or removed from the system's record, and compare it with the HR termination date and the policy period. Tests: ac02-removed, ac02-timely.
- **o-2** (operating) For a leaver removed late, assess what the access allowed in the gap. Only when access was removed late: inspect activity on the account after the termination date. This informs the deviation's effect; it is not a control attribute. Limitation: Absence of activity reduces the effect of a deviation; it does not cure it.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of terminations for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: ac02-removed, ac02-timely. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **ac02-removed** The leaver's access to the application was disabled or removed, as shown by the system's own record of the change | high | The system shows the account disabled or removed. | Removal is the control. | System audit record or user change log showing the removal | The system shows the removal. | The account was still active after the removal period. | Only a current user listing is provided: it shows absence now, not when access was removed. | The leaver's account cannot be matched to HR records by name or ID. | Do not treat absence from a current listing as removal on time. | Control description, KPMG ICFR Handbook (2025) Example 7.3.10 |
| **ac02-timely** Access was removed within [the number of days in the access policy] of the HR termination date | low | Removal date minus termination date is within the policy period. | The control promises removal within a set period; the period is not in the control description. | Access policy; HR termination date; System removal date | Within the policy period. | Later than the policy period. | Either date is missing. | The policy period is not provided. | Do not assume a period (such as one day or seven days). | Control description, KPMG ICFR Handbook (2025) Example 7.3.10 |

Retired from version 2:

- "The account shows no activity after the termination date": Not part of the control as described (removing access). It assesses the effect of a late removal, so it is now procedure o-2, performed only on a deviation.

### ITGC-AC-03

- Objective: Access that is no longer appropriate is found and removed each quarter.
- Type: detective; performer: The application owner who reviews access; reviewer: The application owner (the review is the control); trigger: The quarterly review cycle
- Population: The quarterly reviews in the period (four a year). The user listing within each review is information used in the control, tested for completeness per review.
- Sampling: Firm methodology table: 2 for a quarterly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each quarter, [the role that reviews access] for the system receives a listing of every user and their roles, produced from the system on a recorded date. They review each user's access against the user's current job, mark access to remove or change, and sign off the review by [the deadline in the access review procedure]. [the role that administers user access] makes every change requested and records its completion.
- Risk: Access that is no longer appropriate, built up through job changes or missed removals, goes unnoticed and is used to record or change financial data.
- IT risk: Unauthorized access to data through access that is no longer appropriate.
- Design: detective, it dependent manual, quarterly; operator: [the role that reviews access]; reviewer: None: the review is the control; owner: [the control owner for user access]
- Authority: The reviewer must know what each user's job requires and must not review their own access.
- Judgment: moderate (Whether a role fits a job is a judgment the reviewer makes for each user.)
- Precision: Every user with access to the system at the listing date; access the reviewer cannot link to a current job need is flagged.
- Outliers: Each flagged user's access is removed or changed and the change recorded; access found inappropriate is checked for activity it was used for.
- Information used: User access listing from the system: User, Role, Status, Date produced
- Evidence: The listing with its production date and record count, the reviewer's sign-off and decisions, and the records of the changes made.
- Client value: the role that administers user access (role; does not hold testing). The operator: who grants, changes, and removes access.
- Client value: the role that reviews access (role; does not hold testing). The operator: the person with knowledge of each user's job.
- Client value: the deadline in the access review procedure (period; does not hold testing). When a quarter's review counts as late.
- Client value: the control owner for user access (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the access review procedure: who reviews which application, the timetable, and how removals are tracked. Walk one recent instance of a quarterly review through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected review covered every account and was performed by the designated owner. For each selected quarter, agree the user listing the reviewer used to the system's user list at the time (record count and sample of users both ways), and compare the reviewer with the designated owner. Tests: ac03-listing, ac03-reviewer.
- **o-2** (operating) Determine whether the changes the reviewer asked for were made. For each removal or change the selected review requested, find the change in the system and its date. Tests: ac03-actioned, ac03-deadline, ac03-investigated.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of quarterly reviews for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: ac03-listing, ac03-reviewer, ac03-actioned. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **ac03-listing** The user listing the reviewer used was complete and accurate: it agrees to the system's user list at the time it was produced | high | Every account in the system at the extract date is on the listing, with its roles as in the system. | A review of an incomplete listing cannot find access that is not on it. | Listing as reviewed; Report parameters and record count; System user list for the same date | Counts agree and the users agree both ways. | Accounts in the system are missing from the listing, or roles differ. | No evidence of how the listing was produced, or no system list to compare. | The listing was produced on a different date from the system list. | A file labelled 'user listing' is not complete because of its name. | AS 1105.10, KPMG ICFR Handbook (2025) ch. 6, Q6.4.70, Control description |
| **ac03-reviewer** The review was signed off by the designated application owner, who did not approve their own access | moderate | The signer is the owner designated for the application, and their own account was reviewed by someone else. | The control description assigns the review to application owners; reviewing one's own access is not an independent review. | Review sign-off; List of designated owners | The designated owner signed and did not review their own access. | Signed by someone else, or the owner approved their own access. | No sign-off, or no list of designated owners. | Ownership was delegated without a documented delegation. | Do not treat an email forwarding the listing as a sign-off. | Control description, KPMG ICFR Handbook (2025) Example 7.3.10, Professional inference |
| **ac03-actioned** Every removal or change the reviewer requested was made in the system | high | Each requested change appears in the system. | The control description includes making the requested changes. | Review decisions; Tickets; System change records | Every requested change was made. | A requested change was not made. | The requested changes, or the system records, are not provided. | The reviewer's request is ambiguous about which access to remove. | A closed ticket is not proof the system changed. | Control description, KPMG ICFR Handbook (2025) Example 7.3.10 |
| **ac03-deadline** The review was completed, and its changes made, by [the deadline in the access review procedure] | low | Sign-off and changes are within the procedure's deadline. | A late review leaves inappropriate access in place longer than designed. | Review procedure; Sign-off date; Change dates | Within the deadline. | After the deadline. | Dates missing. | The deadline is not defined. | Do not assume a deadline. | Control description |
| **ac03-investigated** Access the reviewer found inappropriate was investigated to determine whether unauthorized activity was performed with it | not_established | Each removal for inappropriate access has an investigation of activity. | KPMG's example includes this attribute; the library's description of this control does not. | Investigation records | Each was investigated with an outcome. | Not investigated. | No records. | Always, until the client confirms it is part of their control. | Do not test it unless the client's control includes it. | KPMG ICFR Handbook (2025) Example 7.3.10 |

### ITGC-AC-04

- Objective: Privileged access is held only by people whose role needs it, as approved by management each quarter.
- Type: detective; performer: Management who approve the privileged access list; reviewer: Management (the approval is the control); trigger: The quarterly approval cycle
- Population: The quarterly approvals in the period.
- Sampling: Firm methodology table: 2 for a quarterly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each quarter, [the role that approves privileged access] receives a listing, produced from the system on a recorded date, of every user with [the roles the client defines as privileged]. They confirm for each user that the role needs the access, and sign the listing. Access no longer needed is removed by [the role that administers user access].
- Risk: Administrator or other powerful access is held by people who do not need it, who could change data, configuration, or security settings without detection.
- IT risk: Unauthorized access to data and to system settings through privileged accounts.
- Design: detective, it dependent manual, quarterly; operator: [the role that approves privileged access]; reviewer: None: the review is the control; owner: [the control owner for user access]
- Authority: The reviewer must be senior to, and independent of, the privileged users.
- Judgment: moderate (Whether a role needs privileged access is a judgment for each user.)
- Precision: Every user with [the roles the client defines as privileged] in the system at the listing date.
- Outliers: Access the reviewer does not confirm is removed and its removal recorded; activity under that access since the last review is examined.
- Information used: Privileged user listing from the system: User, Privileged role, Date produced
- Evidence: The signed listing with its production date and the removal records.
- Client value: the role that administers user access (role; does not hold testing). The operator: who grants, changes, and removes access.
- Client value: the role that approves privileged access (role; does not hold testing). The operator; must be independent of the privileged users.
- Client value: the roles the client defines as privileged (text; testing waits for it). The population: which access counts as privileged, in each layer.
- Client value: the control owner for user access (role; does not hold testing). Accountable for the control's design and operation.
- **Design to confirm:** This control is the quarterly review of who has privileged access, done by someone who does not hold that access. Granting privileged access is a different control. Confirm that the client relies on this review, which layers are in scope (application, database, and operating system), and how the client defines privileged access.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the definition of privileged access and the approval procedure. Walk one recent instance of a quarterly approval through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected quarter's complete privileged list was approved, with a decision per user. Agree the approved list to the system's privileged users at the time, and inspect the approval for a dated sign-off and a decision for each user. Tests: ac04-complete, ac04-approved.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of quarterly approvals for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: ac04-complete, ac04-approved. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **ac04-complete** The privileged access list management approved agrees to the system's privileged users at the time | low | Every privileged account in the system is on the approved list. | Approval of an incomplete list leaves unapproved privileged access. | Approved list; System list of privileged roles and members | Every system privileged account is on the list. | A privileged account is missing from the approved list. | No system list to compare. | Which roles count as privileged is not defined. | Do not assume a role is not privileged from its name. | Control description, AS 1105.10 |
| **ac04-approved** Management signed the quarter's privileged access list, with a recorded decision for each user that their role needs the access | moderate | A dated management sign-off and a keep or remove decision per user. | The description says the list is approved by management; whether a role needs access is management's judgment, which the tester confirms was exercised. | Signed list with decisions | Signed, with a decision for every user. | Not signed, or users without a decision. | Sign-off not provided. | Whether a user's role needs the access: the tester does not decide this. | Do not judge whether a role needs access; confirm the decision exists. | Control description, AS 2201.44-.45 |

Retired from version 2:

- "Each privileged user has a role that needs the access": This is management's judgment within the control. The tester confirms a decision was recorded for each user (ac04-approved) and does not substitute their own.
- "No generic privileged account is used without accountability": Generic and shared accounts are the subject of ITGC-AC-06.

### ITGC-AC-05

- Objective: Authentication settings enforce the company security policy for every user in scope.
- Type: preventive; performer: The system (configured setting); reviewer: None described; trigger: Every sign-in
- Population: Not sampled: the configuration and its change history for the period.
- Sampling: Not sampled: one instance (test of one) with evidence the configuration was in place for the period, relying on effective ITGCs (AS 2201.B28-.B29 for benchmarking in later years). Test of one is firm methodology, pending confirmation.
- **Statement:** the system enforces the authentication settings that [the information security policy] requires: [the required settings]. The settings apply to every interactive sign-in.
- Risk: Weak authentication lets someone sign in as another user and record or change financial data in their name.
- IT risk: Unauthorized access to data through weak or bypassed authentication.
- Design: preventive, automated, recurring; operator: The system; reviewer: None: the configuration is the control; owner: [the control owner for user access]
- Authority: Only administrators authorized under user access controls can change the settings.
- Judgment: low (The system applies the settings without judgment.)
- Precision: Every interactive sign-in to the system.
- Outliers: A setting found below policy is corrected through change management and the period it applied is assessed.
- Information used: Authentication configuration: Setting, Configured value, Date shown
- Relies on: ITGC-AC-04, ITGC-CM-04
- Evidence: The configured settings shown from the system with a date, and the history of changes to them in the period.
- Client value: the information security policy (text; does not hold testing). The criteria the settings are compared with.
- Client value: the required settings (text; does not hold testing). What the system must enforce.
- Client value: the control owner for user access (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the security policy's required values and where each is configured. Walk one recent instance of the authentication settings through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each configured value meets the policy and stayed in place. Compare each configured value with the policy value, and inspect the change history of the settings for the period. Tests: ac05-values, ac05-unchanged.
- **rf-1** (rollforward) Conclude whether the setting stayed in place from the interim date to period end (AS 2201.55-.56, .B29). Inspect the change history of the authentication settings for the remaining period. If it did not change, inspect the setting as at period end and agree it to the interim result. If it changed, test the change's approval and test the setting again as changed. Tests: ac05-values, ac05-unchanged. Limitation: A setting at period end shows nothing about the period before it without the change history.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **ac05-values** Each configured authentication value (password length and complexity, lockout, multi-factor enforcement and the accounts it covers) meets the security policy | high | Every configured value is at least as strict as the policy value. | The control is the configuration meeting the policy. | Security policy; Configuration export with the system name and date | Every value meets the policy. | A value is weaker than the policy. | The policy values or the configuration are not provided, or a screenshot does not show the system and date. | The policy is silent on a parameter, or MFA scope is unclear. | A screenshot shows the value on its date only. | Control description |
| **ac05-unchanged** The settings did not change during the period, or each change was approved under change management, as shown by the system's change history | moderate | The change history shows no change, or each change has approval. | One point-in-time value does not show the setting held for the period; reliance rests on the change history and on change management. | System change history for the settings | No change, or every change approved. | An unapproved change. | No change history. | The system keeps no change history: a person decides an alternative. | Do not infer no changes from the absence of a log. | Control description, AS 2201.B28-.B33, Professional inference |

### ITGC-AC-06

- Objective: Every shared, generic, and service account has an accountable owner and cannot be used to sign in interactively unless approved.
- Type: preventive; performer: The account owner and administrators; reviewer: Not described; trigger: The quarterly inventory
- Population: The account inventory for each quarter, agreed to the system's accounts.
- Sampling: Firm methodology table: 2 for a quarterly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each quarter, [the role that reviews shared and service accounts] reviews the inventory of shared, generic, and service accounts in the system, produced from the system on a recorded date. Each account has a named owner, and an account able to sign in interactively has a recorded approval. Accounts without an owner or approval are disabled by [the role that administers user access].
- Risk: An account no one owns is used to record or change data with no one accountable.
- IT risk: Unauthorized access to data through accounts not assigned to a person.
- Design: detective, it dependent manual, quarterly; operator: [the role that reviews shared and service accounts]; reviewer: None: the review is the control; owner: [the control owner for user access]
- Authority: The reviewer must be able to identify each account's purpose and owner.
- Judgment: moderate (Whether an account still has a purpose is a judgment.)
- Precision: Every shared, generic, and service account in the system at the listing date.
- Outliers: An account without an owner or approval is disabled, or given an owner and approved, and the decision recorded.
- Information used: Account inventory from the system: Account, Type, Owner, Interactive sign-in allowed
- Evidence: The reviewed inventory with its production date, the reviewer's sign-off, and the records of accounts disabled.
- Client value: the role that administers user access (role; does not hold testing). The operator: who grants, changes, and removes access.
- Client value: the role that reviews shared and service accounts (role; does not hold testing). The operator.
- Client value: the control owner for user access (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the procedure for inventorying shared and service accounts. Walk one recent instance of the inventory through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each account in the inventory has an owner and is restricted. Agree the inventory to the system's non-personal accounts, then for each account inspect the owner and the sign-in restriction or its approval. Tests: ac06-inventory, ac06-owner, ac06-interactive.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of quarterly inventories for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: ac06-inventory, ac06-owner, ac06-interactive. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **ac06-inventory** The inventory includes every shared, generic, and service account in the system | moderate | Every non-personal account in the system is on the inventory. | An account missing from the inventory has no owner and no restriction. | Inventory; System account list with account types | All are on it. | An account is missing. | No system list. | Account types are not identifiable from the system list. | Do not classify accounts as personal by their names alone. | Control description, AS 1105.10 |
| **ac06-owner** Each shared or service account has a named, current owner | high | A named person who is a current employee owns the account. | Ownership is how activity under the account is made accountable. | Inventory with owners; HR status of owners | A current, named owner. | No owner, or the owner has left. | Owners not provided. | The owner is a team rather than a person. | A team mailbox is not a named owner. | Control description |
| **ac06-interactive** Interactive sign-in is disabled for the account, or an approval for interactive use exists | high | The setting disables interactive sign-in, or a documented approval covers it. | The description permits interactive use only with approval. | Account sign-in settings; Approvals for interactive use | Disabled, or approved. | Enabled without approval. | Settings not provided. | The approver's authority is not defined. | Do not infer the setting from the account's name. | Control description |

Retired from version 2:

- "Credentials are stored in an approved vault": Not in the control description. Test it only if the client's control requires a vault, by adding it to the description.

### ITGC-CM-01

- Objective: Only tested changes approved by business and IT owners reach production.
- Type: preventive; performer: The change implementer; reviewer: The business owner and the IT owner who approve; trigger: A change to the application, database, or infrastructure
- Population: Every change deployed to production in the period, from the deployment or change log of the system itself (not from the ticketing tool alone), with completeness support.
- Sampling: Firm methodology table: 25 for an event-driven control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Every change to the system's programs, database, or infrastructure is raised in [the change management tool], tested in a non-production environment with the test results attached, and approved by the business owner and [the IT approver of changes] in the tool before it is deployed to production.
- Risk: An untested or unapproved change alters how {system} processes or calculates financial data.
- IT risk: Unauthorized or untested changes to programs, which could cause transactions to be processed incorrectly.
- Design: preventive, manual, event driven; operator: The change implementer; reviewer: The business owner and [the IT approver of changes]; owner: [the control owner for change management]
- Authority: Approvers must understand the change's effect and must not have developed it.
- Judgment: moderate (Approvers judge whether testing was adequate for the change.)
- Precision: Every change deployed to production in the period, as listed from the system's own deployment or transport records.
- Outliers: A change found deployed without testing or approval is assessed for its effect and approved after the fact or reversed.
- Information used: Production deployment log from the system: Change ID, Deployed by, Deployment date
- Information used: Change record: Test evidence, Approvers, Approval dates
- Evidence: The change record with test results and approvals dated before deployment, and the system's deployment record.
- Client value: the change management tool (system; does not hold testing). Where requests, tests, and approvals are recorded.
- Client value: the IT approver of changes (role; does not hold testing). Approves the change for IT.
- Client value: the control owner for change management (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the change management procedure: approvals, testing, and deployment. Walk one recent instance of a change through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected change was requested, tested, and approved before deployment, and is the change deployed. For each selected deployment, find the ticket, test evidence, and approvals; compare approval dates with the deployment date; compare the deployed object or version with the ticket. Tests: cm01-request, cm01-tested, cm01-approved, cm01-matches.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of production changes for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: cm01-request, cm01-tested, cm01-approved, cm01-matches. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **cm01-request** A change request exists for the deployed change | high | A ticket describes this change. | The description starts the control with a request. | Change ticket | A ticket exists for it. | A deployment with no ticket. | The ticket is not provided. | The ticket cannot be linked to the deployment. | Do not link by similar descriptions alone. | Control description |
| **cm01-tested** The change was tested before deployment, with the test results documented | high | Test evidence dated before deployment. | The description requires testing. | Test results | Documented tests before deployment. | No testing, or after deployment. | Not provided. | Testing was waived under a documented exemption. | A 'tested' checkbox without results is not test evidence. | Control description |
| **cm01-approved** The business owner and the IT owner approved the change before it was deployed to production | high | Both approvals dated before the deployment. | The description requires approval by business and IT owners before production. | Approvals with dates; Deployment record | Both approved before deployment. | An approval missing or after deployment. | Approvals or the deployment date not provided. | Who the owners are for this system is not documented. | An approval of a different ticket does not count. | Control description |
| **cm01-matches** The object or version deployed is the one in the approved change request | high | The deployment record's object or version equals the ticket's. | Approval covers what was approved, not something else deployed with it. | Deployment record; Ticket | They match. | Something else was deployed. | No deployment record. | The deployment record does not identify objects. | Do not infer the deployed content from the ticket. | Control description |

### ITGC-CM-02

- Objective: Emergency changes are approved after the fact within the agreed time.
- Type: detective; performer: The change implementer; reviewer: The approver of the retrospective review; trigger: An emergency change
- Population: Every change marked emergency in the period, with completeness support for how emergency changes are identified.
- Sampling: Firm methodology table: 25 for an event-driven control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** A change that [the criteria for an emergency change] may be deployed to the system before approval. [the approver of emergency changes] reviews and approves each emergency change in [the change management tool] within [the number of days allowed for retrospective approval] of its deployment.
- Risk: The emergency path is used to deploy changes that would not have been approved, without anyone checking them afterwards.
- IT risk: Unauthorized changes to programs through the emergency change path.
- Design: detective, manual, event driven; operator: The change implementer; reviewer: [the approver of emergency changes]; owner: [the control owner for change management]
- Authority: The approver must not have made the change.
- Judgment: moderate (Whether the change met the emergency criteria is a judgment.)
- Precision: Every change deployed through the emergency path in the period.
- Outliers: A change that did not meet the criteria, or was not approved in time, is reviewed for its effect and escalated to [the control owner for change management].
- Information used: Emergency change listing from the change tool: Change ID, Deployment date, Approval date, Approver
- Evidence: Each emergency change's record with its deployment date and its retrospective approval date.
- Client value: the change management tool (system; does not hold testing). Where requests, tests, and approvals are recorded.
- Client value: the criteria for an emergency change (text; does not hold testing). What may use the emergency path.
- Client value: the approver of emergency changes (role; does not hold testing). Approves after deployment; must not be the implementer.
- Client value: the number of days allowed for retrospective approval (days; testing waits for it). When an approval counts as late.
- Client value: the control owner for change management (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the emergency change procedure, its criteria, and its approval period. Walk one recent instance of an emergency change through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected emergency change met the criteria and was approved within the period. Compare the change with the emergency criteria, and the retrospective approval date with the deployment date and the agreed period. Tests: cm02-classified, cm02-reviewed, cm02-approved.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of emergency changes for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: cm02-reviewed, cm02-approved. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **cm02-classified** The change met the procedure's criteria for an emergency change | low | The ticket documents a reason that meets the written criteria. | A change wrongly treated as an emergency skips pre-approval. | Criteria; Ticket's stated reason | The reason meets the criteria. | It does not. | No reason documented. | No written criteria: whether it was an emergency is judgment. | Urgency stated by the requester is not the criteria. | Control description |
| **cm02-reviewed** The emergency change was reviewed and approved after deployment by an approver the emergency change procedure names | high | A retrospective approval exists, by a named approver, after deployment. | The description requires emergency changes to be reviewed and approved after deployment. | Retrospective approval; Procedure's approvers | Approved after deployment by a named approver. | No retrospective approval. | Approval not provided. | The procedure does not name approvers. | The implementer's own sign-off is not the review. | Control description |
| **cm02-approved** The retrospective approval was given within [the number of days in the emergency change procedure] of deployment | low | Approval date minus deployment date is within the agreed period. | The description requires approval within the agreed days. | Approval; Deployment record; Procedure | Within the period. | Late or missing. | Dates not provided. | The period is not provided. | Do not assume a period. | Control description |

### ITGC-CM-03

- Objective: No one who develops changes can deploy them to production.
- Type: preventive; performer: Administrators who manage deployment access; reviewer: Not described; trigger: Quarterly, per the library
- Population: Not sampled: the developer and deployer lists at the dates tested.
- Sampling: Firm methodology table: 2 for a quarterly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation. AS 2315.32: segregation of duties is usually tested by inspection, not sampling.
- **Statement:** Each quarter, [the role that reviews deployment access] reviews a listing, produced from the system on a recorded date, of every user who can deploy changes to production, and confirms that none of them develops changes for the system. Access that conflicts is removed by [the role that administers user access].
- Risk: A developer deploys their own unreviewed change to production.
- IT risk: Unauthorized changes to programs by people who can both develop and deploy.
- Design: detective, it dependent manual, quarterly; operator: [the role that reviews deployment access]; reviewer: None: the review is the control; owner: [the control owner for change management]
- Authority: The reviewer must know who develops changes and must not hold deployment access themselves.
- Judgment: low (Comparing the deployers with the developers is mechanical once both lists exist.)
- Precision: Every user with production deployment access to the system at the listing date.
- Outliers: A conflict is removed, or an approved exception is documented with a monitoring control over the user's deployments.
- Information used: Production deployment access listing: User, Role, Date produced
- Information used: Developer listing: User, Team
- Evidence: The reviewed listing with its production date, the sign-off, and removal records.
- Client value: the role that administers user access (role; does not hold testing). The operator: who grants, changes, and removes access.
- Client value: the role that reviews deployment access (role; does not hold testing). The operator.
- Client value: the control owner for change management (role; does not hold testing). Accountable for the control's design and operation.
- **Design to confirm:** This control is the quarterly review of who can deploy changes to production. The restriction on deployment access is set through user access. Confirm that the client performs this quarterly review.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect who develops, who deploys, and how deployment access is granted. Walk one recent instance of the deployment access restriction through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether any developer could deploy to production at the dates tested. Obtain the complete developer list and the system's list of accounts with deployment rights at each date tested, and compare them. Tests: cm03-separate, cm03-authorized. Limitation: Shows access at the dates tested only, unless the access change history covers the period.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of dates tested for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: cm03-separate, cm03-authorized. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **cm03-separate** No account on the developer list has production deployment rights in the system | high | The intersection of developers and deployers is empty. | This is the restriction the control describes. | Complete developer list; System list of deployment rights | No overlap. | A developer can deploy. | Either list missing or its completeness unsupported. | A shared or service account deploys on developers' behalf. | Do not assume the developer list is complete. | Control description, AS 2315.32 |
| **cm03-authorized** Every account with deployment rights is on the approved list of the deployment group | high | Each deployer is on the approved group list. | The description limits deployment to a separate, authorized group. | Approved group list; System deployers | All approved. | An unapproved deployer. | No approved list. | The group is defined by role without a list. | Membership of an admin group is not approval. | Control description |

### ITGC-CM-04

- Objective: Changes to configuration that affects financial processing are requested, approved, and logged.
- Type: preventive; performer: The person who changes the configuration; reviewer: The approver; trigger: A configuration change
- Population: Every change to in-scope configuration in the period, from the configuration change log, with completeness support.
- Sampling: Firm methodology table: 25 for an event-driven control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** A change to the system's configuration that affects financial processing ([the configuration that affects financial processing]) is requested in [the change management tool] and approved by [the approver of configuration changes] before it is made; the system logs each configuration change.
- Risk: A configuration change alters a tolerance, account determination, or workflow without authorization.
- IT risk: Unauthorized changes to configuration that affect how transactions are processed.
- Design: preventive, manual, event driven; operator: The person who changes the configuration; reviewer: [the approver of configuration changes]; owner: [the control owner for change management]
- Authority: The approver must understand the financial effect of the setting.
- Judgment: moderate (The approver judges the financial effect of the change.)
- Precision: Every logged change to [the configuration that affects financial processing] in the period.
- Outliers: A change without approval is assessed and approved after the fact or reversed.
- Information used: Configuration change log from the system: Setting, Old value, New value, Changed by, Date
- Evidence: The request and its approval, and the system's configuration change log.
- Client value: the change management tool (system; does not hold testing). Where requests, tests, and approvals are recorded.
- Client value: the configuration that affects financial processing (text; does not hold testing). The population: which settings are in scope.
- Client value: the approver of configuration changes (role; does not hold testing). Approves before the change.
- Client value: the control owner for change management (role; does not hold testing). Accountable for the control's design and operation.
- Question: Which configuration objects affect financial processing (the population)?

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect which configuration affects financial processing, and the change procedure. Walk one recent instance of a configuration change through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected configuration change was requested and approved, and logged as approved. For each logged change, find its request and approval and compare them with the log entry. Tests: cm04-request, cm04-approval, cm04-matches, cm04-before.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of configuration changes for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: cm04-request, cm04-approval, cm04-matches. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **cm04-request** A request exists for the logged configuration change | high | A request describes this change. | The description requires a request. | Request | A request exists. | No request. | Not provided. | Cannot link request to entry. | Do not link by date alone. | Control description |
| **cm04-approval** The configuration change was approved by an authorized approver | high | An approval by an authorized person. | The description requires approval. | Approval; List of authorized approvers | Approved by an authorized person. | Not approved, or by someone unauthorized. | No approval, or no approver list. | Authority is not defined. | Do not assume authority from seniority. | Control description |
| **cm04-matches** The change in the configuration log is the change that was approved | high | Object, old and new values in the log equal the approved change. | Approval covers only the change approved. | Log entry; Approved request | They match. | A different change. | Log lacks values. | Values described differently. | Do not infer values from the request. | Control description |
| **cm04-before** The approval is dated before the configuration change was made | low | Approval date before the log date. | The description does not state the order; a preventive control would require approval first. | Approval; Log entry | Approval first. | Change first. | Dates missing. | Until the client confirms approval must precede the change. | Do not assume the required order. | Professional inference |

### ITGC-CM-05

- Objective: Direct changes to production data are approved by the data owner and made by authorized staff.
- Type: preventive; performer: Authorized staff who make the change; reviewer: The data owner who approves; trigger: A direct data change
- Population: Every direct data change in the period from the change log. Changes made outside the log cannot be found by sampling the log.
- Sampling: Firm methodology table: 25 for an event-driven control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** A direct change to production data in the system (outside the application's normal screens) is requested in [the change management tool], approved by the data owner, made by [the role allowed to change data directly], and logged by the system.
- Risk: Financial data is altered directly, bypassing the application's controls.
- IT risk: Unauthorized changes to data through direct database access.
- Design: preventive, manual, event driven; operator: [the role allowed to change data directly]; reviewer: The data owner; owner: [the control owner for change management]
- Authority: Only [the role allowed to change data directly] can change data directly; the data owner must not make the change.
- Judgment: low (The approval is of a specific, stated change.)
- Precision: Every direct data change logged in the period.
- Outliers: A change without approval is reviewed with the data owner and corrected if needed.
- Information used: Direct data change log: Table, Change, Made by, Date
- Evidence: The request with the data owner's approval, and the system's log of the change.
- Client value: the change management tool (system; does not hold testing). Where requests, tests, and approvals are recorded.
- Client value: the role allowed to change data directly (role; does not hold testing). The operator.
- Client value: the control owner for change management (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the data change procedure, data owners, and authorized staff. Walk one recent instance of a data change through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected data change was approved by the data owner and made by authorized staff. For each logged change, inspect the request and data owner approval, and compare the person who made the change with the authorized staff list. Tests: cm05-approved, cm05-performer. Limitation: The log is the population: a change made without logging is outside this test.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of direct data changes for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: cm05-approved, cm05-performer. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **cm05-approved** A request exists and the data owner approved the data change | high | A request and an approval by the designated data owner. | The description requires data owner approval. | Request; Approval; Data owner list | Approved by the data owner. | Missing or by someone else. | Not provided. | Data owner not defined for the data changed. | Do not treat IT approval as data owner approval. | Control description |
| **cm05-performer** The person who made the data change is on the list of authorized staff | high | The performer in the log is authorized. | The description requires authorized staff. | Log entry; Authorized staff list | Authorized. | Not authorized. | No list, or no performer in the log. | Performed under a shared account. | Do not assume a DBA is authorized. | Control description |

Retired from version 2:

- "The change was logged": The log is the population the sample is drawn from, so every sampled change is logged; the attribute could not fail. The limitation is stated on the procedure.

### ITGC-OP-01

- Objective: Failures of financially relevant scheduled jobs are identified and resolved.
- Type: detective; performer: The operations team who monitor jobs; reviewer: Not described; trigger: Each day's job runs
- Population: The days in the period; for each selected day, the job log of financially relevant jobs, with its completeness support.
- Sampling: Firm methodology table: 20 for a daily control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** [the team that monitors jobs] monitors the scheduled batch jobs for the system in [the job scheduler] each day. Each failed job is logged as an incident, investigated, and rerun or resolved, and the resolution is recorded.
- Risk: A failed interface or batch job leaves transactions unprocessed or processed twice.
- IT risk: Incomplete or inaccurate processing of data through failed jobs.
- Design: detective, it dependent manual, daily; operator: [the team that monitors jobs]; reviewer: None; owner: [the control owner for IT operations]
- Authority: The operator must be able to rerun jobs and judge whether a rerun is complete.
- Judgment: moderate (Whether a rerun fully recovered the processing is a judgment.)
- Precision: Every failure of a job that processes financial data, as the scheduler reports it.
- Outliers: Each failure is logged, investigated, and resolved; the operator confirms the data was processed once and completely.
- Information used: Job run history from the scheduler: Job, Run date, Status
- Relies on: ITGC-AC-04
- Evidence: The scheduler's run history, and the incident record for each failure with its resolution.
- Client value: the job scheduler (system; does not hold testing). Where jobs run and are monitored.
- Client value: the team that monitors jobs (role; does not hold testing). The operator.
- Client value: the control owner for IT operations (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the list of financially relevant jobs and the monitoring procedure. Walk one recent instance of a job failure through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each failure on the selected days was identified and resolved. From the job log for each selected day, list the failures, and find each one's monitoring record and resolution. Tests: op01-identified, op01-resolved.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of days for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: op01-identified, op01-resolved. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **op01-identified** Every failure of a financially relevant job on the selected day has a monitoring record | high | Each failure in the job log has a ticket or monitoring entry. | Monitoring that misses failures does not detect them. | Job log for the day; Monitoring records | Every failure has a record (or no failures occurred). | A failure without a record. | No job log, or its completeness is unsupported. | Whether a job is financially relevant. | A day with no tickets does not mean no failures. | Control description, AS 1105.10 |
| **op01-resolved** Each failure was investigated and resolved, with the resolution documented | high | Each record shows investigation and a resolution. | The description requires failures to be resolved to completion. | Tickets | Resolved with documentation. | Unresolved or undocumented. | Tickets not provided. | Whether the resolution addressed the data impact. | A closed ticket without a resolution is not resolved. | Control description |

Retired from version 2:

- "Resolution was documented": Merged into op01-resolved; testing it separately duplicated the evidence.

### ITGC-OP-02

- Objective: Changes to the job schedule are approved before they are made.
- Type: preventive; performer: The scheduler administrator; reviewer: The approver of schedule changes; trigger: A change to the job schedule
- Population: Every change to the schedule of jobs that process financial data in the period, from the scheduler's own change log.
- Sampling: Firm methodology table: 25 for an event-driven control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** A change to the system's job schedule (a new job, or a change to a job's timing, parameters, or dependencies) is requested in [the change management tool] and approved by [the approver of schedule changes] before it is made in [the job scheduler].
- Risk: A job is added, removed, or retimed without authorization, so transactions are processed incorrectly or not at all.
- IT risk: Unauthorized changes to batch processing.
- Design: preventive, manual, event driven; operator: The scheduler administrator; reviewer: [the approver of schedule changes]; owner: [the control owner for IT operations]
- Authority: The approver must understand the job's effect on financial processing.
- Judgment: low (The approval is of a stated change.)
- Precision: Every change to the schedule of jobs that process financial data.
- Outliers: A change without approval is assessed and approved after the fact or reversed.
- Information used: Schedule change log from the scheduler: Job, Change, Changed by, Date
- Evidence: The change request with its approval dated before the change, and the scheduler's change log.
- Client value: the change management tool (system; does not hold testing). Where requests, tests, and approvals are recorded.
- Client value: the job scheduler (system; does not hold testing). Where jobs run and are monitored.
- Client value: the approver of schedule changes (role; does not hold testing). Approves the change.
- Client value: the control owner for IT operations (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect how schedule changes are requested and approved. Walk one recent instance of a schedule change through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected schedule change was approved before it was made. For each selected change in the scheduler log, inspect its approval and compare the approval date with the change date. Tests: op02-approved.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of schedule changes for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: op02-approved. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **op02-approved** Each schedule change was approved by an authorized approver before it was made | high | An approval exists for the change, dated on or before the change. | The control requires approval before a schedule change. | Approval; Scheduler change log | Approved by an authorized approver on or before the change. | Not approved, or approved after the change. | The approval or the change date is not provided. | The procedure does not say who may approve. | Do not treat the person who made the change as its approver. | Control description |

Retired from version 2:

- "Only authorized people can change the job schedule": Moved to ITGC-OP-02.1, the quarterly review of scheduler access: access and approval of changes are two controls with different frequencies (milestone 8.9).

### ITGC-OP-02.1

- Objective: Only people whose role needs it can change the job schedule.
- Type: detective; performer: The control owner for IT operations; reviewer: None: the review is the control; trigger: Each quarter
- Population: The quarterly reviews in the period, each with the listing of users able to change the schedule.
- Sampling: Firm methodology table: 2 for a quarterly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each quarter, [the control owner for IT operations] reviews a listing, produced from [the job scheduler] on a recorded date, of every user who can change the system's job schedule, confirms each one's need, and has access no longer needed removed.
- Risk: People who should not change batch processing can do so.
- IT risk: Unauthorized changes to batch processing through excessive scheduler access.
- Design: detective, it dependent manual, quarterly; operator: [the control owner for IT operations]; reviewer: None: the review is the control; owner: [the control owner for IT operations]
- Authority: The reviewer must know who needs to change the schedule.
- Judgment: low (The population is small and the need is usually clear.)
- Precision: Every user able to change the schedule at the listing date.
- Outliers: Access not confirmed is removed and the removal recorded.
- Information used: Scheduler user listing: User, Rights, Date
- Evidence: The reviewed listing with its production date, the sign-off, and removals.
- Client value: the job scheduler (system; does not hold testing). Where jobs run and are monitored.
- Client value: the control owner for IT operations (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect who can change the schedule and how the listing is produced. Walk one recent instance of a quarterly scheduler access review through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected quarter's review covered every user able to change the schedule and removed access no longer needed. Agree the listing to the scheduler at its production date; inspect the sign-off and the removal records. Tests: op021-complete, op021-access.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of quarterly reviews for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: op021-complete, op021-access. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **op021-complete** The listing the reviewer used includes every user able to change the job schedule at its production date | high | The listing agrees to the scheduler's own user list at that date. | A review of an incomplete listing cannot find access that is not on it (AS 1105.10). | Listing with its production date; Scheduler user list | The listing agrees. | A user with change rights is missing from the listing. | No production date or no way to agree the listing. | The listing was produced by a method the evidence does not show. | Do not assume a listing is complete because it came from the system. | Control description, AS 1105.10 |
| **op021-access** Every user able to change the job schedule was confirmed by the reviewer, or their access was removed | high | Each user has a recorded decision; removals are recorded. | The control limits who can change batch processing. | Signed listing; Removal records | Every user confirmed or removed. | A user neither confirmed nor removed, or a removal not made. | The signed listing or the removal records are not provided. | The reviewer's basis for confirming a user is not recorded. | Do not treat an unsigned listing as a review. | Control description |

### ITGC-OP-03

- Objective: Financial data is backed up on the schedule and retention the policy requires.
- Type: preventive; performer: The backup tool; reviewer: None: the configuration is the control; trigger: Each scheduled backup
- Population: The backup configuration for the in-scope system, and its changes in the period.
- Sampling: Not sampled: one instance (test of one) with evidence the configuration was in place for the period, relying on effective ITGCs (AS 2201.B28-.B29 for benchmarking in later years). Test of one is firm methodology, pending confirmation.
- **Statement:** [the backup tool] backs up the system's financial data [how often backups run] under a configured schedule and retention of [the retention period].
- Risk: Financial data is lost and cannot be recovered after a failure.
- IT risk: Loss of data that cannot be recovered.
- Design: preventive, automated, daily; operator: [the backup tool]; reviewer: None: the configuration is the control; owner: [the control owner for IT operations]
- Authority: Only authorized administrators can change the schedule or retention.
- Judgment: low (The tool runs on its configuration.)
- Precision: Every scheduled backup of the system's financial data.
- Outliers: Failures are followed up under ITGC-OP-03.1.
- Information used: Backup configuration: Scope, Schedule, Retention
- Relies on: ITGC-AC-04, ITGC-CM-04
- Evidence: The backup configuration shown from the tool with a date, and changes to it in the period.
- Client value: the backup tool (system; does not hold testing). The operator.
- Client value: how often backups run (text; does not hold testing). The policy the schedule is compared with.
- Client value: the retention period (period; does not hold testing). How long backups are kept.
- Client value: the control owner for IT operations (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the backup policy and how the configuration enforces it. Walk one recent instance of the backup configuration through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether the backup configuration covers the financial data on the required schedule and retention for the period. Inspect the configuration as shown from the tool and its change history; inspect the job history for one day to see it operated. Tests: op03-config, op03-ran.
- **rf-1** (rollforward) Conclude whether the setting stayed in place from the interim date to period end (AS 2201.55-.56, .B29). Inspect the change history of backup configuration for the remaining period. If it did not change, inspect the setting as at period end and agree it to the interim result. If it changed, test the change's approval and test the setting again as changed. Tests: op03-config. Limitation: A setting at period end shows nothing about the period before it without the change history.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **op03-config** The backup tool is configured to back up the system's financial data on the schedule and retention the policy requires | high | Scope, schedule, and retention in the configuration. | The control is the configured backup. | Configuration shown from the tool, dated; Backup policy | Scope, schedule, and retention meet the policy. | The financial data is not in scope, or the schedule or retention falls short of the policy. | The configuration is not shown from the tool, or is undated. | The policy does not state the schedule or retention. | Do not take a policy document as evidence of the configuration. | Control description |
| **op03-ran** Scheduled backups of financial data ran on the day examined | high | The job history for the day shows each scheduled job. | Shows the configured control operated. | Backup job history | Every scheduled job ran. | A scheduled job did not run. | No job history for the day. | Whether a failed job held financial data. | A report listing only successes may omit failures. | Control description |

Retired from version 2:

- "A restore test succeeded during the period": Moved to ITGC-OP-03.2, the annual restore test (milestone 8.9).

### ITGC-OP-03.1

- Objective: Failed backups are found and resolved promptly.
- Type: detective; performer: The team that monitors backups; reviewer: None; trigger: Each day's backup results
- Population: Every failed backup in the period, from the backup tool's job history.
- Sampling: Firm methodology table: 25 for an event-driven control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** [the team that monitors backups] reviews the system's backup results each day. Each failed backup is investigated and rerun, or otherwise resolved, within [the time allowed to resolve a failed backup], and the resolution is recorded.
- Risk: A failed backup goes unnoticed, leaving data unrecoverable.
- IT risk: Loss of data that cannot be recovered.
- Design: detective, it dependent manual, daily; operator: [the team that monitors backups]; reviewer: None; owner: [the control owner for IT operations]
- Authority: The operator must be able to rerun backups.
- Judgment: low (A failure is reported by the tool.)
- Precision: Every failed backup the tool reports.
- Outliers: Each failure is rerun or resolved and the result recorded.
- Information used: Backup job history: Job, Date, Status
- Relies on: ITGC-AC-04
- Evidence: The backup history and, for each failure, the record of its resolution.
- Client value: the team that monitors backups (role; does not hold testing). The operator.
- Client value: the time allowed to resolve a failed backup (days; testing waits for it). When a resolution counts as late.
- Client value: the control owner for IT operations (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect how failures are reported, followed up, and recorded. Walk one recent instance of a failed backup through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected failure was resolved within the time allowed. For each selected failure, inspect its resolution record and compare the resolution date with the failure date. Tests: op031-resolved.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of failed backups for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: op031-resolved. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **op031-resolved** The failed backup was rerun successfully or otherwise resolved within [the time allowed to resolve a failed backup], with the resolution recorded | high | A resolution record dated within the time allowed. | An unresolved failure leaves data unrecoverable. | Job history; Resolution record | Resolved within the time allowed. | Not resolved, or resolved late. | No resolution record. | The time allowed is not defined. | Do not treat the next day's successful backup as resolving the failure unless the procedure says so. | Control description |

### ITGC-OP-03.2

- Objective: Backups of financial data can be restored.
- Type: detective; performer: The team that performs restore tests; reviewer: The reviewer of restore tests; trigger: The annual restore test
- Population: The restore tests performed in the period.
- Sampling: Firm methodology table: 1 for an annual control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** At least once a year, [the team that performs restore tests] restores the system's financial data from a backup to a test environment, and [the reviewer of restore tests] confirms the restored data is complete and readable and signs off the result.
- Risk: Backups exist but cannot be restored when needed.
- IT risk: Loss of data that cannot be recovered.
- Design: detective, manual, annual; operator: [the team that performs restore tests]; reviewer: [the reviewer of restore tests]; owner: [the control owner for IT operations]
- Authority: The reviewer must be able to judge whether the restored data is complete.
- Judgment: moderate (Judging the restored data complete needs a comparison with the source.)
- Precision: A restore of the system's financial data, compared with its source.
- Outliers: A failed or incomplete restore is investigated and the backup process corrected; the test is repeated.
- Information used: Restore test record: Backup used, Restore date, Checks performed, Result
- Evidence: The restore test record with the checks performed and the reviewer's sign-off.
- Client value: the team that performs restore tests (role; does not hold testing). The operator.
- Client value: the reviewer of restore tests (role; does not hold testing). Signs off the result.
- Client value: the control owner for IT operations (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect how a restore test is performed and judged complete. Walk one recent instance of a restore test through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether a restore of financial data was tested successfully and signed off in the period. Inspect the restore test record: the backup used, the data restored, the checks performed, the result, and the sign-off. Tests: op032-restore.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **op032-restore** A restore of the system's financial data was tested in the period, its result checked against the source, and the result signed off | high | A dated restore test of financial data, with checks and sign-off. | Backups that cannot be restored do not protect the data. | Restore test record | A successful, checked, signed-off test in the period. | No test, a failed test, or no sign-off. | The record does not show what was restored or checked. | Whether the data restored is the financial data. | A backup's success is not a restore test. | Control description |

### ITGC-OP-04

- Objective: Incidents affecting financial systems are tracked to resolution.
- Type: detective; performer: IT support; reviewer: Not described; trigger: An incident
- Population: Incidents for financial systems in the period from the incident log.
- Sampling: Firm methodology table: 25 for an event-driven control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Incidents affecting the system are logged in [the incident tool] with a priority under [the incident management procedure], tracked to resolution, and closed with the resolution recorded; for an incident of [the priority that counts as major], the root cause is recorded.
- Risk: An incident that affects financial processing is not resolved, or recurs.
- IT risk: Incomplete or inaccurate processing of data from unresolved incidents.
- Design: detective, manual, event driven; operator: IT support; reviewer: None; owner: [the control owner for IT operations]
- Authority: Support staff must be able to diagnose and resolve incidents or escalate them.
- Judgment: moderate (Prioritizing an incident is a judgment under the procedure's criteria.)
- Precision: Every incident logged against the system in the period.
- Outliers: An incident open beyond its target is escalated under the procedure.
- Information used: Incident listing from the incident tool: Incident, Priority, Opened, Closed, Resolution
- Evidence: Each incident record with its priority, resolution, and dates.
- Client value: the incident tool (system; does not hold testing). Where incidents are logged.
- Client value: the incident management procedure (text; does not hold testing). The criteria for priority.
- Client value: the priority that counts as major (text; does not hold testing). Which incidents need a root cause.
- Client value: the control owner for IT operations (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the incident procedure, priorities, and the definition of a major incident. Walk one recent instance of an incident through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected incident was prioritized, resolved, and, if major, has a recorded root cause. Inspect each selected ticket for its priority, resolution, and root cause. Tests: op04-priority, op04-resolved, op04-root-cause.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of incidents for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: op04-priority, op04-resolved. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **op04-priority** The incident was logged with a priority under the incident procedure's criteria | low | A priority consistent with the criteria. | The description requires logging and prioritizing. | Ticket; Priority criteria | Logged with a fitting priority. | No priority, or one inconsistent with the criteria. | Criteria not provided. | Criteria are not written. | Do not judge priority without criteria. | Control description |
| **op04-resolved** The incident was resolved and closed with the resolution recorded | high | A resolution and closure. | The description requires tracking to resolution. | Ticket | Resolved with a recorded resolution. | Open beyond the procedure's target, or closed without resolution. | Ticket not provided. | Target times not defined. | Closure alone is not resolution. | Control description |
| **op04-root-cause** For a major incident, the root cause was recorded | low | A major incident has a recorded root cause. | The description requires root cause for major incidents. | Ticket; Definition of major | Recorded, or the incident is not major. | A major incident without root cause. | Definition of major not provided. | Whether the incident is major. | Do not decide what is major. | Control description |

### ITGC-OP-05

- Objective: Only authorized people can physically reach the servers of financial systems.
- Type: preventive; performer: Facilities or the hosting provider; reviewer: The reviewer of the access list; trigger: The annual review
- Population: The data center access list at the review date, or the provider's SOC 1 report and bridge letter.
- Sampling: Firm methodology table: 1 for an annual control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each year, [the reviewer of data center access] reviews the list of people with physical access to the data center hosting the system, confirms each person's need, and has access no longer needed removed.
- Risk: Someone without a need reaches the servers and damages or tampers with them.
- IT risk: Unauthorized physical access to systems and data.
- Design: detective, manual, annual; operator: [the reviewer of data center access]; reviewer: None: the review is the control; owner: [the control owner for IT operations]
- Authority: The reviewer must know who needs physical access.
- Judgment: low (The population is small and the need is usually clear.)
- Precision: Every person on the data center access list at the review date.
- Outliers: Access not confirmed is removed and the removal recorded.
- Information used: Data center access list: Person, Badge, Date
- Evidence: The reviewed access list with its date, the sign-off, and removals.
- Applies when: The client owns or operates the data center. For a system hosted by a vendor, physical security is covered by the vendor's SOC 1 report and system scoping takes this control out.
- Client value: the reviewer of data center access (role; does not hold testing). The operator.
- Client value: the control owner for IT operations (role; does not hold testing). Accountable for the control's design and operation.
- **Design to confirm:** Owned or hosted? For a hosted system the procedure is an evaluation of the provider's SOC 1 report, which this framework has not defined: AS 2601 (service organizations) was not reviewed, and scoping left the SOC review to entity-level controls.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect who may enter the data center and how access is granted and reviewed. Walk one recent instance of the access review through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) For an owned data center, determine whether everyone with access is authorized. Compare the access list with authorized personnel and the review sign-off. Tests: op05-authorized.
- **o-2** (operating) For a hosted system, determine whether the provider's SOC 1 report covers physical access for the period. Inspect the report's period, the controls in scope, the opinion, exceptions, and complementary user entity controls, and the bridge letter for any gap. Tests: op05-soc.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of access reviews for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: op05-authorized. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **op05-authorized** Everyone on the data center access list is an authorized person whose job needs physical access | high | Each person on the list is authorized. | The description restricts physical access. | Access list; Authorization records | All authorized. | An unauthorized person. | No authorization records. | Whether a job needs access. | A badge list is not an authorization record. | Control description |
| **op05-soc** For a hosted system, the provider's SOC 1 report covers physical access for the period, with an unqualified opinion on it, and a bridge letter covers any gap | not_established | Report period, scope, opinion, and bridge letter cover the period. | For a hosted system the provider operates the control. | SOC 1 report; Bridge letter | Covers it without exceptions affecting physical access. | Not covered, or exceptions. | Report not provided. | Always: evaluating a SOC report is not yet defined. | A report's existence is not coverage. | Control description |

### ELC-01

- Objective: Employees acknowledge the code of conduct each year, and missing acknowledgements are followed up.
- Type: preventive; performer: HR or compliance; reviewer: Not described; trigger: The annual acknowledgement cycle
- Population: Employees during the year, from HR, with completeness support.
- Sampling: Firm methodology table: 1 for an annual control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation. The employees within the annual cycle are sampled at the event-driven size; confirm.
- **Statement:** Each year, every employee acknowledges the code of conduct in [the acknowledgement tool] by [the acknowledgement deadline]. [the role that owns the code of conduct] follows up each employee who has not acknowledged it, and reports the completion rate to [the body the completion rate is reported to].
- Risk: Employees act against the company's ethical standards without consequence.
- COSO principle: Principle 1: The organization demonstrates a commitment to integrity and ethical values.
- Design: preventive, manual, annual; operator: [the role that owns the code of conduct]; reviewer: [the body the completion rate is reported to]; owner: [the role that owns the code of conduct]
- Authority: The operator must be able to require acknowledgement and escalate.
- Judgment: low (Completion is a count.)
- Precision: Every employee employed at [the acknowledgement deadline].
- Outliers: Each employee not acknowledged is followed up until they acknowledge or the matter is escalated.
- Information used: Acknowledgement listing: Employee, Acknowledged on
- Information used: Employee listing from HR: Employee, Status
- Evidence: The acknowledgement listing compared with the employee listing, the follow-ups, and the report to [the body the completion rate is reported to].
- Client value: the acknowledgement tool (system; does not hold testing). Where acknowledgements are recorded.
- Client value: the acknowledgement deadline (period; does not hold testing). When the year's acknowledgements must be complete.
- Client value: the role that owns the code of conduct (role; does not hold testing). The operator.
- Client value: the body the completion rate is reported to (role; does not hold testing). The reviewer.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the approved code and the acknowledgement process. Walk one recent instance of the acknowledgement cycle through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether the code was approved and communicated, selected employees acknowledged it, and missing acknowledgements were followed up. Inspect the approval and communication; for selected employees, inspect the acknowledgement; for the exception report, inspect the follow-up. Tests: elc01-approved, elc01-acknowledged, elc01-followed-up.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **elc01-approved** The code of conduct in effect was approved and communicated to employees in the period | high | Approval and a dated communication in the period. | The description requires a communicated code. | Approval; Communication | Approved and communicated. | Not communicated in the period. | Not provided. | Approval authority undefined. | A published page is not communication to employees. | Control description |
| **elc01-acknowledged** The selected employee acknowledged the code in the period | high | A dated acknowledgement by the employee. | The description requires annual acknowledgement. | Acknowledgement record | Acknowledged in the period. | Not acknowledged and not followed up. | No record. | Employee joined or left during the cycle. | Do not assume acknowledgement from training completion. | Control description |
| **elc01-followed-up** Each missing acknowledgement on the exception report was followed up by HR or compliance | high | Follow-up recorded for each exception. | The description requires follow-up. | Exception report; Follow-up records | Each followed up. | One not followed up. | No exception report. | What counts as follow-up. | An unsent reminder is not follow-up. | Control description |

### ELC-02

- Objective: Whistleblower reports are investigated and summarized to the audit committee.
- Type: detective; performer: Compliance or internal audit; reviewer: The audit committee; trigger: A report, and each quarter
- Population: Reports in the whistleblower log. Reports never logged cannot be found by sampling the log.
- Sampling: Firm methodology table: 2 for a quarterly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each report received through [the whistleblower channel] is logged and investigated by [the role that investigates reports]. Each quarter, [the role that investigates reports] summarizes the reports, their status, and their outcomes to [the body that reviews the summary], which reviews the summary.
- Risk: Reports of fraud or misconduct are not investigated or not seen by those charged with governance.
- COSO principle: Principle 14: The organization internally communicates information, including objectives and responsibilities for internal control, necessary to support the functioning of internal control. Also Principle 8: The organization considers the potential for fraud in assessing risks to the achievement of objectives (KPMG ICFR Handbook (2025) Examples 2.5 and 2.6.20 place the hotline and its reporting there).
- Design: detective, manual, quarterly; operator: [the role that investigates reports]; reviewer: [the body that reviews the summary]; owner: [the role that investigates reports]
- Authority: The investigator must be independent of the people reported on.
- Judgment: high (Investigating a report and deciding its outcome are judgments.)
- Precision: Every report received in the period.
- Outliers: Each report is investigated to a recorded outcome; matters involving senior management go directly to [the body that reviews the summary].
- Information used: Hotline report log: Report, Date, Status, Outcome
- Evidence: The report log, investigation files, the quarterly summaries, and the minutes recording [the body that reviews the summary]'s review.
- Client value: the whistleblower channel (text; does not hold testing). How reports are received.
- Client value: the role that investigates reports (role; does not hold testing). The operator.
- Client value: the body that reviews the summary (role; does not hold testing). The reviewer.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the hotline procedure and committee reporting. Walk one recent instance of a report through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether selected reports were investigated and the committee received the quarterly summaries. Inspect investigation files for selected reports, and committee materials for each quarter. Tests: elc02-investigated, elc02-committee. Limitation: The log is the population: an unlogged report is outside this test.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of reports and quarterly summaries for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: elc02-investigated, elc02-committee. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **elc02-investigated** The report was investigated and closed with a documented outcome | high | An investigation and an outcome. | The description requires investigation. | Investigation file | Investigated with an outcome. | Not investigated. | File not provided. | Whether the investigation was adequate is judgment. | Do not judge adequacy. | Control description |
| **elc02-committee** The audit committee received the quarter's summary of reports | high | Committee materials or minutes include the summary. | The description requires quarterly summaries to the committee. | Committee materials; Minutes | Received. | Not presented. | Materials not provided. | The summary omits reports in the log. | An agenda item alone is not the summary. | Control description |

Retired from version 2:

- "Each report was logged": The log is the population; a logged report always passes. The limitation is stated on the procedure.

### ITAC-01

- Objective: Invoices outside tolerance of the purchase order and receipt cannot be paid until resolved.
- Type: preventive; performer: The system; reviewer: Not described; trigger: Each invoice posting
- Population: Not sampled: the configuration, with one instance of the block.
- Sampling: Not sampled: one instance (test of one) with evidence the configuration was in place for the period, relying on effective ITGCs (AS 2201.B28-.B29 for benchmarking in later years). Test of one is firm methodology, pending confirmation.
- **Statement:** the system compares each vendor invoice with its purchase order and goods receipt and blocks the invoice for payment when the quantity or price differs by more than [the configured tolerance]. Only [the role allowed to release a payment block] can release a blocked invoice.
- Risk: An invoice for goods not ordered or not received, or at the wrong price, is paid.
- Assertions (AS 1105.11): Existence or occurrence, Valuation or allocation
- Design: preventive, automated, recurring; operator: The system; reviewer: None: the configuration is the control; owner: [the control owner for accounts payable]
- Authority: Only [the role allowed to release a payment block] can release a block.
- Judgment: low (The system applies the configured tolerance.)
- Precision: Every invoice posted against a purchase order, at a tolerance of [the configured tolerance].
- Outliers: A blocked invoice is investigated with purchasing and the vendor and released only when resolved.
- Information used: Tolerance configuration: Tolerance key, Quantity tolerance, Price tolerance
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: The configured tolerances shown from the system, their change history, and one blocked invoice showing the control operated.
- Client value: the configured tolerance (percent; testing waits for it). The control's precision.
- Client value: the role allowed to release a payment block (role; does not hold testing). Release must be restricted.
- Client value: the control owner for accounts payable (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the configured tolerances against the approved design. Walk one recent instance of the match through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether the configuration matches the design and blocks an invoice outside tolerance. Compare configured tolerances with the design; observe or inspect one invoice outside tolerance being blocked. Tests: itac01-config, itac01-blocks, itac01-release. Limitation: Relies on ITGCs over changes and access to the configuration (AS 2201.B29).
- **rf-1** (rollforward) Conclude whether the configuration stayed in place to period end. Inspect the configuration change history for the remaining period; if changed, test again. Tests: itac01-config.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **itac01-config** The configured quantity and price tolerances for the three-way match equal the approved design | high | Each configured tolerance equals the approved value. | The control is the configuration. | Configuration export with system and date; Approved design | Equal. | Different. | No approved design or configuration. | Tolerance applies differently by vendor or company code. | Do not assume default settings. | Control description, AS 2201.B28-.B33 |
| **itac01-blocks** An invoice outside tolerance was blocked for payment | high | A test or real invoice outside tolerance shows a payment block. | Shows the configuration operates. | Invoice with block status | Blocked. | Not blocked. | No instance. | The instance is from a different configuration. | A blocked invoice within tolerance shows nothing. | Control description |
| **itac01-release** Only authorized users can release a payment block | low | Users with release rights are authorized. | Release is not in the control description. | Users with release rights; Authorized list | All authorized. | Unauthorized user. | No list. | Until the client confirms release is part of this control. | Configuration change access is an ITGC, not this attribute. | Professional inference |

### ITAC-02

- Objective: Orders that would exceed the customer's approved credit limit are held until an authorized user releases them.
- Type: preventive; performer: The system, and authorized users for release; reviewer: Not described; trigger: Each sales order
- Population: Not sampled: the configuration, one held order, and release rights.
- Sampling: Not sampled: one instance (test of one) with evidence the configuration was in place for the period, relying on effective ITGCs (AS 2201.B28-.B29 for benchmarking in later years). Test of one is firm methodology, pending confirmation.
- **Statement:** the system holds a sales order when the customer's open receivables plus the order would exceed the customer's credit limit. Only [the role allowed to release a credit hold] can release a held order.
- Risk: Goods are sold to customers unlikely to pay, overstating receivables.
- Assertions (AS 1105.11): Valuation or allocation
- Design: preventive, automated, recurring; operator: The system; reviewer: None: the configuration is the control; owner: [the control owner for credit]
- Authority: Only [the role allowed to release a credit hold] can release a hold.
- Judgment: low (The system applies the configured check.)
- Precision: Every sales order for a customer with a credit limit.
- Outliers: A held order is reviewed by credit management and released or cancelled.
- Information used: Credit check configuration: Credit control area, Check rule, Exposure included
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: The configured credit check, its change history, and one held order showing the control operated.
- Client value: the role allowed to release a credit hold (role; does not hold testing). Release must be restricted.
- Client value: the control owner for credit (role; does not hold testing). Accountable for the control's design and operation.
- Assumption: Changes to credit limits are a master data control, not this one; the v2 attribute's 'change limits' is dropped from release.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the configured credit check against the design. Walk one recent instance of the credit check through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether the check is configured as designed, holds an order over the limit, and only authorized users release holds. Compare configuration with design; inspect one held order; compare users with release rights with the authorized list. Tests: itac02-config, itac02-holds, itac02-release.
- **rf-1** (rollforward) Conclude whether the configuration and release rights stayed in place. Inspect change history of the configuration and of release rights for the remaining period. Tests: itac02-config, itac02-release.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **itac02-config** The credit check is configured as designed for the order types and customers in scope | high | Configuration equals design. | The control is the configuration. | Configuration; Design | Equal. | Different. | Not provided. | Exempt order types or customers. | Do not assume defaults. | Control description, AS 2201.B28-.B33 |
| **itac02-holds** An order that would exceed the credit limit was held | high | An order over the limit shows a credit hold. | Shows the configuration operates. | Held order | Held. | Not held. | No instance. | Exposure calculation unclear. | A hold for another reason shows nothing. | Control description |
| **itac02-release** Only authorized users can release a credit hold | high | Users with release rights are on the authorized list. | The description names release by an authorized user. | Users with release rights; Authorized list | All authorized. | Unauthorized user. | No authorized list. | Authorization by role without a list. | Do not assume sales managers are authorized. | Control description |

### IPE-01

- Objective: The aged receivables report used for the bad debt reserve is complete and accurate.
- Type: detective; performer: The preparer of the reserve; reviewer: Not described; trigger: Each quarter's reserve
- Population: The quarterly reports used in the period.
- Sampling: Firm methodology table: 2 for a quarterly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each quarter, [the preparer of the report] produces the aged receivables report from the system using [the report name or transaction] with recorded parameters, agrees its total to the receivables balance in the general ledger at the same date, and investigates any difference before the report is used for the bad debt reserve.
- Risk: The bad debt reserve is calculated from a report that is incomplete or ages items incorrectly.
- Assertions (AS 1105.11): Valuation or allocation, Completeness
- Design: detective, it dependent manual, quarterly; operator: [the preparer of the report]; reviewer: The reviewer of the bad debt reserve; owner: [the control owner for receivables]
- Authority: The preparer must be able to explain differences between the report and the ledger.
- Judgment: low (Agreeing totals is mechanical; explaining a difference may need judgment.)
- Precision: The report total agrees to the ledger exactly, or each difference is explained.
- Outliers: A difference is investigated and the report rerun or corrected before use.
- Information used: Aged receivables report: Customer, Invoice, Amount, Due date, Aging bucket
- Information used: General ledger trial balance: Account, Balance, Date
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: The report with its parameters and run date, the agreement to the ledger, and the explanation of any difference.
- Client value: the report name or transaction (report; does not hold testing). Which report is relied on.
- Client value: the preparer of the report (role; does not hold testing). The operator.
- Client value: the control owner for receivables (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the report's logic, parameters, and reconciliation. Walk one recent instance of a report run through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether the selected report was complete and accurate. Agree the report total to the ledger; inspect its parameters; recalculate aging for selected invoices. Tests: ipe01-total, ipe01-parameters, ipe01-aging.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of report runs for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: ipe01-total, ipe01-parameters, ipe01-aging. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **ipe01-total** The report's total agrees to the receivables balance in the general ledger at the same date | high | Report total equals the ledger balance. | Completeness of the report (AS 1105.10). | Report; Ledger balance | Equal, or differences reconciled. | Unreconciled difference. | Either figure missing. | Reconciling items need judgment. | Do not accept a total typed onto the report. | Control description, AS 1105.10 |
| **ipe01-parameters** The report was run as at the reserve date for every entity, with no filter that excludes receivables | high | As-of date equals the reserve date; all entities; no excluding filter. | Wrong parameters make a complete-looking report incomplete. | Parameter screenshot or log | Correct. | Wrong date, missing entity, or excluding filter. | Parameters not shown. | A filter's effect is unclear. | A report title is not its parameters. | AS 1105.10 |
| **ipe01-aging** Aging buckets are correct for selected invoices, recalculated from invoice date or due date to the as-of date | high | Recalculated days fall in the report's bucket. | Accuracy of the report (AS 1105.10). | Invoices; Report | Agree. | Disagree. | Invoices not provided. | Whether aging is from invoice or due date is not documented. | Do not assume the aging basis. | AS 1105.10, AS 1105.15-.20 |

### IPE-02

- Objective: The journal entry listing used for review and testing is complete.
- Type: detective; performer: The preparer of the listing; reviewer: Not described; trigger: Each quarter
- Population: The quarterly listings used.
- Sampling: Firm methodology table: 2 for a quarterly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each quarter, [the preparer of the listing] produces the listing of journal entries from the system with recorded parameters and agrees the net of the entries for each account to the change in that account's ledger balance for the period, before the listing is used for journal entry review or testing.
- Risk: Journal entry review or testing misses entries because the listing is incomplete.
- Assertions (AS 1105.11): Completeness, Existence or occurrence
- Design: detective, it dependent manual, quarterly; operator: [the preparer of the listing]; reviewer: None; owner: [the control owner for journal entries]
- Authority: The preparer must be able to explain differences.
- Judgment: low (The roll-forward is mechanical.)
- Precision: The net entries agree to each account's balance change exactly, or each difference is explained.
- Outliers: A difference is investigated and the listing rerun with corrected parameters.
- Information used: Journal entry listing: Entry, Account, Amount, Posted by, Posting date, Source
- Information used: Trial balance at the start and end of the period: Account, Balance, Date
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: The listing with its parameters and run date, and the roll-forward to the ledger with any differences explained.
- Client value: the preparer of the listing (role; does not hold testing). The operator.
- Client value: the control owner for journal entries (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect how the listing is extracted and reconciled. Walk one recent instance of a listing through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether the selected listing is complete. Agree total activity to the movement in the trial balance; inspect parameters for entities, sources, and dates. Tests: ipe02-activity, ipe02-scope.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of listings for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: ipe02-activity, ipe02-scope. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **ipe02-activity** The listing's total activity agrees to the movement in the trial balance for the period | high | Listing totals equal closing minus opening balances. | Completeness (AS 1105.10). | Listing; Trial balances | Agree. | Unreconciled difference. | Not provided. | Reconciling items need judgment. | Do not net debits and credits to zero as proof. | Control description, AS 1105.10 |
| **ipe02-scope** The listing covers every entity, journal source, and day in the period | high | Parameters include all entities, sources, and dates. | A filtered listing can reconcile and still miss sources. | Parameters | All included. | Something excluded. | Parameters not shown. | List of sources not provided. | Do not assume all sources. | Control description, AS 1105.10 |

### OTC-01

- Objective: Only approved, supported customers, limits, terms, and bank details are recorded.
- Type: preventive; performer: The person who enters the change; reviewer: credit management; trigger: A customer master change
- Population: Every customer master change in the period from the system change log.
- Sampling: Firm methodology table: 25 for an event-driven control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each customer master change (new customers, credit limits, payment terms, and bank details) is requested with [the support the control requires] and approved by [the approver of customer master changes] before [the role that maintains the data] makes it in [the financial system]. The maintainer is not the approver.
- Risk: A fictitious customer, an unapproved credit limit, or changed terms or bank details lead to sales that are not collectible or to misdirected refunds.
- Assertions (AS 1105.11): Existence or occurrence, Valuation or allocation
- Design: preventive, manual, event driven; operator: [the role that maintains the data]; reviewer: [the approver of customer master changes]; owner: [the control owner for credit]
- Authority: The approver must have authority over the data and must not make the change.
- Judgment: low (The approver checks a stated change against its support.)
- Precision: Every customer master change in the period, as listed from [the financial system]'s change log.
- Outliers: A change found without approval or support is reviewed with the approver and corrected if needed.
- Information used: Customer master change log from the system: Record, Field, Old value, New value, Changed by, Date
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: The request with its support and approval dated before the change, and [the financial system]'s change log.
- Client value: the financial system (system; does not hold testing). Where the transactions are recorded.
- Client value: the support the control requires (text; does not hold testing). What the approver checks the change against.
- Client value: the approver of customer master changes (role; does not hold testing). The reviewer.
- Client value: the role that maintains the data (role; does not hold testing). The operator.
- Client value: the control owner for credit (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the procedure for customer master changes and their approval. Walk one recent instance of a customer master change through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected customer master change was supported, approved before it was made, and entered as approved. For each selected change, inspect support and approval and compare them with the system's change record. Tests: otc01-support, otc01-approved, otc01-matches.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of customer master changes for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: otc01-approved, otc01-matches. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **otc01-support** The customer master change is supported by [the documents the control requires] | low | The required supporting documents exist and agree to the change. | The description requires support; what support is not stated. | Supporting documents | Required support agrees. | Support missing or disagrees. | Not provided. | What support is required is not defined. | Do not decide what support suffices. | Control description |
| **otc01-approved** The customer master change was approved by credit management before it was processed in the system | high | An approval by the required approver, dated before processing. | The control is preventive: approval must come first. | Approval; System record of the change or posting | Approved by the required approver before processing. | Missing, after processing, or by someone else. | Approval or processing date not provided. | Who may approve is not documented. | Do not assume authority from a title. | Control description, AS 2201.44-.45 |
| **otc01-matches** The customer master change in the system agrees to what was approved | high | Values in the system equal the approved values. | Approval covers only what was approved. | Approval; System record | They agree. | They differ. | System record not provided. | Values are described differently. | Do not infer system values from the approval. | Control description |

### OTC-02

- Objective: Revenue around period end is recorded in the period in which delivery occurs.
- Type: detective; performer: The preparer of the cutoff analysis; reviewer: The designated reviewer; trigger: Each period end
- Population: The quarter-end cutoff analyses in the period.
- Sampling: Firm methodology table: 2 for a quarterly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** At each quarter end, [the preparer] lists shipments and invoices in the [the number of days examined either side of period end] either side of period end from [the financial system], compares each invoice's period with its proof of delivery, and records an adjustment for revenue recognized in the wrong period above [the threshold for adjusting a cutoff difference]. [the reviewer] reviews the analysis and adjustments and signs it off.
- Risk: Revenue is recognized before control of the goods or services transfers to the customer.
- Assertions (AS 1105.11): Existence or occurrence, Completeness
- Design: detective, it dependent manual, quarterly; operator: [the preparer]; reviewer: [the reviewer]; owner: [the control owner for revenue]
- Authority: The reviewer must understand the account and the business well enough to judge an explanation, and must not have prepared the analysis.
- Judgment: high (Whether an explanation is adequate and corroborated is a judgment.)
- Precision: Every item above [the threshold for adjusting a cutoff difference] is investigated.
- Outliers: Each item above the threshold is explained with corroborating evidence, and a correcting entry is recorded where the explanation shows an error.
- Information used: Shipments and invoices around period end: Invoice, Amount, Invoice date, Shipment, Delivery date
- Information used: Proof of delivery: Shipment, Delivered on
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: The cutoff analysis with the listing's parameters, proof of delivery for the items examined, the adjustments, and the reviewer's sign-off.
- Client value: the financial system (system; does not hold testing). Where the transactions are recorded.
- Client value: the preparer (role; does not hold testing). The operator.
- Client value: the reviewer (role; does not hold testing). Must not be the preparer.
- Client value: the threshold for adjusting a cutoff difference (amount; testing waits for it). The control's precision: what must be investigated.
- Client value: the control owner for revenue (role; does not hold testing). Accountable for the control's design and operation.
- Client value: the number of days examined either side of period end (days; testing waits for it). Which transactions are compared.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the window around period end and the review. Walk one recent instance of a cutoff analysis through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether the analysis covered the window, differences were adjusted, and it was reviewed. Re-perform the comparison for selected shipments and invoices in the window; inspect adjustments and the sign-off. Tests: otc02-window, otc02-adjusted, otc02-reviewer.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of cutoff analyses for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: otc02-window, otc02-adjusted, otc02-reviewer. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **otc02-window** Every shipment and invoice meeting [the threshold or criteria for investigation the control sets] was identified by the reviewer | low | Items meeting the criteria in the underlying data all appear in the reviewer's investigation. | A review is only as precise as its criteria; without them it cannot be shown to detect a misstatement (KPMG Q5.10). | The control's criteria; Underlying data; Reviewer's analysis | Every qualifying item was flagged. | A qualifying item was not flagged. | The underlying data or the analysis is not provided. | The criteria are not defined. | Do not set a threshold; do not judge one adequate. | Control description, KPMG ICFR Handbook (2025) Q5.10-5.11, AS 1105.15-.20 |
| **otc02-adjusted** Each difference between shipment and invoice period the reviewer flagged was investigated, with an explanation supported by evidence and, where needed, a correction recorded | high | Each flagged item has a supported explanation or a correction. | Identification without investigation and resolution does not detect or correct a misstatement (KPMG Q5.11). | Explanations; Supporting documents; Adjusting entries | Every flagged item is explained with support or corrected. | An item unexplained, explained without support, or uncorrected. | Explanations or support not provided. | Whether an explanation is adequate is judgment. | An explanation is not corroborated because it is plausible. | Control description, KPMG ICFR Handbook (2025) Q5.10-5.11 |
| **otc02-reviewer** The cutoff analysis was signed off, with a date, by the reviewer the control designates, who is not its preparer | high | A dated sign-off by the designated reviewer, different from the preparer. | The control assigns the review; a review by the preparer is not a review. | Sign-off; Who prepared it; Designated reviewer or delegation of authority | Signed by the designated reviewer, not the preparer. | No sign-off, or signed by the preparer or someone not designated. | No sign-off provided, or no record of who is designated. | The designated reviewer is not documented. | A sign-off is evidence of review, not of what the reviewer checked. | Control description, AS 2201.44-.45 |

### OTC-03

- Objective: Unapplied cash and receipt differences are resolved each week.
- Type: detective; performer: Accounts receivable; reviewer: The designated reviewer; trigger: Each week
- Population: The weekly unapplied cash reviews in the period.
- Sampling: Firm methodology table: 5 for a weekly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each week, [the preparer] reviews the unapplied cash report from [the financial system] and the differences between receipts and the invoices they pay. Items older than [the age at which an unapplied item must be investigated] or above [the threshold for investigating an unapplied item] are investigated and applied, refunded, or written off with approval. [the reviewer] reviews the report and signs it off.
- Risk: Receipts are applied to the wrong customer or invoice, or left unapplied, so receivables and the allowance are misstated.
- Assertions (AS 1105.11): Existence or occurrence, Valuation or allocation
- Design: detective, it dependent manual, weekly; operator: [the preparer]; reviewer: [the reviewer]; owner: [the control owner for cash application]
- Authority: The reviewer must understand the account and the business well enough to judge an explanation, and must not have prepared the analysis.
- Judgment: high (Whether an explanation is adequate and corroborated is a judgment.)
- Precision: Every item above [the threshold for investigating an unapplied item] is investigated.
- Outliers: Each item above the threshold is explained with corroborating evidence, and a correcting entry is recorded where the explanation shows an error.
- Information used: Unapplied cash report: Receipt, Customer, Amount, Date received
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: The week's unapplied cash report with the investigation of each item and the reviewer's sign-off.
- Client value: the financial system (system; does not hold testing). Where the transactions are recorded.
- Client value: the preparer (role; does not hold testing). The operator.
- Client value: the reviewer (role; does not hold testing). Must not be the preparer.
- Client value: the threshold for investigating an unapplied item (amount; testing waits for it). The control's precision: what must be investigated.
- Client value: the control owner for cash application (role; does not hold testing). Accountable for the control's design and operation.
- Client value: the age at which an unapplied item must be investigated (days; testing waits for it). The control's precision for small items.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the unapplied cash report, its threshold, and the review. Walk one recent instance of a weekly review through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether the report used was complete, aged items were investigated, and the review is evidenced. Agree the report's total to unapplied cash in the ledger; re-perform the selection of items over the threshold; inspect follow-up and sign-off. Tests: otc03-report, otc03-aged, otc03-resolved, otc03-reviewer.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of weekly reviews for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: otc03-report, otc03-aged, otc03-resolved, otc03-reviewer. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **otc03-report** The unapplied cash report the reviewer used agrees to the unapplied cash balance in the ledger at the same date | moderate | Report total equals the ledger's unapplied cash. | The review relies on system information; an incomplete report hides items (KPMG ch. 6). | Report; Ledger balance | Agree. | Unreconciled difference. | Not provided. | Timing differences. | A report's existence is not its completeness. | KPMG ICFR Handbook (2025) ch. 6, Q6.4.70, AS 1105.10 |
| **otc03-aged** Every unapplied item meeting [the threshold or criteria for investigation the control sets] was identified by the reviewer | low | Items meeting the criteria in the underlying data all appear in the reviewer's investigation. | A review is only as precise as its criteria; without them it cannot be shown to detect a misstatement (KPMG Q5.10). | The control's criteria; Underlying data; Reviewer's analysis | Every qualifying item was flagged. | A qualifying item was not flagged. | The underlying data or the analysis is not provided. | The criteria are not defined. | Do not set a threshold; do not judge one adequate. | Control description, KPMG ICFR Handbook (2025) Q5.10-5.11, AS 1105.15-.20 |
| **otc03-resolved** Each unapplied item the reviewer flagged was investigated, with an explanation supported by evidence and, where needed, a correction recorded | high | Each flagged item has a supported explanation or a correction. | Identification without investigation and resolution does not detect or correct a misstatement (KPMG Q5.11). | Explanations; Supporting documents; Adjusting entries | Every flagged item is explained with support or corrected. | An item unexplained, explained without support, or uncorrected. | Explanations or support not provided. | Whether an explanation is adequate is judgment. | An explanation is not corroborated because it is plausible. | Control description, KPMG ICFR Handbook (2025) Q5.10-5.11 |
| **otc03-reviewer** The weekly review was signed off, with a date, by the reviewer the control designates, who is not its preparer | high | A dated sign-off by the designated reviewer, different from the preparer. | The control assigns the review; a review by the preparer is not a review. | Sign-off; Who prepared it; Designated reviewer or delegation of authority | Signed by the designated reviewer, not the preparer. | No sign-off, or signed by the preparer or someone not designated. | No sign-off provided, or no record of who is designated. | The designated reviewer is not documented. | A sign-off is evidence of review, not of what the reviewer checked. | Control description, AS 2201.44-.45 |

Retired from version 2:

- "The unapplied cash report was reviewed": Replaced by what the review must show: the report's reliability, the items identified, and their resolution.

### OTC-04

- Objective: Credit memos above the threshold are approved at the required level before they are issued.
- Type: preventive; performer: Billing; reviewer: Management at the required level; trigger: A credit memo above the threshold
- Population: Credit memos above the threshold in the period.
- Sampling: Firm methodology table: 25 for an event-driven control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each credit memo above [the credit memo threshold] is approved in [the financial system] before it is issued by the approver [the credit memo approval matrix] requires for its amount. The approver checks the reason and the amount against the original invoice and the customer's claim.
- Risk: Credits are issued without valid reason or authority, understating revenue or concealing misappropriated receipts.
- Assertions (AS 1105.11): Existence or occurrence, Valuation or allocation
- Design: preventive, manual, event driven; operator: Billing; reviewer: The approver [the credit memo approval matrix] requires; owner: [the control owner for credit memos]
- Authority: The approver must hold the level [the credit memo approval matrix] sets for the amount and must not have raised the credit.
- Judgment: moderate (Whether the reason is valid is a judgment.)
- Precision: Every credit memo above [the credit memo threshold] in the period.
- Outliers: A memo issued without approval is reviewed and, if invalid, reversed.
- Information used: Credit memo listing: Memo, Customer, Amount, Reason, Issued on, Approver
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: The credit memo with its reason, the original invoice, and the approval dated before issue.
- Client value: the financial system (system; does not hold testing). Where the transactions are recorded.
- Client value: the credit memo threshold (amount; testing waits for it). Which memos need approval.
- Client value: the credit memo approval matrix (text; testing waits for it). Who may approve which amount.
- Client value: the control owner for credit memos (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the approval matrix and threshold. Walk one recent instance of a credit memo through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected credit memo had a reason and was approved at the required level, for the amount issued. Inspect reason, approval, approver level per the matrix, and amounts. Tests: otc04-reason, otc04-before, otc04-level, otc04-amount.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of credit memos for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: otc04-reason, otc04-before, otc04-amount. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **otc04-reason** The credit memo records a reason | moderate | A reason is documented. | An approver cannot judge a credit without its reason. | Credit memo or request | A reason is recorded. | No reason. | Not provided. | Reason is a code without meaning. | Do not judge the reason's validity. | Professional inference |
| **otc04-before** The credit memo was approved before it was issued | high | Every selected credit memo in the control's population. | The control description requires approval before issue; an approval after issue does not prevent an unauthorized credit. | Approval record; Credit memo with its issue date | An approval exists and is dated on or before the issue date. | No approval, or the approval is dated after the issue date. | The approval or either date is not provided. | The approval is undated, or the dates conflict between records. | Do not treat a memo being issued as evidence it was approved. | Control description, AS 2201.44-.45 |
| **otc04-level** The approver held the level the approval matrix requires for the credit memo amount | low | Every selected credit memo, once the matrix is known. | The description requires approval at the appropriate level; the levels are set by the client's matrix, which the library does not know. | Approval; Approval matrix in force at the approval date | The approver's level meets the matrix for the amount. | The approver's level is below the matrix level for the amount. | No matrix, or no evidence of the approver's level. | The matrix or the credit memo threshold is not provided. | Do not assume a level from a job title. | Control description, AS 2201.44-.45 |
| **otc04-amount** The credit memo amount in the system agrees to what was approved | high | Values in the system equal the approved values. | Approval covers only what was approved. | Approval; System record | They agree. | They differ. | System record not provided. | Values are described differently. | Do not infer system values from the approval. | Control description |

### PTP-01

- Objective: Only approved vendors and bank details are recorded, and bank changes are confirmed with the vendor.
- Type: preventive; performer: Vendor master data; reviewer: Someone independent of purchasing and payments; trigger: A new vendor or a vendor bank change
- Population: Vendor master changes in the period from the system change log.
- Sampling: Firm methodology table: 25 for an event-driven control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each new vendor and each change to a vendor's bank details is requested with [the support the control requires] and approved by [the approver of vendor changes], who works in neither purchasing nor payments, before [the role that maintains vendors] makes it in [the financial system]. Each bank detail change is first confirmed with the vendor by calling a contact number already on file.
- Risk: A fictitious vendor is created, or a vendor's bank details are changed so payments go to a fraudster.
- Assertions (AS 1105.11): Existence or occurrence
- Design: preventive, manual, event driven; operator: [the role that maintains vendors]; reviewer: [the approver of vendor changes]; owner: [the control owner for vendor master data]
- Authority: The approver must be independent of purchasing and payments.
- Judgment: low (The approver checks a stated change against support and the call-back.)
- Precision: Every new vendor and bank detail change in the period, from [the financial system]'s change log.
- Outliers: A change without approval or call-back is frozen until verified with the vendor.
- Information used: Vendor master change log: Vendor, Field, Old value, New value, Changed by, Date
- Information used: Call-back record: Vendor, Number called, Person confirming, Date
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: The request with support, the call-back record, the approval dated before the change, and the change log.
- Client value: the financial system (system; does not hold testing). Where the transactions are recorded.
- Client value: the support the control requires (text; does not hold testing). What the approver checks.
- Client value: the approver of vendor changes (role; does not hold testing). Must work in neither purchasing nor payments.
- Client value: the role that maintains vendors (role; does not hold testing). The operator.
- Client value: the control owner for vendor master data (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the vendor procedure, approvers, and call-back. Walk one recent instance of a vendor change through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected change was supported, independently approved before it was made, and, for bank details, confirmed by call-back. Inspect support and approval; compare the approver's role with purchasing and payments; inspect the call-back record and the number used. Tests: ptp01-support, ptp01-approved, ptp01-callback.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of vendor changes for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: ptp01-approved, ptp01-callback. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **ptp01-support** The vendor change is supported by [the documents the control requires] | low | The required supporting documents exist and agree to the change. | The description requires support; what support is not stated. | Supporting documents | Required support agrees. | Support missing or disagrees. | Not provided. | What support is required is not defined. | Do not decide what support suffices. | Control description |
| **ptp01-approved** The change was approved, before it was made, by someone who works in neither purchasing nor payments | high | Approver's role is outside purchasing and payments; approval first. | The description requires independent approval. | Approval; Approver's role; Change record | Independent and before. | Not independent, or after. | Approver's role not provided. | Role boundaries unclear. | Do not infer independence from a title. | Control description |
| **ptp01-callback** A bank detail change was confirmed with the vendor by calling a contact number already on file, not one given in the change request | high | A call-back record with a number from existing vendor records. | The description requires call-back on known contact details. | Call-back record; Vendor contact on file | Confirmed using a known number. | No call-back, or a number from the request. | No call-back record. | The record does not show the number used. | An email reply is not a call-back. | Control description |

### PTP-02

- Objective: Purchase orders are approved within the delegation of authority before they are sent.
- Type: preventive; performer: The system workflow and approvers; reviewer: Approvers per the delegation of authority; trigger: A purchase order
- Population: Purchase orders in the period from the system.
- Sampling: Firm methodology table: 25 for an event-driven control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each purchase order is approved in [the financial system] by the approvers [the delegation of authority] requires for its amount and category before it is sent to the vendor; [the financial system] routes the order for approval and does not release it until approved.
- Risk: Goods or services are bought without authority.
- Assertions (AS 1105.11): Existence or occurrence
- Design: preventive, it dependent manual, event driven; operator: The approvers [the delegation of authority] requires; reviewer: None: the approval is the control; owner: [the control owner for purchasing]
- Authority: Each approver must hold the authority [the delegation of authority] sets for the amount.
- Judgment: low (The approver confirms a business need within their authority.)
- Precision: Every purchase order released in the period.
- Outliers: An order released without the required approval is investigated and the workflow corrected.
- Information used: Purchase order approval workflow configuration: Release strategy, Amount bands, Approvers
- Information used: Purchase order listing: Order, Amount, Approver, Approved on, Sent on
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: The order's approval history in [the financial system] and the workflow configuration.
- Applies when: If [the financial system]'s workflow enforces [the delegation of authority] so an order cannot be released without the right approval, the control is tested as an application control: the configuration, and one order showing it operated.
- Client value: the financial system (system; does not hold testing). Where the transactions are recorded.
- Client value: the delegation of authority (text; does not hold testing). Who may approve which amount.
- Client value: the control owner for purchasing (role; does not hold testing). Accountable for the control's design and operation.
- **Design to confirm:** Approval 'in the system' suggests a configured workflow. If the workflow enforces the delegation of authority, test it as an application control (configuration and one instance) rather than a sample.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the workflow and delegation of authority. Walk one recent instance of a purchase order through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected order was approved within authority before it was issued. Inspect the approval history against the delegation of authority and the issue date. Tests: ptp02-before, ptp02-authority.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of purchase orders for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: ptp02-before, ptp02-authority. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **ptp02-before** The purchase order was approved before it was issued to the vendor | high | Approval date before issue date. | The description requires approval before sending. | Approval history; Issue record | Before. | After or missing. | Dates missing. | Issue date not recorded. | Do not use creation date as issue date. | Control description |
| **ptp02-authority** The approver's limit in the delegation of authority covers the order's amount | high | Approver's limit is at least the order amount. | The description requires approval within authority. | Delegation of authority; Approval | Within limit. | Over limit. | No delegation of authority. | Order split to stay under limits. | Do not assume limits. | Control description, AS 2201.44-.45 |

### PTP-03

- Objective: Liabilities for goods and services received by period end are recorded.
- Type: detective; performer: The preparer of the accrual analysis; reviewer: The designated reviewer; trigger: Each period end
- Population: Quarter-end accrual analyses.
- Sampling: Firm methodology table: 2 for a quarterly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** At each quarter end, [the preparer] reviews goods received not invoiced from [the financial system] and invoices received in the [the number of days after period end examined] after period end, identifies liabilities for the period above [the threshold for recording an accrual], and records accruals for them. [the reviewer] reviews the analysis and the accruals and signs it off.
- Risk: Liabilities for goods or services received by period end are not recorded.
- Assertions (AS 1105.11): Completeness, Valuation or allocation
- Design: detective, it dependent manual, quarterly; operator: [the preparer]; reviewer: [the reviewer]; owner: [the control owner for accruals]
- Authority: The reviewer must understand the account and the business well enough to judge an explanation, and must not have prepared the analysis.
- Judgment: high (Whether an explanation is adequate and corroborated is a judgment.)
- Precision: Every item above [the threshold for recording an accrual] is investigated.
- Outliers: Each item above the threshold is explained with corroborating evidence, and a correcting entry is recorded where the explanation shows an error.
- Information used: Goods received not invoiced report: Purchase order, Receipt date, Amount
- Information used: Invoices received after period end: Invoice, Service period, Amount, Received on
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: The analysis with the reports' parameters, the accruals recorded, and the reviewer's sign-off.
- Client value: the financial system (system; does not hold testing). Where the transactions are recorded.
- Client value: the preparer (role; does not hold testing). The operator.
- Client value: the reviewer (role; does not hold testing). Must not be the preparer.
- Client value: the threshold for recording an accrual (amount; testing waits for it). The control's precision: what must be investigated.
- Client value: the control owner for accruals (role; does not hold testing). Accountable for the control's design and operation.
- Client value: the number of days after period end examined (days; testing waits for it). Which subsequent invoices are reviewed.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect its sources, search period, and threshold. Walk one recent instance of an accrual review through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether qualifying items were identified and accrued, and the review was signed off. Re-perform the identification from received-not-invoiced balances and subsequent invoices over the threshold; inspect accrual entries and sign-off. Tests: ptp03-identified, ptp03-accrued, ptp03-reviewer.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of accrual reviews for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: ptp03-identified, ptp03-accrued, ptp03-reviewer. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **ptp03-identified** Every received-not-invoiced balance and subsequent invoice meeting [the threshold or criteria for investigation the control sets] was identified by the reviewer | low | Items meeting the criteria in the underlying data all appear in the reviewer's investigation. | A review is only as precise as its criteria; without them it cannot be shown to detect a misstatement (KPMG Q5.10). | The control's criteria; Underlying data; Reviewer's analysis | Every qualifying item was flagged. | A qualifying item was not flagged. | The underlying data or the analysis is not provided. | The criteria are not defined. | Do not set a threshold; do not judge one adequate. | Control description, KPMG ICFR Handbook (2025) Q5.10-5.11, AS 1105.15-.20 |
| **ptp03-accrued** Each item belonging to the period the reviewer flagged was investigated, with an explanation supported by evidence and, where needed, a correction recorded | high | Each flagged item has a supported explanation or a correction. | Identification without investigation and resolution does not detect or correct a misstatement (KPMG Q5.11). | Explanations; Supporting documents; Adjusting entries | Every flagged item is explained with support or corrected. | An item unexplained, explained without support, or uncorrected. | Explanations or support not provided. | Whether an explanation is adequate is judgment. | An explanation is not corroborated because it is plausible. | Control description, KPMG ICFR Handbook (2025) Q5.10-5.11 |
| **ptp03-reviewer** The accrual analysis was signed off, with a date, by the reviewer the control designates, who is not its preparer | high | A dated sign-off by the designated reviewer, different from the preparer. | The control assigns the review; a review by the preparer is not a review. | Sign-off; Who prepared it; Designated reviewer or delegation of authority | Signed by the designated reviewer, not the preparer. | No sign-off, or signed by the preparer or someone not designated. | No sign-off provided, or no record of who is designated. | The designated reviewer is not documented. | A sign-off is evidence of review, not of what the reviewer checked. | Control description, AS 2201.44-.45 |

### PTP-04

- Objective: Only reviewed payment runs approved by two authorized people are released.
- Type: preventive; performer: Treasury or accounts payable; reviewer: Two authorized approvers; trigger: Each payment run
- Population: Payment runs in the period.
- Sampling: Firm methodology table: 5 for a weekly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Before each payment run is released to the bank, [the reviewer of payment proposals] reviews the proposal from [the financial system] against [what the reviewer checks], and two people authorized under [the bank mandate] approve it in [the banking portal].
- Risk: Unauthorized, duplicate, or incorrect payments are made.
- Assertions (AS 1105.11): Existence or occurrence
- Design: preventive, manual, weekly; operator: [the reviewer of payment proposals]; reviewer: Two approvers authorized under [the bank mandate]; owner: [the control owner for payments]
- Authority: Approvers must be authorized under [the bank mandate]; the reviewer must not have prepared the run.
- Judgment: moderate (Spotting an unusual payment in a run is a judgment.)
- Precision: Every payment run released in the period, with the checks in [what the reviewer checks].
- Outliers: A payment questioned in review is removed from the run until resolved.
- Information used: Payment proposal: Vendor, Amount, Bank account, Invoice
- Information used: Bank approval record: Run, Approvers, Approved on, Released on
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: The reviewed proposal and the bank portal's record of both approvals before release.
- Client value: the financial system (system; does not hold testing). Where the transactions are recorded.
- Client value: the reviewer of payment proposals (role; does not hold testing). The operator.
- Client value: what the reviewer checks (text; does not hold testing). The control's precision.
- Client value: the bank mandate (text; does not hold testing). Who may approve payments.
- Client value: the banking portal (system; does not hold testing). Where approvals are recorded.
- Client value: the control owner for payments (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the approval procedure and the bank mandate. Walk one recent instance of a payment run through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected run was reviewed and approved by two authorized people before release, for the amount released. Inspect the proposal review, the two approvals against the mandate, and the bank release amount. Tests: ptp04-reviewed, ptp04-two, ptp04-amount.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of payment runs for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: ptp04-reviewed, ptp04-two, ptp04-amount. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **ptp04-reviewed** The payment proposal shows evidence of review against [what the procedure requires the reviewer to check] | low | Review evidence covering the procedure's checks. | The description requires review; what is checked is not stated. | Reviewed proposal | Reviewed as required. | No review. | Not provided. | Required checks not defined. | A signature is not evidence of the checks. | Control description |
| **ptp04-two** Two people authorized under the bank mandate approved the run before it was released to the bank | high | Two distinct authorized approvers, before release. | The description requires two authorized approvers. | Approvals; Bank mandate; Release time | Two authorized, before release. | Fewer, unauthorized, or after. | Mandate or approvals missing. | Approvals inside the bank portal not visible. | Two clicks by the same person are one approval. | Control description |
| **ptp04-amount** The amount released to the bank in the system agrees to what was approved | high | Values in the system equal the approved values. | Approval covers only what was approved. | Approval; System record | They agree. | They differ. | System record not provided. | Values are described differently. | Do not infer system values from the approval. | Control description |

### RTR-01

- Objective: Manual journal entries above the threshold are reviewed and approved by someone other than the preparer, against support.
- Type: preventive; performer: The preparer; reviewer: An approver other than the preparer, within authority; trigger: A manual entry above the threshold
- Population: Manual journal entries above the threshold, from the journal listing (IPE-02).
- Sampling: Firm methodology table: 25 for an event-driven control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each manual journal entry above [the journal entry review threshold] is approved in [the financial system] before posting by [the journal entry approver], who is not the preparer and whose authority under [the journal entry authority matrix] covers the amount. The approver checks the entry against [the support the control requires] for accuracy, account coding, and period.
- Risk: Erroneous or fraudulent journal entries are posted.
- Assertions (AS 1105.11): Existence or occurrence, Valuation or allocation, Presentation and disclosure
- Design: preventive, manual, event driven; operator: The preparer; reviewer: [the journal entry approver]; owner: [the control owner for journal entries]
- Authority: The approver must not be the preparer and must hold authority for the amount.
- Judgment: moderate (Judging whether support justifies the entry and its coding.)
- Precision: Every manual journal entry above [the journal entry review threshold] in the period.
- Outliers: An entry posted without approval is reviewed and reversed if unsupported.
- Information used: Manual journal entry listing (report control IPE-02): Entry, Amount, Preparer, Approver, Posting date
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: Each entry with its support and the approval recorded before posting.
- Client value: the financial system (system; does not hold testing). Where the transactions are recorded.
- Client value: the journal entry review threshold (amount; testing waits for it). Which entries need approval.
- Client value: the support the control requires (text; does not hold testing). What the approver checks the entry against.
- Client value: the journal entry approver (role; does not hold testing). Must not be the preparer.
- Client value: the journal entry authority matrix (text; does not hold testing). Who may approve which amount.
- Client value: the control owner for journal entries (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the threshold, support required, and approver authority. Walk one recent instance of a manual entry through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected entry has support and was approved by an authorized person other than the preparer. Inspect support, compare preparer and approver user IDs, and the approver's authority for the amount. Tests: rtr01-support, rtr01-not-preparer, rtr01-authority.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of manual journal entries for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: rtr01-support, rtr01-not-preparer, rtr01-authority. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **rtr01-support** The journal entry is supported by [the documents the control requires] | low | The required supporting documents exist and agree to the change. | The description requires support; what support is not stated. | Supporting documents | Required support agrees. | Support missing or disagrees. | Not provided. | What support is required is not defined. | Do not decide what support suffices. | Control description |
| **rtr01-not-preparer** The approver is a different user from the preparer | high | Approver ID differs from preparer ID. | The description requires someone other than the preparer. | Entry with preparer and approver | Different. | Same. | IDs not shown. | Shared accounts. | Different names on paper do not prove different users in the system. | Control description |
| **rtr01-authority** The approver's authority in the authority matrix covers the entry's amount | high | Approver's limit is at least the amount. | The description requires an authorized approver. | Authority matrix | Within. | Over. | No matrix. | Matrix not provided. | Do not assume limits. | Control description, AS 2201.44-.45 |

### RTR-02

- Objective: Key balance sheet accounts agree to supporting detail each month, and reconciling items are resolved.
- Type: detective; performer: The preparer; reviewer: A reviewer other than the preparer; trigger: Each month end
- Population: Key account reconciliations per month.
- Sampling: Firm methodology table: 2 for a monthly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each month, [the preparer] reconciles each key balance sheet account in [the financial system] to its supporting detail or subledger by [the reconciliation deadline]. Reconciling items above [the threshold for investigating reconciling items] are investigated and cleared or explained, and [the reviewer] reviews and signs off the reconciliation.
- Risk: Balance sheet accounts include errors or unsupported balances that go undetected.
- Assertions (AS 1105.11): Existence or occurrence, Completeness, Valuation or allocation
- Design: detective, manual, monthly; operator: [the preparer]; reviewer: [the reviewer]; owner: [the control owner for account reconciliations]
- Authority: The reviewer must not have prepared the reconciliation and must be able to judge whether reconciling items are valid.
- Judgment: moderate (Whether a reconciling item is valid and timely is a judgment.)
- Precision: The account agrees, and every reconciling item above [the threshold for investigating reconciling items] is explained.
- Outliers: Each reconciling item is cleared, explained with support, or corrected by an entry; aged items are escalated.
- Information used: Trial balance: Account, Balance, Date
- Information used: Subledger or supporting detail: Item, Amount, Date
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: The signed reconciliation with its supporting detail, the reconciling items and their support, and the review date.
- Client value: the financial system (system; does not hold testing). Where the transactions are recorded.
- Client value: the preparer (role; does not hold testing). The operator.
- Client value: the reviewer (role; does not hold testing). Must not be the preparer.
- Client value: the reconciliation deadline (period; does not hold testing). When a month's reconciliation counts as late.
- Client value: the threshold for investigating reconciling items (amount; testing waits for it). The control's precision.
- Client value: the control owner for account reconciliations (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the reconciliation policy: deadlines and item clearing. Walk one recent instance of a reconciliation through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected reconciliation agrees, its items are resolved, and it was prepared and reviewed on time by different people. Agree balances; inspect reconciling items' support and age; compare dates with the deadline and preparer with reviewer. Tests: rtr02-agrees, rtr02-items, rtr02-reviewer, rtr02-timely.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of reconciliations for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: rtr02-agrees, rtr02-items, rtr02-reviewer. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **rtr02-agrees** The reconciliation's ledger balance agrees to the general ledger, and its supporting balance to the supporting detail, at the month end | high | Ledger and supporting balances agree, or differences are reconciled. | Agreement to an independent balance is what the control does. | The reconciliation or analysis; The ledger or external balance | They agree, or differences are reconciled. | Unreconciled difference. | A balance is missing. | Reconciling items need judgment. | A balance typed onto the reconciliation is not the ledger. | Control description, AS 1105.15-.20 |
| **rtr02-items** Each reconciling item the reviewer flagged was investigated, with an explanation supported by evidence and, where needed, a correction recorded | high | Each flagged item has a supported explanation or a correction. | Identification without investigation and resolution does not detect or correct a misstatement (KPMG Q5.11). | Explanations; Supporting documents; Adjusting entries | Every flagged item is explained with support or corrected. | An item unexplained, explained without support, or uncorrected. | Explanations or support not provided. | Whether an explanation is adequate is judgment. | An explanation is not corroborated because it is plausible. | Control description, KPMG ICFR Handbook (2025) Q5.10-5.11 |
| **rtr02-reviewer** The reconciliation was signed off, with a date, by the reviewer the control designates, who is not its preparer | high | A dated sign-off by the designated reviewer, different from the preparer. | The control assigns the review; a review by the preparer is not a review. | Sign-off; Who prepared it; Designated reviewer or delegation of authority | Signed by the designated reviewer, not the preparer. | No sign-off, or signed by the preparer or someone not designated. | No sign-off provided, or no record of who is designated. | The designated reviewer is not documented. | A sign-off is evidence of review, not of what the reviewer checked. | Control description, AS 2201.44-.45 |
| **rtr02-timely** The reconciliation was prepared and reviewed by [the deadline in the reconciliation policy] | low | Dates within the deadline. | Late reconciliations detect late. | Policy; Dates | Within. | Late. | Dates missing. | Deadline not defined. | Do not assume a deadline. | Control description |

### RTR-03

- Objective: Unusual changes in results are identified and explained with corroboration.
- Type: detective; performer: Finance; reviewer: The designated reviewer; trigger: Each quarter
- Population: Quarterly flux analyses.
- Sampling: Firm methodology table: 2 for a quarterly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each quarter, [the preparer] compares each financial statement line in [the financial system] with the prior period and budget, and explains every change above [the threshold for explaining a change] with corroborating evidence. [the reviewer] reviews the explanations and signs off.
- Risk: Misstatements causing unusual changes in results go undetected.
- Assertions (AS 1105.11): Existence or occurrence, Completeness, Valuation or allocation
- Design: detective, it dependent manual, quarterly; operator: [the preparer]; reviewer: [the reviewer]; owner: [the control owner for financial reporting]
- Authority: The reviewer must understand the account and the business well enough to judge an explanation, and must not have prepared the analysis.
- Judgment: high (Whether an explanation is adequate and corroborated is a judgment.)
- Precision: Every item above [the threshold for explaining a change] is investigated.
- Outliers: Each item above the threshold is explained with corroborating evidence, and a correcting entry is recorded where the explanation shows an error.
- Information used: Financial statement lines for the period, prior period, and budget: Line, Actual, Prior, Budget
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: The analysis with explanations and their corroboration, and the reviewer's sign-off.
- Client value: the financial system (system; does not hold testing). Where the transactions are recorded.
- Client value: the preparer (role; does not hold testing). The operator.
- Client value: the reviewer (role; does not hold testing). Must not be the preparer.
- Client value: the threshold for explaining a change (amount; testing waits for it). The control's precision: what must be investigated.
- Client value: the control owner for financial reporting (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the comparison basis and threshold. Walk one recent instance of a flux review through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether every change over the threshold was identified and explained with corroboration, and the analysis was reviewed. Re-perform the comparison to prior period and budget; compare changes over the threshold with those explained; inspect corroboration and sign-off. Tests: rtr03-identified, rtr03-explained, rtr03-reviewer.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of flux analyses for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: rtr03-identified, rtr03-explained, rtr03-reviewer. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **rtr03-identified** Every change against prior period or budget meeting [the threshold or criteria for investigation the control sets] was identified by the reviewer | low | Items meeting the criteria in the underlying data all appear in the reviewer's investigation. | A review is only as precise as its criteria; without them it cannot be shown to detect a misstatement (KPMG Q5.10). | The control's criteria; Underlying data; Reviewer's analysis | Every qualifying item was flagged. | A qualifying item was not flagged. | The underlying data or the analysis is not provided. | The criteria are not defined. | Do not set a threshold; do not judge one adequate. | Control description, KPMG ICFR Handbook (2025) Q5.10-5.11, AS 1105.15-.20 |
| **rtr03-explained** Each change over the threshold the reviewer flagged was investigated, with an explanation supported by evidence and, where needed, a correction recorded | high | Each flagged item has a supported explanation or a correction. | Identification without investigation and resolution does not detect or correct a misstatement (KPMG Q5.11). | Explanations; Supporting documents; Adjusting entries | Every flagged item is explained with support or corrected. | An item unexplained, explained without support, or uncorrected. | Explanations or support not provided. | Whether an explanation is adequate is judgment. | An explanation is not corroborated because it is plausible. | Control description, KPMG ICFR Handbook (2025) Q5.10-5.11 |
| **rtr03-reviewer** The flux analysis was signed off, with a date, by the reviewer the control designates, who is not its preparer | high | A dated sign-off by the designated reviewer, different from the preparer. | The control assigns the review; a review by the preparer is not a review. | Sign-off; Who prepared it; Designated reviewer or delegation of authority | Signed by the designated reviewer, not the preparer. | No sign-off, or signed by the preparer or someone not designated. | No sign-off provided, or no record of who is designated. | The designated reviewer is not documented. | A sign-off is evidence of review, not of what the reviewer checked. | Control description, AS 2201.44-.45 |

### RTR-04

- Objective: Intercompany balances eliminate and the consolidation, including translation, is correct.
- Type: detective; performer: Group reporting; reviewer: The designated reviewer; trigger: Each period end
- Population: Quarterly consolidations.
- Sampling: Firm methodology table: 2 for a quarterly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** At each quarter end, [the preparer] prepares the consolidation in [the consolidation system], agrees intercompany balances between entities in [the financial system] and investigates differences above [the threshold for investigating an intercompany difference], and checks currency translation at the period's rates. [the reviewer] reviews the consolidation, eliminations, and translation and signs off.
- Risk: Intercompany balances are not eliminated, or foreign operations are translated incorrectly.
- Assertions (AS 1105.11): Existence or occurrence, Valuation or allocation, Presentation and disclosure
- Design: detective, it dependent manual, quarterly; operator: [the preparer]; reviewer: [the reviewer]; owner: [the control owner for consolidation]
- Authority: The reviewer must understand the account and the business well enough to judge an explanation, and must not have prepared the analysis.
- Judgment: high (Whether an explanation is adequate and corroborated is a judgment.)
- Precision: Every item above [the threshold for investigating an intercompany difference] is investigated.
- Outliers: Each item above the threshold is explained with corroborating evidence, and a correcting entry is recorded where the explanation shows an error.
- Information used: Intercompany balance report: Entity, Counterparty, Balance
- Information used: Exchange rate table: Currency, Rate, Date
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: The consolidation package with intercompany reconciliations, the rates used, and the reviewer's sign-off.
- Client value: the financial system (system; does not hold testing). Where the transactions are recorded.
- Client value: the preparer (role; does not hold testing). The operator.
- Client value: the reviewer (role; does not hold testing). Must not be the preparer.
- Client value: the threshold for investigating an intercompany difference (amount; testing waits for it). The control's precision: what must be investigated.
- Client value: the control owner for consolidation (role; does not hold testing). Accountable for the control's design and operation.
- Client value: the consolidation system (system; does not hold testing). Where the consolidation is prepared.
- Question: What does the consolidation reviewer check, and at what tolerance?

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect what the reviewer checks and tolerances. Walk one recent instance of a consolidation through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether intercompany balances agree, eliminations and translation are correct, and the consolidation was reviewed. Agree intercompany pairs; recalculate selected eliminations and translations; inspect the sign-off. Tests: rtr04-intercompany, rtr04-recalculated, rtr04-reviewer.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of consolidations for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: rtr04-intercompany, rtr04-reviewer. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **rtr04-intercompany** Intercompany balances agree between the entities, or differences are resolved before elimination | high | Intercompany pairs agree, or differences are reconciled. | Agreement to an independent balance is what the control does. | The reconciliation or analysis; The ledger or external balance | They agree, or differences are reconciled. | Unreconciled difference. | A balance is missing. | Reconciling items need judgment. | A balance typed onto the reconciliation is not the ledger. | Control description, AS 1105.15-.20 |
| **rtr04-recalculated** Selected eliminations and currency translations recalculate correctly | moderate | Recalculation equals the recorded amounts. | Recording them correctly is the control's purpose. | Package; Rates | Equal. | Different. | Rates or package missing. | Complex translation (hyperinflation, step acquisitions). | Do not judge accounting policy. | Control description, AS 1105.15-.20 |
| **rtr04-reviewer** The consolidation was signed off, with a date, by the reviewer the control designates, who is not its preparer | high | A dated sign-off by the designated reviewer, different from the preparer. | The control assigns the review; a review by the preparer is not a review. | Sign-off; Who prepared it; Designated reviewer or delegation of authority | Signed by the designated reviewer, not the preparer. | No sign-off, or signed by the preparer or someone not designated. | No sign-off provided, or no record of who is designated. | The designated reviewer is not documented. | A sign-off is evidence of review, not of what the reviewer checked. | Control description, AS 2201.44-.45 |

### TRS-01

- Objective: Cash agrees to the bank each month and reconciling items are resolved.
- Type: detective; performer: Treasury or accounting; reviewer: A reviewer other than the preparer; trigger: Each month end
- Population: Bank account reconciliations per month.
- Sampling: Firm methodology table: 2 for a monthly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each month, [the preparer] reconciles each bank account's ledger balance in [the financial system] to the bank statement by [the reconciliation deadline]. Reconciling items above [the threshold for investigating reconciling items] are investigated and cleared or explained, and [the reviewer] reviews and signs off the reconciliation.
- Risk: Cash is misstated, or unauthorized payments go undetected.
- Assertions (AS 1105.11): Existence or occurrence, Completeness
- Design: detective, manual, monthly; operator: [the preparer]; reviewer: [the reviewer]; owner: [the control owner for bank reconciliations]
- Authority: The reviewer must not have prepared the reconciliation and must be able to judge whether reconciling items are valid.
- Judgment: moderate (Whether a reconciling item is valid and timely is a judgment.)
- Precision: The bank balance agrees, and every reconciling item above [the threshold for investigating reconciling items] is explained.
- Outliers: Each reconciling item is cleared, explained with support, or corrected by an entry; aged items are escalated.
- Information used: Bank statement: Account, Closing balance, Date
- Information used: Cash ledger: Account, Balance, Date
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: The signed reconciliation with its supporting detail, the reconciling items and their support, and the review date.
- Client value: the financial system (system; does not hold testing). Where the transactions are recorded.
- Client value: the preparer (role; does not hold testing). The operator.
- Client value: the reviewer (role; does not hold testing). Must not be the preparer.
- Client value: the reconciliation deadline (period; does not hold testing). When a month's reconciliation counts as late.
- Client value: the threshold for investigating reconciling items (amount; testing waits for it). The control's precision.
- Client value: the control owner for bank reconciliations (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the reconciliation procedure. Walk one recent instance of a bank reconciliation through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected reconciliation agrees to the statement and ledger, items are resolved, and it was independently reviewed. Agree the statement balance and ledger balance; inspect items; compare preparer and reviewer. Tests: trs01-agrees, trs01-items, trs01-reviewer.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of bank reconciliations for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: trs01-agrees, trs01-items, trs01-reviewer. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **trs01-agrees** The reconciliation agrees to the bank statement balance and to the general ledger balance at the month end | high | Statement, ledger, and reconciliation balances agree, or differences are reconciled. | Agreement to an independent balance is what the control does. | The reconciliation or analysis; The ledger or external balance | They agree, or differences are reconciled. | Unreconciled difference. | A balance is missing. | Reconciling items need judgment. | A balance typed onto the reconciliation is not the ledger. | Control description, AS 1105.15-.20 |
| **trs01-items** Each reconciling item the reviewer flagged was investigated, with an explanation supported by evidence and, where needed, a correction recorded | high | Each flagged item has a supported explanation or a correction. | Identification without investigation and resolution does not detect or correct a misstatement (KPMG Q5.11). | Explanations; Supporting documents; Adjusting entries | Every flagged item is explained with support or corrected. | An item unexplained, explained without support, or uncorrected. | Explanations or support not provided. | Whether an explanation is adequate is judgment. | An explanation is not corroborated because it is plausible. | Control description, KPMG ICFR Handbook (2025) Q5.10-5.11 |
| **trs01-reviewer** The bank reconciliation was signed off, with a date, by the reviewer the control designates, who is not its preparer | high | A dated sign-off by the designated reviewer, different from the preparer. | The control assigns the review; a review by the preparer is not a review. | Sign-off; Who prepared it; Designated reviewer or delegation of authority | Signed by the designated reviewer, not the preparer. | No sign-off, or signed by the preparer or someone not designated. | No sign-off provided, or no record of who is designated. | The designated reviewer is not documented. | A sign-off is evidence of review, not of what the reviewer checked. | Control description, AS 2201.44-.45 |

### TRS-02

- Objective: Only authorized people can move company funds.
- Type: detective; performer: Treasury; reviewer: The reviewer of signatories and portal users; trigger: Each quarter
- Population: Quarterly reviews.
- Sampling: Firm methodology table: 2 for a quarterly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each quarter, [the reviewer of bank access] reviews the bank signatories and the users of [the banking portal] against current roles and [the bank mandate], and has changes made for anyone who has left or changed role.
- Risk: Someone without authority can approve or release payments.
- Assertions (AS 1105.11): Existence or occurrence
- Design: detective, manual, quarterly; operator: [the reviewer of bank access]; reviewer: None: the review is the control; owner: [the control owner for bank access]
- Authority: The reviewer must not be a portal administrator reviewing their own access.
- Judgment: low (Comparing users with roles and the mandate is largely mechanical.)
- Precision: Every signatory and every portal user at the review date.
- Outliers: A user or signatory not supported is removed through the bank.
- Information used: Portal user listing from the bank: User, Rights, Date
- Information used: Bank mandate: Signatory, Limits
- Evidence: The reviewed listings with their dates, the sign-off, and the change requests to the bank.
- Client value: the reviewer of bank access (role; does not hold testing). The operator.
- Client value: the banking portal (system; does not hold testing). Where users are listed.
- Client value: the bank mandate (text; does not hold testing). Who may approve payments.
- Client value: the control owner for bank access (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the board mandate and the review procedure. Walk one recent instance of a quarterly review through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether every signatory and portal user is authorized and leavers and movers were removed. Compare bank signatories and portal users with the mandate; compare the HR leaver and mover list with removals. Tests: trs02-authorized, trs02-movers.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of quarterly reviews for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: trs02-authorized, trs02-movers. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **trs02-authorized** Every bank signatory and banking portal user at the review date is authorized by the board-approved mandate | high | Each signatory and user is in the mandate. | The description reviews against the mandate. | Bank signatory list; Portal user list; Mandate | All authorized. | Someone not in the mandate. | Lists from the bank not provided. | Portal rights differ from mandate wording. | An internal list is not the bank's list. | Control description |
| **trs02-movers** People who left or changed roles were removed from signatories and the portal | high | Each leaver or mover on the HR list is no longer a signatory or user. | The description requires changes for people who moved or left. | HR leaver and mover list; Bank lists | All removed. | One still has access. | HR list not provided. | Removal pending with the bank. | Do not assume an HR list is complete. | Control description, AS 1105.10 |

### TRS-03

- Objective: Debt and accrued interest are recorded at the balances the lenders report.
- Type: detective; performer: Treasury; reviewer: The designated reviewer; trigger: Each quarter
- Population: The quarterly agreements of debt balances to lender statements in the period.
- Sampling: Firm methodology table: 2 for a quarterly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each quarter, [the preparer] agrees each debt balance and the accrued interest in [the financial system] to the lender's statement, investigates any difference above [the threshold for investigating a difference], and [the reviewer] reviews and signs off the agreement.
- Risk: Debt or interest is misstated.
- Assertions (AS 1105.11): Completeness, Valuation or allocation, Rights and obligations
- Design: detective, manual, quarterly; operator: [the preparer]; reviewer: [the reviewer]; owner: [the control owner for debt]
- Authority: The reviewer must not have prepared the agreement.
- Judgment: low (Agreeing balances is mechanical.)
- Precision: Every debt facility, agreed exactly or with differences above [the threshold for investigating a difference] explained.
- Outliers: A difference is investigated with the lender and corrected.
- Information used: Lender statements: Facility, Principal, Interest
- Information used: Debt ledger: Facility, Balance, Date
- Evidence: The signed agreement of balances to lender statements.
- Client value: the financial system (system; does not hold testing). Where the transactions are recorded.
- Client value: the preparer (role; does not hold testing). The operator.
- Client value: the reviewer (role; does not hold testing). Must not be the preparer.
- Client value: the threshold for investigating a difference (amount; testing waits for it). The control's precision.
- Client value: the control owner for debt (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the debt schedule and how it is agreed to lender statements. Walk one recent instance of a quarter's agreement of debt balances through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected quarter's debt balances agree to the lenders and the agreement was reviewed. Agree each facility's balance and accrued interest to the lender's statement; inspect the sign-off. Tests: trs03-balances, trs03-reviewer.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of quarters for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: trs03-balances, trs03-reviewer. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **trs03-balances** Debt balances in the schedule agree to lender statements or confirmations at the quarter end | high | Schedule and lender balances agree, or differences are reconciled. | Agreement to an independent balance is what the control does. | The reconciliation or analysis; The ledger or external balance | They agree, or differences are reconciled. | Unreconciled difference. | A balance is missing. | Reconciling items need judgment. | A balance typed onto the reconciliation is not the ledger. | Control description, AS 1105.15-.20 |
| **trs03-reviewer** The agreement of debt balances to lender statements was signed off, with a date, by the reviewer the control designates, who is not its preparer | high | A dated sign-off by the designated reviewer, different from the preparer. | The control assigns the review; a review by the preparer is not a review. | Sign-off; Who prepared it; Designated reviewer or delegation of authority | Signed by the designated reviewer, not the preparer. | No sign-off, or signed by the preparer or someone not designated. | No sign-off provided, or no record of who is designated. | The designated reviewer is not documented. | A sign-off is evidence of review, not of what the reviewer checked. | Control description, AS 2201.44-.45 |

Retired from version 2:

- "Covenant calculations are accurate and reviewed": Moved to TRS-03.1, the quarterly covenant calculation: agreeing balances and calculating covenants are two controls (milestone 8.9).

### TRS-03.1

- Objective: Covenant compliance is calculated as the debt agreements define it, reviewed, and breaches or near breaches are escalated.
- Type: detective; performer: Treasury; reviewer: The designated reviewer; trigger: Each quarter
- Population: The quarterly covenant calculations in the period.
- Sampling: Firm methodology table: 2 for a quarterly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each quarter, [the preparer] calculates each financial covenant as [the debt agreements] define it, from the period's financial statements, and [the reviewer] reviews the calculation and its inputs and signs off. A breach or a covenant within [the headroom that triggers escalation] of breach is reported to [who breaches are reported to].
- Risk: A covenant breach goes unidentified, so debt classification and disclosure are wrong.
- Assertions (AS 1105.11): Presentation and disclosure, Rights and obligations
- Design: detective, manual, quarterly; operator: [the preparer]; reviewer: [the reviewer]; owner: [the control owner for debt]
- Authority: The reviewer must understand the agreements' definitions.
- Judgment: moderate (Applying the agreements' definitions to the financial statements needs judgment.)
- Precision: Every covenant in every debt agreement, each period.
- Outliers: A breach or near breach is escalated, and its effect on classification and disclosure assessed.
- Information used: Debt agreements: Covenant, Definition, Threshold
- Information used: Covenant calculation: Covenant, Inputs, Result, Threshold
- Evidence: The calculation with its inputs traced to the financial statements, the reviewer's sign-off, and any escalation.
- Client value: the preparer (role; does not hold testing). The operator.
- Client value: the reviewer (role; does not hold testing). Must not be the preparer.
- Client value: the debt agreements (text; does not hold testing). Where covenants are defined.
- Client value: the headroom that triggers escalation (percent; does not hold testing). When a near breach is escalated.
- Client value: who breaches are reported to (role; does not hold testing). Escalation.
- Client value: the control owner for debt (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the covenant definitions in the debt agreements. Walk one recent instance of a quarter's covenant calculation through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected calculation recalculates from the agreement's definitions and was reviewed. Recalculate each covenant from the agreement's definitions and the period's financial statements; inspect the sign-off and any escalation. Tests: trs031-covenants, trs031-reviewer.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of quarters for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: trs031-covenants, trs031-reviewer. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **trs031-covenants** Covenant calculations recalculate correctly using the debt agreement's definitions and the period's financial statements | high | Recalculation equals the reported result. | An incorrect calculation can hide a breach. | Calculation; Agreement definitions; Financial statements | Equal. | Different. | The agreement or the inputs are not provided. | The agreement's definitions are ambiguous. | Do not interpret the agreement's terms. | Control description, AS 1105.15-.20 |
| **trs031-reviewer** The covenant calculation was signed off, with a date, by the reviewer the control designates, who is not its preparer | high | A dated sign-off by the designated reviewer, different from the preparer. | The control assigns the review; a review by the preparer is not a review. | Sign-off; Who prepared it; Designated reviewer or delegation of authority | Signed by the designated reviewer, not the preparer. | No sign-off, or signed by the preparer or someone not designated. | No sign-off provided, or no record of who is designated. | The designated reviewer is not documented. | A sign-off is evidence of review, not of what the reviewer checked. | Control description, AS 2201.44-.45 |

### HTR-01

- Objective: Only approved hires, leavers, and pay changes are processed in payroll.
- Type: preventive; performer: The person who enters the change; reviewer: HR and the employee's manager; trigger: A payroll master change
- Population: Payroll master changes in the period from the payroll system.
- Sampling: Firm methodology table: 25 for an event-driven control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each payroll master change (new hires, leavers, and pay rate changes) is requested with [the support the control requires] and approved by [the approver of payroll master changes] before [the role that maintains the data] makes it in [the financial system]. The maintainer is not the approver.
- Risk: Ghost employees are paid, leavers continue to be paid, or pay rates are changed without authority.
- Assertions (AS 1105.11): Existence or occurrence, Valuation or allocation
- Design: preventive, manual, event driven; operator: [the role that maintains the data]; reviewer: [the approver of payroll master changes]; owner: [the control owner for payroll master data]
- Authority: The approver must have authority over the data and must not make the change.
- Judgment: low (The approver checks a stated change against its support.)
- Precision: Every payroll master change in the period, as listed from [the financial system]'s change log.
- Outliers: A change found without approval or support is reviewed with the approver and corrected if needed.
- Information used: Payroll master change log from the system: Record, Field, Old value, New value, Changed by, Date
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: The request with its support and approval dated before the change, and [the financial system]'s change log.
- Client value: the financial system (system; does not hold testing). Where the transactions are recorded.
- Client value: the support the control requires (text; does not hold testing). What the approver checks the change against.
- Client value: the approver of payroll master changes (role; does not hold testing). The reviewer.
- Client value: the role that maintains the data (role; does not hold testing). The operator.
- Client value: the control owner for payroll master data (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the procedure for payroll master changes and their approval. Walk one recent instance of a payroll master change through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected payroll master change was supported, approved before it was made, and entered as approved. For each selected change, inspect support and approval and compare them with the system's change record. Tests: htr01-support, htr01-approved, htr01-matches.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of payroll master changes for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: htr01-approved, htr01-matches. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **htr01-support** The payroll master change is supported by [the documents the control requires] | low | The required supporting documents exist and agree to the change. | The description requires support; what support is not stated. | Supporting documents | Required support agrees. | Support missing or disagrees. | Not provided. | What support is required is not defined. | Do not decide what support suffices. | Control description |
| **htr01-approved** The payroll master change was approved by HR and the employee's manager before it was processed in the system | high | An approval by the required approver, dated before processing. | The control is preventive: approval must come first. | Approval; System record of the change or posting | Approved by the required approver before processing. | Missing, after processing, or by someone else. | Approval or processing date not provided. | Who may approve is not documented. | Do not assume authority from a title. | Control description, AS 2201.44-.45 |
| **htr01-matches** The payroll master change in the system agrees to what was approved | high | Values in the system equal the approved values. | Approval covers only what was approved. | Approval; System record | They agree. | They differ. | System record not provided. | Values are described differently. | Do not infer system values from the approval. | Control description |

### HTR-02

- Objective: Each payroll is reviewed for unusual changes and approved before payment.
- Type: preventive; performer: Payroll; reviewer: The payroll approver; trigger: Each payroll run
- Population: Payroll runs in the period.
- Sampling: Firm methodology table: 2 for a monthly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Before each payroll is paid, [the preparer] compares the payroll register from [the financial system] with the prior run, explains each employee-level change above [the threshold for explaining a change in an employee's pay], and [the reviewer] reviews the comparison and approves the payroll before payment is released.
- Risk: Erroneous or fraudulent payroll payments are made.
- Assertions (AS 1105.11): Existence or occurrence, Valuation or allocation
- Design: detective, it dependent manual, monthly; operator: [the preparer]; reviewer: [the reviewer]; owner: [the control owner for payroll]
- Authority: The reviewer must understand the account and the business well enough to judge an explanation, and must not have prepared the analysis.
- Judgment: high (Whether an explanation is adequate and corroborated is a judgment.)
- Precision: Every item above [the threshold for explaining a change in an employee's pay] is investigated.
- Outliers: Each item above the threshold is explained with corroborating evidence, and a correcting entry is recorded where the explanation shows an error.
- Information used: Payroll register: Employee, Gross pay, Net pay, Run
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: The comparison with explanations, and the approval dated before payment.
- Client value: the financial system (system; does not hold testing). Where the transactions are recorded.
- Client value: the preparer (role; does not hold testing). The operator.
- Client value: the reviewer (role; does not hold testing). Must not be the preparer.
- Client value: the threshold for explaining a change in an employee's pay (amount; testing waits for it). The control's precision: what must be investigated.
- Client value: the control owner for payroll (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the variance threshold and approval. Walk one recent instance of a payroll review through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether the register used was complete, changes over the threshold were explained, and the payroll was approved before payment. Agree the register to the payroll system totals; re-perform the comparison with the prior run; inspect explanations and approval date against payment date. Tests: htr02-register, htr02-identified, htr02-explained, htr02-approved.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of payroll runs for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: htr02-register, htr02-identified, htr02-explained, htr02-approved. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **htr02-register** The payroll register used for the review agrees to the payroll system's totals for the run | moderate | Register totals equal the system's run totals. | The review relies on system information (KPMG ch. 6). | Register; System run totals | Agree. | Differ. | Not provided. | Timing differences. | A register's existence is not completeness. | KPMG ICFR Handbook (2025) ch. 6, Q6.4.70, AS 1105.10 |
| **htr02-identified** Every employee-level change against the prior run meeting [the threshold or criteria for investigation the control sets] was identified by the reviewer | low | Items meeting the criteria in the underlying data all appear in the reviewer's investigation. | A review is only as precise as its criteria; without them it cannot be shown to detect a misstatement (KPMG Q5.10). | The control's criteria; Underlying data; Reviewer's analysis | Every qualifying item was flagged. | A qualifying item was not flagged. | The underlying data or the analysis is not provided. | The criteria are not defined. | Do not set a threshold; do not judge one adequate. | Control description, KPMG ICFR Handbook (2025) Q5.10-5.11, AS 1105.15-.20 |
| **htr02-explained** Each change over the threshold the reviewer flagged was investigated, with an explanation supported by evidence and, where needed, a correction recorded | high | Each flagged item has a supported explanation or a correction. | Identification without investigation and resolution does not detect or correct a misstatement (KPMG Q5.11). | Explanations; Supporting documents; Adjusting entries | Every flagged item is explained with support or corrected. | An item unexplained, explained without support, or uncorrected. | Explanations or support not provided. | Whether an explanation is adequate is judgment. | An explanation is not corroborated because it is plausible. | Control description, KPMG ICFR Handbook (2025) Q5.10-5.11 |
| **htr02-approved** The payroll was approved by the payroll approver before payment was released | high | Approval before payment. | The description requires approval before payment. | Approval; Payment record | Before. | After or missing. | Dates missing. | Approver authority undefined. | Do not assume the approver. | Control description |

### HTR-03

- Objective: Payroll expense and withholding liabilities agree to the ledger each month.
- Type: detective; performer: Payroll accounting; reviewer: A reviewer other than the preparer; trigger: Each month end
- Population: Monthly payroll reconciliations.
- Sampling: Firm methodology table: 2 for a monthly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each month, [the preparer] reconciles payroll expense and withholding liabilities in [the financial system] to the payroll system's totals by [the reconciliation deadline]. Reconciling items above [the threshold for investigating reconciling items] are investigated and cleared or explained, and [the reviewer] reviews and signs off the reconciliation.
- Risk: Payroll costs or liabilities are misstated.
- Assertions (AS 1105.11): Completeness, Valuation or allocation
- Design: detective, manual, monthly; operator: [the preparer]; reviewer: [the reviewer]; owner: [the control owner for payroll accounting]
- Authority: The reviewer must not have prepared the reconciliation and must be able to judge whether reconciling items are valid.
- Judgment: moderate (Whether a reconciling item is valid and timely is a judgment.)
- Precision: The payroll agrees, and every reconciling item above [the threshold for investigating reconciling items] is explained.
- Outliers: Each reconciling item is cleared, explained with support, or corrected by an entry; aged items are escalated.
- Information used: Payroll system totals: Component, Amount, Run
- Information used: Ledger balances: Account, Balance
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: The signed reconciliation with its supporting detail, the reconciling items and their support, and the review date.
- Client value: the financial system (system; does not hold testing). Where the transactions are recorded.
- Client value: the preparer (role; does not hold testing). The operator.
- Client value: the reviewer (role; does not hold testing). Must not be the preparer.
- Client value: the reconciliation deadline (period; does not hold testing). When a month's reconciliation counts as late.
- Client value: the threshold for investigating reconciling items (amount; testing waits for it). The control's precision.
- Client value: the control owner for payroll accounting (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the reconciliation procedure. Walk one recent instance of a payroll reconciliation through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether the reconciliation agrees, differences were resolved, and it was independently reviewed. Agree register and ledger; inspect differences; compare preparer and reviewer. Tests: htr03-agrees, htr03-items, htr03-reviewer.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of payroll reconciliations for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: htr03-agrees, htr03-items, htr03-reviewer. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **htr03-agrees** The reconciliation agrees to the payroll register and to the general ledger for the month | high | Register, ledger, and reconciliation totals agree, or differences are reconciled. | Agreement to an independent balance is what the control does. | The reconciliation or analysis; The ledger or external balance | They agree, or differences are reconciled. | Unreconciled difference. | A balance is missing. | Reconciling items need judgment. | A balance typed onto the reconciliation is not the ledger. | Control description, AS 1105.15-.20 |
| **htr03-items** Each difference the reviewer flagged was investigated, with an explanation supported by evidence and, where needed, a correction recorded | high | Each flagged item has a supported explanation or a correction. | Identification without investigation and resolution does not detect or correct a misstatement (KPMG Q5.11). | Explanations; Supporting documents; Adjusting entries | Every flagged item is explained with support or corrected. | An item unexplained, explained without support, or uncorrected. | Explanations or support not provided. | Whether an explanation is adequate is judgment. | An explanation is not corroborated because it is plausible. | Control description, KPMG ICFR Handbook (2025) Q5.10-5.11 |
| **htr03-reviewer** The payroll reconciliation was signed off, with a date, by the reviewer the control designates, who is not its preparer | high | A dated sign-off by the designated reviewer, different from the preparer. | The control assigns the review; a review by the preparer is not a review. | Sign-off; Who prepared it; Designated reviewer or delegation of authority | Signed by the designated reviewer, not the preparer. | No sign-off, or signed by the preparer or someone not designated. | No sign-off provided, or no record of who is designated. | The designated reviewer is not documented. | A sign-off is evidence of review, not of what the reviewer checked. | Control description, AS 2201.44-.45 |

### INV-01

- Objective: Recorded inventory exists, and count differences are resolved and approved before adjustment.
- Type: detective; performer: Warehouse and inventory control; reviewer: The approver of adjustments; trigger: Each count
- Population: Counts in the period.
- Sampling: Firm methodology table: 2 for a monthly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** [the team that counts] counts inventory under the count instructions ([cycle counts or a full count, and how often]), with counters independent of the custodians. [the preparer] compares the counts with [the financial system], investigates each difference above [the threshold for investigating a count difference], and [the reviewer] approves each adjustment before it is posted.
- Risk: Recorded inventory does not exist, or differences are adjusted without investigation.
- Assertions (AS 1105.11): Existence or occurrence, Completeness
- Design: detective, it dependent manual, monthly; operator: [the preparer]; reviewer: [the reviewer]; owner: [the control owner for inventory]
- Authority: The reviewer must understand the account and the business well enough to judge an explanation, and must not have prepared the analysis.
- Judgment: high (Whether an explanation is adequate and corroborated is a judgment.)
- Precision: Every item above [the threshold for investigating a count difference] is investigated.
- Outliers: Each item above the threshold is explained with corroborating evidence, and a correcting entry is recorded where the explanation shows an error.
- Information used: Count sheets: Item, Location, Counted quantity
- Information used: Book quantities: Item, Location, Quantity
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: Count sheets, the comparison with differences investigated, and the approved adjustments.
- Client value: the financial system (system; does not hold testing). Where the transactions are recorded.
- Client value: the preparer (role; does not hold testing). The operator.
- Client value: the reviewer (role; does not hold testing). Must not be the preparer.
- Client value: the threshold for investigating a count difference (amount; testing waits for it). The control's precision: what must be investigated.
- Client value: the control owner for inventory (role; does not hold testing). Accountable for the control's design and operation.
- Client value: the team that counts (role; does not hold testing). Counters must be independent of the custodians.
- Client value: cycle counts or a full count, and how often (text; does not hold testing). The population and timing.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the count instructions, threshold, and adjustment approval. Walk one recent instance of a count through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether differences over the threshold were investigated and adjustments approved before posting. Re-perform the identification of differences over the threshold; inspect investigations and the approval date against the posting date. Tests: inv01-identified, inv01-investigated, inv01-approved.
- **o-2** (operating) Determine whether counts followed the instructions. Observe a count (AS 1105.16: evidence is limited to the time observed), or inspect count sheets for the steps the instructions require. Tests: inv01-instructions.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of counts for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: inv01-identified, inv01-investigated, inv01-approved. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **inv01-instructions** The count followed the count instructions (blind counts, segregated counters, cutoff), as observed or as evidenced on the count sheets | moderate | The steps the instructions require are evidenced. | Uncontrolled counts make differences unreliable. | Instructions; Observation; Count sheets | Steps evidenced. | A required step not followed. | No observation and sheets do not show the steps. | Always for an observation the agent did not make. | Count sheets do not prove the count was blind. | Control description, AS 1105.15-.20 |
| **inv01-identified** Every count difference meeting [the threshold or criteria for investigation the control sets] was identified by the reviewer | low | Items meeting the criteria in the underlying data all appear in the reviewer's investigation. | A review is only as precise as its criteria; without them it cannot be shown to detect a misstatement (KPMG Q5.10). | The control's criteria; Underlying data; Reviewer's analysis | Every qualifying item was flagged. | A qualifying item was not flagged. | The underlying data or the analysis is not provided. | The criteria are not defined. | Do not set a threshold; do not judge one adequate. | Control description, KPMG ICFR Handbook (2025) Q5.10-5.11, AS 1105.15-.20 |
| **inv01-investigated** Each count difference over the threshold the reviewer flagged was investigated, with an explanation supported by evidence and, where needed, a correction recorded | high | Each flagged item has a supported explanation or a correction. | Identification without investigation and resolution does not detect or correct a misstatement (KPMG Q5.11). | Explanations; Supporting documents; Adjusting entries | Every flagged item is explained with support or corrected. | An item unexplained, explained without support, or uncorrected. | Explanations or support not provided. | Whether an explanation is adequate is judgment. | An explanation is not corroborated because it is plausible. | Control description, KPMG ICFR Handbook (2025) Q5.10-5.11 |
| **inv01-approved** The inventory adjustment was approved by the designated approver before it was processed in the system | high | An approval by the required approver, dated before processing. | The control is preventive: approval must come first. | Approval; System record of the change or posting | Approved by the required approver before processing. | Missing, after processing, or by someone else. | Approval or processing date not provided. | Who may approve is not documented. | Do not assume authority from a title. | Control description, AS 2201.44-.45 |

### INV-02

- Objective: Slow-moving and obsolete inventory is reserved under the approved policy.
- Type: detective; performer: Inventory accounting; reviewer: The designated reviewer; trigger: Each quarter
- Population: Quarterly reserve calculations.
- Sampling: Firm methodology table: 2 for a quarterly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each quarter, [the preparer] calculates the reserve for slow-moving, excess, and obsolete inventory from [the financial system]'s aging and usage report under [the inventory reserve policy], investigates items above [the threshold for investigating an item] with operations, and [the reviewer] reviews the calculation and its assumptions and approves the reserve.
- Risk: Inventory is carried above its net realizable value.
- Assertions (AS 1105.11): Valuation or allocation
- Design: detective, it dependent manual, quarterly; operator: [the preparer]; reviewer: [the reviewer]; owner: [the control owner for inventory valuation]
- Authority: The reviewer must understand the account and the business well enough to judge an explanation, and must not have prepared the analysis.
- Judgment: high (Whether an explanation is adequate and corroborated is a judgment.)
- Precision: Every item above [the threshold for investigating an item] is investigated.
- Outliers: Each item above the threshold is explained with corroborating evidence, and a correcting entry is recorded where the explanation shows an error.
- Information used: Inventory aging and usage report: Item, Quantity, Value, Last movement, Usage
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: The calculation with the report's parameters, the policy applied, the investigations, and the approval.
- Client value: the financial system (system; does not hold testing). Where the transactions are recorded.
- Client value: the preparer (role; does not hold testing). The operator.
- Client value: the reviewer (role; does not hold testing). Must not be the preparer.
- Client value: the threshold for investigating an item (amount; testing waits for it). The control's precision: what must be investigated.
- Client value: the control owner for inventory valuation (role; does not hold testing). Accountable for the control's design and operation.
- Client value: the inventory reserve policy (text; does not hold testing). The criteria applied.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the reserve policy and aging report. Walk one recent instance of a reserve calculation through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether the aging report was complete and accurate, the reserve follows policy, and it was reviewed. Agree the aging report to the inventory ledger and recalculate aging for selected items; recalculate the reserve under the policy; inspect sign-off. Tests: inv02-report, inv02-policy, inv02-reviewer.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of reserve calculations for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: inv02-report, inv02-policy, inv02-reviewer. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **inv02-report** The aging report used agrees to the inventory ledger, and aging recalculates for selected items | high | Totals agree; selected items' aging recalculates. | The reserve relies on the report (KPMG ch. 6). | Aging report; Ledger; Receipt dates | Agree. | Differ. | Not provided. | Aging basis undocumented. | Do not assume the aging basis. | Control description, AS 1105.10, KPMG ICFR Handbook (2025) ch. 6, Q6.4.70 |
| **inv02-policy** The reserve recalculates under the approved reserve policy | high | Recalculated reserve equals recorded. | The description requires a reserve under the policy. | Policy; Calculation | Equal. | Different. | Policy not provided. | Management overrides of the policy need judgment. | Do not judge whether the policy is adequate. | Control description, AS 1105.15-.20 |
| **inv02-reviewer** The reserve calculation was signed off, with a date, by the reviewer the control designates, who is not its preparer | high | A dated sign-off by the designated reviewer, different from the preparer. | The control assigns the review; a review by the preparer is not a review. | Sign-off; Who prepared it; Designated reviewer or delegation of authority | Signed by the designated reviewer, not the preparer. | No sign-off, or signed by the preparer or someone not designated. | No sign-off provided, or no record of who is designated. | The designated reviewer is not documented. | A sign-off is evidence of review, not of what the reviewer checked. | Control description, AS 2201.44-.45 |

### INV-03

- Objective: Only approved standard costs are recorded.
- Type: preventive; performer: The person who enters the change; reviewer: cost accounting; trigger: A standard cost change
- Population: Standard cost changes in the period from the system change log.
- Sampling: Firm methodology table: 25 for an event-driven control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each standard cost change (material, labor, and overhead rates) is requested with [the support the control requires] and approved by [the approver of standard cost changes] before [the role that maintains the data] makes it in [the financial system]. The maintainer is not the approver.
- Risk: Inventory and cost of sales are valued at unapproved costs.
- Assertions (AS 1105.11): Valuation or allocation
- Design: preventive, manual, event driven; operator: [the role that maintains the data]; reviewer: [the approver of standard cost changes]; owner: [the control owner for standard costs]
- Authority: The approver must have authority over the data and must not make the change.
- Judgment: low (The approver checks a stated change against its support.)
- Precision: Every standard cost change in the period, as listed from [the financial system]'s change log.
- Outliers: A change found without approval or support is reviewed with the approver and corrected if needed.
- Information used: Standard cost change log from the system: Record, Field, Old value, New value, Changed by, Date
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: The request with its support and approval dated before the change, and [the financial system]'s change log.
- Client value: the financial system (system; does not hold testing). Where the transactions are recorded.
- Client value: the support the control requires (text; does not hold testing). What the approver checks the change against.
- Client value: the approver of standard cost changes (role; does not hold testing). The reviewer.
- Client value: the role that maintains the data (role; does not hold testing). The operator.
- Client value: the control owner for standard costs (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the procedure for standard cost changes and their approval. Walk one recent instance of a standard cost change through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected standard cost change was supported, approved before it was made, and entered as approved. For each selected change, inspect support and approval and compare them with the system's change record. Tests: inv03-support, inv03-approved, inv03-matches.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of standard cost changes for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: inv03-approved, inv03-matches. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **inv03-support** The standard cost change is supported by [the documents the control requires] | low | The required supporting documents exist and agree to the change. | The description requires support; what support is not stated. | Supporting documents | Required support agrees. | Support missing or disagrees. | Not provided. | What support is required is not defined. | Do not decide what support suffices. | Control description |
| **inv03-approved** The standard cost change was approved by cost accounting before it was processed in the system | high | An approval by the required approver, dated before processing. | The control is preventive: approval must come first. | Approval; System record of the change or posting | Approved by the required approver before processing. | Missing, after processing, or by someone else. | Approval or processing date not provided. | Who may approve is not documented. | Do not assume authority from a title. | Control description, AS 2201.44-.45 |
| **inv03-matches** The standard cost change in the system agrees to what was approved | high | Values in the system equal the approved values. | Approval covers only what was approved. | Approval; System record | They agree. | They differ. | System record not provided. | Values are described differently. | Do not infer system values from the approval. | Control description |

### FA-01

- Objective: Capital additions are authorized and recorded under the capitalization policy.
- Type: preventive; performer: Fixed asset accounting; reviewer: Approvers per the delegation of authority; trigger: A capital expenditure
- Population: Fixed asset additions in the period.
- Sampling: Firm methodology table: 25 for an event-driven control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each capital expenditure above [the capitalization threshold] is approved under [the delegation of authority] before it is committed, and [the reviewer of additions] reviews each addition against [the capitalization policy] (asset class, useful life, and in-service date) before it is recorded in [the financial system].
- Risk: Expenses are capitalized, or assets are recorded with the wrong life or class.
- Assertions (AS 1105.11): Existence or occurrence, Valuation or allocation, Presentation and disclosure
- Design: preventive, manual, event driven; operator: Fixed asset accounting; reviewer: [the reviewer of additions]; owner: [the control owner for fixed assets]
- Authority: Approvers must hold the authority [the delegation of authority] sets; the reviewer must know the capitalization policy.
- Judgment: moderate (Whether a cost is capital is a judgment under the policy.)
- Precision: Every addition above [the capitalization threshold] in the period.
- Outliers: An addition not meeting the policy is expensed or corrected.
- Information used: Fixed asset additions report: Asset, Class, Cost, Useful life, In-service date
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: The approved request, the addition with its support, and the reviewer's sign-off before recording.
- Client value: the financial system (system; does not hold testing). Where the transactions are recorded.
- Client value: the capitalization threshold (amount; testing waits for it). Which costs are capitalized.
- Client value: the delegation of authority (text; does not hold testing). Who may approve which amount.
- Client value: the capitalization policy (text; does not hold testing). The criteria applied.
- Client value: the reviewer of additions (role; does not hold testing). The reviewer.
- Client value: the control owner for fixed assets (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the capitalization policy and authority. Walk one recent instance of an addition through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected addition was approved within authority, meets the policy, and is recorded at the right amount and in-service date. Inspect approval against authority; compare the item with the policy criteria; agree amount to invoice and in-service date to evidence. Tests: fa01-authority, fa01-policy, fa01-recorded.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of additions for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: fa01-authority, fa01-policy, fa01-recorded. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **fa01-authority** The expenditure was approved by an approver whose authority covers its amount | high | Approver's limit covers the amount. | The description requires approval under the delegation of authority. | Approval; Delegation of authority | Within. | Over or missing. | No delegation of authority. | Project approvals spanning items. | Do not assume limits. | Control description, AS 2201.44-.45 |
| **fa01-policy** The item meets the capitalization policy's criteria (threshold, useful life, nature of cost) | high | Each criterion in the policy is met. | The description reviews additions against the policy. | Policy; Invoice | Meets the criteria. | Does not. | Policy not provided. | Nature of cost needs judgment (repair or improvement). | Do not decide capital or expense where the policy is silent. | Control description |
| **fa01-recorded** The asset is recorded at the invoiced cost and with the in-service date shown by evidence | moderate | Recorded cost equals invoice; in-service date matches evidence. | Amount and date drive depreciation. | Register; Invoice; In-service evidence | Agree. | Differ. | In-service evidence missing. | Capitalized internal costs. | Do not use the invoice date as in-service. | Control description |

### FA-02

- Objective: Depreciation is calculated from approved useful lives and reviewed monthly.
- Type: detective; performer: The system calculates; accounting reviews; reviewer: The designated reviewer; trigger: Each month end
- Population: Monthly depreciation reviews.
- Sampling: Firm methodology table: 2 for a monthly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each month, [the financial system] calculates depreciation from each asset's class, cost, and useful life. [the preparer] compares the month's charge with expectation by asset class, explains differences above [the threshold for explaining a depreciation difference], and [the reviewer] reviews and signs off.
- Risk: Depreciation is misstated through wrong lives or calculation errors.
- Assertions (AS 1105.11): Valuation or allocation
- Design: detective, it dependent manual, monthly; operator: [the preparer]; reviewer: [the reviewer]; owner: [the control owner for fixed assets]
- Authority: The reviewer must understand the account and the business well enough to judge an explanation, and must not have prepared the analysis.
- Judgment: high (Whether an explanation is adequate and corroborated is a judgment.)
- Precision: Every item above [the threshold for explaining a depreciation difference] is investigated.
- Outliers: Each item above the threshold is explained with corroborating evidence, and a correcting entry is recorded where the explanation shows an error.
- Information used: Depreciation run report: Asset class, Charge, Period
- Information used: Useful life configuration by asset class: Asset class, Useful life, Method
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: The depreciation run, the expectation and explanations, and the sign-off.
- Client value: the financial system (system; does not hold testing). Where the transactions are recorded.
- Client value: the preparer (role; does not hold testing). The operator.
- Client value: the reviewer (role; does not hold testing). Must not be the preparer.
- Client value: the threshold for explaining a depreciation difference (amount; testing waits for it). The control's precision: what must be investigated.
- Client value: the control owner for fixed assets (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether configured useful lives equal the approved policy. Compare the system's useful life by asset class with the policy (a configuration check, AS 2201.B30). Tests: fa02-lives.
- **o-1** (operating) Determine whether the monthly charge was reviewed and variances explained. Re-perform the expectation and identify variances over the threshold; inspect explanations and sign-off. Tests: fa02-identified, fa02-explained, fa02-reviewer.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of monthly reviews for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: fa02-identified, fa02-explained, fa02-reviewer. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **fa02-lives** Useful lives configured by asset class equal the approved depreciation policy | high | Configured life equals policy life for each class. | The system calculates from them. | Configuration; Policy | Equal. | Different. | Not provided. | Asset-level overrides. | Do not assume default lives. | Control description, AS 2201.B28-.B33 |
| **fa02-identified** Every variance in the monthly charge meeting [the threshold or criteria for investigation the control sets] was identified by the reviewer | low | Items meeting the criteria in the underlying data all appear in the reviewer's investigation. | A review is only as precise as its criteria; without them it cannot be shown to detect a misstatement (KPMG Q5.10). | The control's criteria; Underlying data; Reviewer's analysis | Every qualifying item was flagged. | A qualifying item was not flagged. | The underlying data or the analysis is not provided. | The criteria are not defined. | Do not set a threshold; do not judge one adequate. | Control description, KPMG ICFR Handbook (2025) Q5.10-5.11, AS 1105.15-.20 |
| **fa02-explained** Each variance the reviewer flagged was investigated, with an explanation supported by evidence and, where needed, a correction recorded | high | Each flagged item has a supported explanation or a correction. | Identification without investigation and resolution does not detect or correct a misstatement (KPMG Q5.11). | Explanations; Supporting documents; Adjusting entries | Every flagged item is explained with support or corrected. | An item unexplained, explained without support, or uncorrected. | Explanations or support not provided. | Whether an explanation is adequate is judgment. | An explanation is not corroborated because it is plausible. | Control description, KPMG ICFR Handbook (2025) Q5.10-5.11 |
| **fa02-reviewer** The depreciation review was signed off, with a date, by the reviewer the control designates, who is not its preparer | high | A dated sign-off by the designated reviewer, different from the preparer. | The control assigns the review; a review by the preparer is not a review. | Sign-off; Who prepared it; Designated reviewer or delegation of authority | Signed by the designated reviewer, not the preparer. | No sign-off, or signed by the preparer or someone not designated. | No sign-off provided, or no record of who is designated. | The designated reviewer is not documented. | A sign-off is evidence of review, not of what the reviewer checked. | Control description, AS 2201.44-.45 |

### FA-03

- Objective: Disposed assets are approved and removed from the register in the period they leave.
- Type: preventive; performer: Fixed asset accounting; reviewer: The approver of disposals; trigger: A disposal
- Population: Disposals in the period, from the fixed asset register's retirement records.
- Sampling: Firm methodology table: 25 for an event-driven control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each disposal of a fixed asset is approved by [the approver of disposals] before the asset leaves, and fixed asset accounting records it in [the financial system] in the period it occurs, with the proceeds and the gain or loss.
- Risk: Disposed assets remain recorded, or gains and losses are misstated.
- Assertions (AS 1105.11): Existence or occurrence, Valuation or allocation
- Design: preventive, manual, event driven; operator: Fixed asset accounting; reviewer: [the approver of disposals]; owner: [the control owner for fixed assets]
- Authority: The approver must have authority over the asset.
- Judgment: low (Recording a disposal is mechanical once approved.)
- Precision: Every disposal in the period.
- Outliers: A disposal recorded late or without approval is corrected and the cause addressed.
- Information used: Disposal form: Asset, Date, Proceeds, Approver
- Information used: Fixed asset register: Asset, Status, Date
- Relies on: ITGC-AC-01, ITGC-AC-02, ITGC-AC-03, ITGC-AC-04, ITGC-CM-01, ITGC-CM-03, ITGC-CM-04
- Evidence: The approved disposal form and the entry recording the disposal.
- Client value: the financial system (system; does not hold testing). Where the transactions are recorded.
- Client value: the approver of disposals (role; does not hold testing). The reviewer.
- Client value: the control owner for fixed assets (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the disposal procedure. Walk one recent instance of a disposal through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether each selected disposal was approved before the asset left and removed from the register in the period. Inspect the approval and compare its date with the disposal date; agree the register removal and its period. Tests: fa03-disposals.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of disposals for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: fa03-disposals. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **fa03-disposals** Each selected disposal was approved before the asset left and removed from the register in the period it occurred | high | An approval dated before the disposal, and removal in the same period. | The control requires approved disposals to be recorded when they occur. | Approval; Register | Approved before, and removed in the period. | Not approved, approved after, or not removed in the period. | The approval or the register record is not provided. | The approver's authority is not defined. | Do not assume removal from a disposal form. | Control description |

Retired from version 2:

- "Impairment indicators were assessed and documented": Moved to FA-03.1, the annual impairment assessment: disposals and impairment are two controls with different frequencies (milestone 8.9).

### FA-03.1

- Objective: Indicators of impairment are assessed each year and acted on.
- Type: detective; performer: Financial reporting; reviewer: The designated reviewer; trigger: The annual assessment
- Population: The annual impairment assessments in the period.
- Sampling: Firm methodology table: 1 for an annual control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each year, [the preparer] assesses fixed assets for indicators of impairment listed in [the impairment policy], documents the assessment, and tests any asset group with an indicator. [the reviewer] reviews the assessment and any test and signs off.
- Risk: Impaired assets are carried above their recoverable amount.
- Assertions (AS 1105.11): Valuation or allocation
- Design: detective, manual, annual; operator: [the preparer]; reviewer: [the reviewer]; owner: [the control owner for fixed assets]
- Authority: The reviewer must understand the business's plans for its assets.
- Judgment: high (Identifying indicators and estimating recoverable amounts are judgments.)
- Precision: Every asset group, against each indicator in [the impairment policy].
- Outliers: An indicator leads to an impairment test and, where needed, an impairment charge.
- Information used: Impairment indicator assessment: Asset group, Indicator, Conclusion
- Evidence: The documented assessment, any impairment test, and the sign-off.
- Client value: the preparer (role; does not hold testing). The operator.
- Client value: the reviewer (role; does not hold testing). Must not be the preparer.
- Client value: the impairment policy (text; does not hold testing). The indicators considered.
- Client value: the control owner for fixed assets (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the indicators the policy lists and how the assessment is documented. Walk one recent instance of the impairment assessment through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether the year's assessment considered each indicator for each asset group and was reviewed. Inspect the assessment against the policy's indicators; inspect any test and the sign-off. Tests: fa031-impairment, fa031-reviewer.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **fa031-impairment** Each indicator the policy lists was assessed for each asset group, and the assessment documented for the year | moderate | A documented assessment covering each indicator and asset group. | The control requires the assessment. | Assessment; Impairment policy | Every indicator assessed for every group. | Not performed, or an indicator or group omitted. | The assessment or the policy is not provided. | Always: whether an indicator exists is judgment. | Do not conclude on impairment. | Control description |
| **fa031-reviewer** The impairment assessment was signed off, with a date, by the reviewer the control designates, who is not its preparer | high | A dated sign-off by the designated reviewer, different from the preparer. | The control assigns the review; a review by the preparer is not a review. | Sign-off; Who prepared it; Designated reviewer or delegation of authority | Signed by the designated reviewer, not the preparer. | No sign-off, or signed by the preparer or someone not designated. | No sign-off provided, or no record of who is designated. | The designated reviewer is not documented. | A sign-off is evidence of review, not of what the reviewer checked. | Control description, AS 2201.44-.45 |

### TAX-01

- Objective: The income tax provision is correctly calculated and reviewed.
- Type: detective; performer: Tax; reviewer: Tax management and, where used, an external advisor; trigger: Each quarter
- Population: Quarterly provisions.
- Sampling: Firm methodology table: 2 for a quarterly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each quarter, [the preparer] prepares the income tax provision, including current and deferred taxes and uncertain tax positions, and [the reviewer] reviews it, including the rate reconciliation and the deferred tax roll-forward, and signs off. [the external tax advisor, if any] reviews it where the client uses one.
- Risk: Income tax expense, deferred taxes, or uncertain positions are misstated.
- Assertions (AS 1105.11): Valuation or allocation, Completeness, Presentation and disclosure
- Design: detective, manual, quarterly; operator: [the preparer]; reviewer: [the reviewer]; owner: [the control owner for income taxes]
- Authority: The reviewer must have tax technical competence and must not have prepared the provision.
- Judgment: high (Uncertain positions and valuation allowances are judgments.)
- Precision: Every component of the provision, with the rate reconciliation explaining the effective rate.
- Outliers: Unexplained items in the rate reconciliation are investigated and the provision corrected.
- Information used: Tax provision workpapers: Component, Amount, Rate
- Information used: Pre-tax income by jurisdiction: Jurisdiction, Pre-tax income
- Evidence: The provision workpapers, the rate reconciliation, and the reviewer's sign-off.
- Client value: the preparer (role; does not hold testing). The operator.
- Client value: the reviewer (role; does not hold testing). Must not be the preparer.
- Client value: the external tax advisor, if any (text; does not hold testing). A second review, where used.
- Client value: the control owner for income taxes (role; does not hold testing). Accountable for the control's design and operation.
- Question: What does tax management check in its review, and when is an external advisor used?

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the provision process and review. Walk one recent instance of a provision through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether the provision starts from reported pre-tax income, deferred taxes roll forward, and it was reviewed. Agree pre-tax income to the ledger; inspect support for adjustments; recalculate the deferred tax roll-forward; inspect review evidence. Tests: tax01-income, tax01-deferred, tax01-reviewer.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of provisions for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: tax01-income, tax01-deferred, tax01-reviewer. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **tax01-income** The provision starts from pre-tax income agreed to the ledger, and each adjustment has support | high | Pre-tax income agrees; adjustments supported. | Errors in inputs flow to the provision. | Provision; Ledger; Support | Agrees and supported. | Differs or unsupported. | Not provided. | Whether a tax position is appropriate is specialist judgment. | Do not evaluate tax positions. | Control description |
| **tax01-deferred** Deferred tax balances roll forward from opening to closing with each movement explained | high | Opening plus movements equals closing. | The description includes deferred taxes. | Roll-forward | Rolls forward. | Unexplained difference. | Not provided. | Rate changes or valuation allowances. | Do not judge valuation allowances. | Control description, AS 1105.15-.20 |
| **tax01-reviewer** The tax provision was signed off, with a date, by the reviewer the control designates, who is not its preparer | high | A dated sign-off by the designated reviewer, different from the preparer. | The control assigns the review; a review by the preparer is not a review. | Sign-off; Who prepared it; Designated reviewer or delegation of authority | Signed by the designated reviewer, not the preparer. | No sign-off, or signed by the preparer or someone not designated. | No sign-off provided, or no record of who is designated. | The designated reviewer is not documented. | A sign-off is evidence of review, not of what the reviewer checked. | Control description, AS 2201.44-.45 |

### TAX-02

- Objective: Indirect tax returns agree to the ledger and are reviewed before filing.
- Type: detective; performer: Tax; reviewer: A reviewer other than the preparer; trigger: Each return
- Population: Returns filed in the period.
- Sampling: Firm methodology table: 2 for a monthly control, selected at random from the validated population across the period (AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample from tolerable and expected deviation rates and risk. Pending methodology confirmation.
- **Statement:** Each month, [the preparer] reconciles each indirect tax return to the indirect tax accounts in [the financial system] before filing by [the reconciliation deadline]. Reconciling items above [the threshold for investigating reconciling items] are investigated and cleared or explained, and [the reviewer] reviews and signs off the reconciliation.
- Risk: Indirect tax is misstated or misfiled.
- Assertions (AS 1105.11): Completeness, Valuation or allocation
- Design: detective, manual, monthly; operator: [the preparer]; reviewer: [the reviewer]; owner: [the control owner for indirect tax]
- Authority: The reviewer must not have prepared the reconciliation and must be able to judge whether reconciling items are valid.
- Judgment: moderate (Whether a reconciling item is valid and timely is a judgment.)
- Precision: The indirect tax return agrees, and every reconciling item above [the threshold for investigating reconciling items] is explained.
- Outliers: Each reconciling item is cleared, explained with support, or corrected by an entry; aged items are escalated.
- Information used: Indirect tax return: Box, Amount, Period
- Information used: Indirect tax ledger accounts: Account, Balance
- Evidence: The signed reconciliation with its supporting detail, the reconciling items and their support, and the review date.
- Client value: the financial system (system; does not hold testing). Where the transactions are recorded.
- Client value: the preparer (role; does not hold testing). The operator.
- Client value: the reviewer (role; does not hold testing). Must not be the preparer.
- Client value: the reconciliation deadline (period; does not hold testing). When a month's reconciliation counts as late.
- Client value: the threshold for investigating reconciling items (amount; testing waits for it). The control's precision.
- Client value: the control owner for indirect tax (role; does not hold testing). Accountable for the control's design and operation.

Procedures:

- **d-1** (design) Determine whether the control, performed as described by people with the authority and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43). Inspect the reconciliation and review. Walk one recent instance of a return through from its trigger to its evidence of completion (AS 2201.37-.38), asking the performer what they check and what they do with exceptions. Confirm the performer's role or delegation gives them the authority the control requires. Limitation: A walkthrough of one instance shows the design is implemented; it does not show the control operated throughout the period.
- **o-1** (operating) Determine whether the return agrees to the ledger, differences were explained, and it was reviewed before filing. Agree the return to the ledger; inspect explanations; compare review and filing dates. Tests: tax02-agrees, tax02-explained, tax02-before.
- **rf-1** (rollforward) Conclude whether the control kept operating from the interim date to period end (AS 2201.55-.56). Obtain the population of returns for the remaining period with its completeness support. Ask the control owner whether the control, its performers, or its systems changed since interim, and inspect documentation of any change. Select an update sample from the remaining period only (firm roll-forward table) and test the same attributes. Do not reselect interim items. Tests: tax02-agrees, tax02-explained, tax02-before. Limitation: Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that the control stopped working is assessed as low; that assessment is a reviewer's decision.

| Attribute | Confidence | Condition | Why | Evidence | Passes | Exception | Insufficient | Human review | Do not infer | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **tax02-agrees** The return agrees to the tax accounts in the general ledger for the period | high | Return and ledger amounts agree, or differences are reconciled. | Agreement to an independent balance is what the control does. | The reconciliation or analysis; The ledger or external balance | They agree, or differences are reconciled. | Unreconciled difference. | A balance is missing. | Reconciling items need judgment. | A balance typed onto the reconciliation is not the ledger. | Control description, AS 1105.15-.20 |
| **tax02-explained** Each difference the reviewer flagged was investigated, with an explanation supported by evidence and, where needed, a correction recorded | high | Each flagged item has a supported explanation or a correction. | Identification without investigation and resolution does not detect or correct a misstatement (KPMG Q5.11). | Explanations; Supporting documents; Adjusting entries | Every flagged item is explained with support or corrected. | An item unexplained, explained without support, or uncorrected. | Explanations or support not provided. | Whether an explanation is adequate is judgment. | An explanation is not corroborated because it is plausible. | Control description, KPMG ICFR Handbook (2025) Q5.10-5.11 |
| **tax02-before** The return was reviewed by someone other than the preparer before it was filed | high | Review by another person, dated before filing. | The description requires review before filing. | Review; Filing record | Different person, before filing. | Same person or after filing. | Dates missing. | Filing date not recorded. | Do not use submission confirmation as review. | Control description |

