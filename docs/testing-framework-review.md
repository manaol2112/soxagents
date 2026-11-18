# Testing framework review: procedures and attributes

Status: **Phases 1 to 5 complete; Phase 6 validated structurally only (no live-model evaluation); Phase 7 summary below.** The revised definitions are library version 3, published in [testing-definitions.md](testing-definitions.md). They are a draft for a SOX methodology reviewer to challenge: they have not been validated by one and must not be represented as PCAOB-compliant.

Every statement here is labelled as one of:

- **[Std]** what an authoritative source says, quoted or closely paraphrased, with its reference;
- **[Pub]** what a publicly available professional publication says;
- **[Assess]** this review's own assessment or inference, open to challenge;
- **[Gap]** information that is missing and must be supplied, not assumed.

## 1. Discovery: how the platform tests controls today

### Where controls and attributes come from

- The **standard library** is code: `services/api/ai_workforce_api/controls.py`, version 2, 48 controls (16 ITGC, 2 entity-level, 2 application, 2 key report, 26 business process). Each has an ID, area, title, one-sentence risk, one-sentence activity, frequency, nature (manual, automated, IT-dependent manual), a list of **test attributes** (plain sentences) and a list of **evidence items** (plain sentences).
- An engagement **copies** library controls into its RCM, or imports the **client's own RCM**, whose "test procedures" column becomes the attribute list. Client controls are outside the library and need their own review (section 6).
- Since 8.6 each attribute is a record (`control_attributes`) with a status (proposed, approved, rejected, retired, superseded), a basis (documented or inferred) and a source. Only **approved** attributes are tested. The agent can propose attributes; a person approves them.
- Since 8.7 each control has an evidence plan by phase (design, interim, roll-forward) with categorized evidence requirements.

### What the platform does not represent

[Assess] The data model has no field for: the **control objective** (only the risk sentence), **assertions**, **preventive or detective** (kept only as a custom client column), the **reviewer** distinct from the owner, **control parameters** the attributes depend on (for example the number of days for removing a leaver's access, or an investigation threshold), and the **information used in the control** (reports the performer relies on).

### How the testing agent uses attributes

- `testing_engine.py` gives the agent the control's ref, title, activity, frequency, nature, the audit period, the sample's population row, the evidence text, and **each attribute as one sentence of up to 300 characters**. It gives no expected result, failure condition, required evidence, data to extract, or decision rule.
- The agent answers each attribute with **PASS, EXCEPTION, UNABLE, or NOT_APPLICABLE**, with a note and citations. A pass without a citation that checks out against the file becomes UNABLE (8.6).
- A sheet concludes **not effective on any confirmed exception** (zero tolerance, decision 8.2), and cannot be signed off while any result is UNABLE.
- **Sample sizes** come from a fixed table by frequency (`controls.SAMPLE_SIZES`: annual 1, quarterly 2, monthly 2, weekly 5, daily 20, more often or event-driven 25; automated tested once). Roll-forward and retest sizes are other fixed tables (`test_rounds.py`).
- The same attribute list is used for design, interim, and roll-forward testing.

## 2. Source basis

### Verified sources

The PCAOB website (pcaobus.org) and the Internet Archive refused automated access. The PCAOB text was verified from the PCAOB's own compiled PDF, *Auditing Standards of the PCAOB, for audits of fiscal years beginning on or after June 16, 2024 and before December 14, 2024* (662 pages, downloaded 15 October 2026).

| Source | What it establishes for this framework |
| --- | --- |
| AS 2201.42 | Design effectiveness: whether the controls, "if they are operated as prescribed by persons possessing the necessary authority and competence", satisfy the control objectives and can prevent or detect errors or fraud that could result in material misstatement. [Std] |
| AS 2201.43 | Design procedures are "a mix of inquiry of appropriate personnel, observation of the company's operations, and inspection of relevant documentation"; walkthroughs including these "ordinarily are sufficient to evaluate design effectiveness". [Std] |
| AS 2201.37–.38 | A walkthrough follows a transaction from origination to the financial records, using the same documents and IT, with probing questions at points where important processing occurs. [Std] |
| AS 2201.44 | Operating effectiveness: whether the control "is operating as designed and whether the person performing the control possesses the necessary authority and competence". [Std] |
| AS 2201.45, .50 | Operating procedures are a mix of inquiry, observation, inspection, and re-performance, ordered from least to most evidence. "Inquiry alone does not provide sufficient evidence to support a conclusion about the effectiveness of a control." [Std] |
| AS 2201.46–.47 | Evidence needed rises with the risk associated with the control; the factors include the nature and frequency of the control, reliance on other controls (including ITGCs), whether it is automated, and the complexity and judgment involved. [Std] |
| AS 2201.48 (Note) | "An individual control does not necessarily have to operate without any deviation to be considered effective." [Std] |
| AS 2201.52 | Testing over a longer period, and closer to the as-of date, provides more evidence. [Std] |
| AS 2201.55–.56 | Roll-forward: determine the additional evidence for the remaining period based on the control and its risk, the interim results, the sufficiency of interim evidence, the length of the remaining period, and possible significant changes. Note: when those factors indicate low risk, "inquiry alone might be sufficient as a roll-forward procedure." [Std] |
| AS 2201.B28–.B33 | Benchmarking of entirely automated application controls when ITGCs over program changes, access, and operations are effective and the control has not changed since the baseline; the baseline is re-established after a period; dependence on related files, tables, data, and parameters (.B30). [Std] |
| AS 2301.18–.30 | Same design and operating definitions for the financial statement audit; matters affecting the extent of tests (.27); evidence for the remaining period after interim testing (.29–.30). [Std] |
| AS 1105.10 | When using information produced by the company as audit evidence, test its accuracy and completeness (or the controls over it) and evaluate whether it is sufficiently precise and detailed. [Std] |
| AS 1105.15–.20 | Definitions of inspection, observation (limited to the point in time observed), inquiry (by itself insufficient to support a conclusion on a control), recalculation, and reperformance. [Std] |
| AS 2315.32 | Sampling does not apply to many tests of controls, including those depending on segregation of duties or leaving no documentary evidence. [Std] |
| AS 2315.34, .38 | Sample size depends on the tolerable rate of deviation, the expected rate, and the allowable risk of assessing control risk too low; the standard gives no sample size table. [Std] |
| AS 2315.39 | Selection should be representative, with every item able to be selected, ideally from the entire period. [Std] |
| AS 2315.40 | If planned procedures cannot be applied to a selected item, the auditor "should ordinarily consider those selected items to be deviations". [Std] |
| AS 2315.42 | Qualitative aspects of deviations (nature, cause, error or irregularity) are considered as well as their rate. [Std] |
| SEC Release 33-8810, §II.A.2.b–c (2007) | Management's guidance: the evidence management evaluates comes from direct tests, ongoing monitoring, or both; its nature varies with ICFR risk; when risk is low, management "may conclude that evidence from on-going monitoring is sufficient and that no direct testing is required"; management's evaluation considers "how the control was applied, the consistency with which it was applied, and whether the person performing the control possesses the necessary authority and competence". [Std] |
| KPMG, *Handbook: Internal control over financial reporting* (2025, public) Q5.5.20–5.5.60 | A control attribute is a specific procedure performed by the control operator that addresses the control's objective; process steps unimportant to the objective are not attributes; attributes must be detailed enough for a third party to reperform them, and vague language should be avoided. [Pub] |
| KPMG Handbook Q5.10, Q5.10.140, Q5.11 | Precision, criteria for investigation, thresholds; management review controls need their precision understood; outliers are identified, investigated, and resolved. [Pub] |
| KPMG Handbook ch. 6 (Q6.4.70) | Completeness and accuracy of information used in a control can be addressed by an attribute within the control or by separate controls. [Pub] |
| KPMG Handbook Example 7.3.10 | Example attributes for manual GITCs: access requests approved by an authorized individual per the IT delegation of authority, permissions requested compared with approved roles, access provisioned consistent with the approval; leavers removed within a specified number of days per policy; access reviews performed periodically per policy by managers commensurate with the delegation of authority, inappropriate access investigated for unauthorized activity, and access modified as instructed. [Pub] |
| KPMG Handbook Q7.4.40 | Evaluation strategies for GITCs (inquiry never as the sole procedure; inspection; observation; reperformance) for manual and automated GITCs. [Pub] |

### Distinctions the framework must keep

- [Std] AS 2201 and AS 2301 set the **external auditor's** responsibilities. SEC Release 33-8810 states management's evaluation may rely on ongoing monitoring where ICFR risk is low. A procedure required of the external auditor is not automatically required of management's testing team. **Whose testing this platform supports decides how several items below are framed (see Decisions).**
- [Assess] The sample size table, zero tolerance, "test of one" for automated controls, and fixed roll-forward update samples are **firm methodology choices**, not PCAOB requirements. They may be appropriate; they must be labelled and approved as methodology.

### Limitations of the verification

- The PCAOB text is the version effective for fiscal years beginning **June 16 to December 14, 2024**. Later amendments (for example the 2024 amendments to AS 1105 and AS 2301 on technology-assisted analysis, effective for fiscal years beginning on or after December 15, 2025) were **not verified**. A reviewer should confirm no cited paragraph changed.
- **Deloitte, PwC, and EY** publications were not reviewed. No statement in this framework is attributed to them.
- PCAOB Staff Audit Practice Alert No. 11 (management review controls, IPE) is cited by KPMG but was not itself read.
- AS 2601 (service organizations) was not reviewed; OP-05 relies on a SOC report and needs it.

## 3. Gap analysis: findings across the framework

### Structural findings

1. **Attributes are sentences, not testable definitions.** [Assess] The agent receives no expected result, failure condition, required evidence, data to extract, or decision rule. KPMG Q5.5.50 [Pub] calls for attributes detailed enough for a third party to reperform them. The agent cannot consistently tell an exception from insufficient evidence when the attribute only says "approved by an appropriate person".
2. **One result covers two different situations.** [Assess] UNABLE means both "the evidence does not show it" (request more evidence) and "this needs judgment" (a person decides). They call for different actions.
3. **Missing evidence and deviations.** [Std] AS 2315.40 treats an item the tester cannot test, after attempting the procedures and alternatives, as ordinarily a deviation. [Assess] The platform correctly does not let the agent call missing evidence an exception, and blocks sign-off while items are UNABLE. What it lacks is the step after follow-up: a person deciding that an item remains untestable and recording it as a deviation.
4. **Zero tolerance.** [Std] AS 2201.48 Note: a control need not operate without any deviation to be effective; AS 2315.34 and .41 frame evaluation against a tolerable rate. [Assess] The platform's zero-tolerance rule (8.2) is a common conservative methodology for small samples, but it is a methodology choice to be confirmed, not a standard.
5. **Sample sizes.** [Std] AS 2315 gives factors, not sizes. [Assess] The table is firm methodology and must be labelled as such; it ignores risk (AS 2201.46–.47) and population size.
6. **Design, interim, and roll-forward share one attribute list.** [Assess] Design needs "is the control capable and implemented" (AS 2201.42–.43); operation needs "did it operate as designed" (AS 2201.44). Some attributes only make sense in one phase (for example "useful lives match policy" is a design and configuration check, not a per-sample check).
7. **Authority and competence.** [Std] AS 2201.44 and SEC 33-8810 name the performer's authority and competence. [Assess] Authority is addressed in some approval attributes; competence in none. Competence is ordinarily assessed in design and walkthrough procedures rather than per sample, but the framework should say where it is addressed.
8. **Information used in controls.** [Std] AS 1105.10 (auditor's use of company information). [Pub] KPMG ch. 6 (information used in the control). [Assess] Of the IT-dependent manual controls, only ITGC-AC-03 and INV-02 have an attribute for the report the performer relies on; OTC-03, HTR-02, FA-02, PTP-02, ITGC-OP-01, and ITGC-CM-03 rely on system information with no attribute or separate control identified.
9. **Undefined parameters.** [Gap] Many attributes depend on a value the library does not hold: "the agreed timeframe" (AC-02, CM-02), "on time" (AC-03, RTR-02), "the threshold" (OTC-03, RTR-01, RTR-03, HTR-02, INV-01, OTC-04), "major incidents" (OP-04), "required level" (OTC-04, RTR-01, PTP-02). The agent cannot evaluate these without the client's value.
10. **Vague wording.** [Pub] KPMG Q5.5.60 says avoid vague language. [Assess] "appropriate person" (AC-01, OTC-02, PTP-03, RTR-03), "reviewed and approved" without saying what the reviewer checks (RTR-04, TAX-01, INV-02), "with support" without saying what support (OTC-01, PTP-01, INV-03).
11. **Controls that combine two controls.** [Assess] OP-02 (access restriction and change approval), OP-03 (automated backup, manual failure follow-up, annual restore test), FA-03 (disposals and impairment), TRS-03 (debt agreement and covenant calculation). Each mixes objectives, frequencies, or natures, so one sample and one attribute list do not fit.
12. **Frequency and nature labels that do not fit the description.** [Assess] AC-05 "annual, automated" (a configuration operates continuously; annual describes the review cadence, if any); CM-03 "quarterly, IT-dependent manual" while the description is a preventive access restriction; OP-03 "daily, automated" while it includes manual and annual activities.

### Control by control

Each row says what should change, and why. K = keep as is, R = revise (specify), M = move (not a control attribute: an exception follow-up or a procedure), U = unsupported by the control description, + = missing.

#### IT general controls

| Control | Findings |
| --- | --- |
| ITGC-AC-01 New user access approved | 1 R: the request must identify the user and the specific access. 2 R: "appropriate person" → the user's manager, and the application owner where the policy requires it; authority per the IT delegation of authority (KPMG Ex. 7.3.10). [Gap] which access needs the application owner. 3 K: approval timestamp before the grant timestamp in the system. 4 K: granted access equals approved access (KPMG Ex. 7.3.10). Population: system-generated list of new accounts and access changes, with completeness and accuracy support. |
| ITGC-AC-02 Leavers lose access | 1 R: evidence must show when access was removed (a current user listing shows absence now, not the date). 2 R: [Gap] the number of days in the policy (KPMG Ex. 7.3.10 uses "within X days ... per policy"). 3 M: "no activity after termination" is not part of the control as described; it assesses the impact of a late removal and belongs in the deviation follow-up. + matching HR identities to application accounts needs human review when identifiers differ; population is the HR termination list, whose completeness needs support. |
| ITGC-AC-03 User access review | 1 K: complete and accurate user listing (KPMG ch. 6). 2 R: reviewer is the designated owner or manager per policy (KPMG Ex. 7.3.10) and does not approve their own access ([Assess] inferred, moderate). 3 K: requested changes made (KPMG Ex. 7.3.10). 4 R: [Gap] the policy's deadline. + investigation of inappropriate access for unauthorized activity is a KPMG example attribute but is not in the library description: propose, do not mandate, until the client's control includes it. |
| ITGC-AC-04 Privileged access | [Gap] whether the control is a periodic approval of the privileged list (as "quarterly, manual" suggests) or the restriction itself; which layers (application, database, OS); the definition of privileged. 1 R: whether a role "needs" access is the reviewer's judgment; the tester verifies the reviewer recorded a decision per user, and a person decides disputed cases. 2 R: management approved the complete privileged list for the quarter, with a dated sign-off. 3 U/overlap: generic privileged accounts are ITGC-AC-06's subject. |
| ITGC-AC-05 Authentication settings | 1 K, R: compare each configured value (length, complexity, lockout, MFA enforcement and its scope) with the policy value. [Gap] the policy values and the MFA scope. 2 R: "unchanged or changes approved" relies on change management and benchmarking (AS 2201.B29); evidence is the configuration change history, not a current screenshot. Label: "annual, automated" does not fit (finding 12). |
| ITGC-AC-06 Shared and service accounts | 1 K named owner. 2 K interactive sign-in disabled or approved. 3 U: credentials in an approved vault is not in the control description: do not test unless the client's control includes it. + completeness of the inventory against the system's account list. |
| ITGC-CM-01 Changes tested and approved | 1 K request exists. 2 K tested with documented results. 3 R: both business and IT owner approval (as described), dated before the production deployment date. 4 K deployed change equals the approved change (ticket to deployment record). Population: changes from the deployment or change log, not only the ticketing tool. Developer/deployer segregation is ITGC-CM-03, not added here. |
| ITGC-CM-02 Emergency changes | 1 R: [Gap] the policy's emergency criteria; without them classification is judgment, so human review. 2 R: [Gap] the number of days. + identification of emergency changes depends on a change-type field: completeness of the emergency population needs support. |
| ITGC-CM-03 Developers cannot deploy | [Gap] nature and frequency do not fit the description (finding 12): is the control the access restriction, or a quarterly review of it? 1 K: compare the developer list with the deployer list; both lists need completeness support. 2 R: compare deployers with an approved list of the authorized group. |
| ITGC-CM-04 Configuration changes | 1 R: split into request exists and approval exists. 2 K log matches the approved change. [Gap] which configuration objects "affect financial processing"; whether approval must precede the change (the description does not say). |
| ITGC-CM-05 Direct data changes | 1 K request and data-owner approval. 2 R: compare the performer with the list of authorized staff [Gap]. 3 R: "logged" is how the population is obtained; a sample from the log cannot find unlogged changes; state that limitation. |
| ITGC-OP-01 Job monitoring | 1 R: compare failures in the job log with monitoring records. 2 K investigated and resolved. 3 duplicate of 2: merge. Job log completeness needs support. |
| ITGC-OP-02 Job schedule changes | Combines two controls (finding 11): access to change the schedule (periodic) and approval of schedule changes (event-driven). Split, or confirm which one the client operates. |
| ITGC-OP-03 Backups | Combines an automated backup, a manual follow-up of failures, and an annual restore test (findings 11, 12). Split into separately tested parts. |
| ITGC-OP-04 Incidents | 1 R: prioritized per the client's criteria [Gap]. 2 K resolved. 3 R: [Gap] definition of major incident. |
| ITGC-OP-05 Data center access | 2 R: evaluating a SOC 1 report (period covered, opinion, controls in scope, complementary user entity controls, bridge letter) needs its own procedure; AS 2601 not reviewed. 1 K for an owned data center: compare the access list with authorized personnel. |

#### Entity-level, application, and key report controls

| Control | Findings |
| --- | --- |
| ELC-01 Code of conduct | 1 K. 2 K. 3 K. Population: employee list at the time, with completeness support. |
| ELC-02 Whistleblower | 1 "each report was logged": the log is the population, so the test cannot detect unlogged reports; state the limitation. 2 K. 3 K. Investigation adequacy is judgment: human review. |
| ITAC-01 Three-way match | 1 K: compare tolerance values with the approved design. 2 K: one out-of-tolerance invoice blocked (test of one; benchmarking AS 2201.B28–.B33 in later years). 3 R: release of a block is part of the control only if the client's design says so; access to change the configuration is an ITGC dependency, not this control's attribute. + dependence on tables and parameters (AS 2201.B30). |
| ITAC-02 Credit hold | 1 K. 2 K. 3 K for release (the description names an authorized release); limit changes are a separate master data control. |
| IPE-01 Aged receivables report | 1 K total agrees to the ledger. 2 R: specify parameters (as-of date equals period end, every entity included, no excluding filters). 3 K recalculate aging for selected items (AS 1105.10). |
| IPE-02 Journal entry listing | 1 K. 2 K. |

#### Business process controls

| Control | Findings |
| --- | --- |
| OTC-01 Customer master | 1 R: [Gap] what support is expected. 2 K. 3 K. |
| OTC-02 Revenue cutoff | 1 R: [Gap] the window around period end (precision). 2 K. 3 R: "appropriate person" → the designated reviewer. |
| OTC-03 Unapplied cash | + reliability of the unapplied cash report (finding 8). 1 R: "was reviewed" says nothing about what was checked. 2 R: [Gap] the age threshold. 3 merge into 1. |
| OTC-04 Credit memos | 1 K. 2 R: [Gap] the approval matrix and threshold. 3 K. |
| PTP-01 Vendor master | 1 R [Gap] support. 2 K (independent of purchasing and payments, as described). 3 K call-back to known contact details. |
| PTP-02 Purchase orders | Likely enforced by a system workflow: [Gap] whether approval is a configured workflow (application control) or manual. 1 K. 2 K against the delegation of authority. |
| PTP-03 Unrecorded liabilities | Management review: [Gap] precision (threshold, period searched). 1 K. 2 K. 3 R "appropriate person". |
| PTP-04 Payment runs | 1 R: what the review checks. 2 K two authorized approvers per the bank mandate. 3 K. |
| RTR-01 Manual journal entries | 1 R [Gap] what support. 2 K. 3 K against the delegation of authority [Gap] threshold. + what the reviewer checks (accounts, amounts, support) — precision, moderate. |
| RTR-02 Account reconciliations | 1 K. 2 R [Gap] "timely". 3 R [Gap] deadline. Management review precision applies. |
| RTR-03 Flux analysis | 1 R [Gap] threshold. 2 K corroborated explanations (KPMG Q5.10, Q5.11). 3 R "appropriate person". |
| RTR-04 Consolidation | Complex management review: 2 needs reperformance or human review; [Gap] what the reviewer checks. |
| TRS-01 Bank reconciliations | K, with [Gap] "timely". |
| TRS-02 Signatories | 1 R: compare with the board-approved mandate. 2 R: movers and leavers from an HR list with completeness support. |
| TRS-03 Debt and covenants | Combines two (finding 11): 2 splits into accurate and reviewed. |
| HTR-01 Payroll master | K. |
| HTR-02 Payroll review | + register reliability (finding 8). 2 R [Gap] threshold. |
| HTR-03 Payroll reconciliation | K. |
| INV-01 Counts | 1 R: "followed count instructions" is mainly evidenced by observation (AS 1105.16, limited to the time observed): human review. 2 R [Gap] threshold. 3 K. |
| INV-02 Inventory reserve | 1 K. 2 K. 3 R what the reviewer checks. |
| INV-03 Standard costs | 1 R [Gap] support. 2 K. 3 K. |
| FA-01 Capital additions | 1 K. 2 judgment: human review. 3 K recalculate. |
| FA-02 Depreciation | 1 design or configuration check (finding 6). 2 R [Gap] threshold. + depreciation run reliability. |
| FA-03 Disposals and impairment | Combines two (finding 11); impairment is judgment: human review. |
| TAX-01 Tax provision | Complex management review; specialist judgment: human review; 1 R. |
| TAX-02 Indirect tax | K. |

### Totals from this gap analysis

- 48 library controls reviewed against their own descriptions.
- 6 controls combine or mislabel controls and need confirmation before definitions are written (AC-04, AC-05, CM-03, OP-02, OP-03, FA-03; also TRS-03 to split).
- About 30 controls depend on at least one client parameter the library does not hold.
- 2 attributes are not supported by the control description (AC-02.3 moved, AC-06.3 unsupported).
- No attribute was found to be wrong for its control; most need precision, a parameter, or an evidence specification.

These counts are this review's assessment and will be restated precisely, per attribute, in the Phase 4 output.

## 4. Decisions taken before Phase 4

The product owner confirmed four decisions, recorded in [phase-plan.md](phase-plan.md):

- The framework supports **management's testing** (SOX PMO, internal audit, or a firm doing that work). SEC Release 33-8810 is management's basis; AS 2201 is cited as the standard the external auditor applies.
- "Unable to tell" splits into **insufficient evidence** (request more) and **human review required** (a person decides). After follow-up, a person may record an untestable item as a deviation (AS 2315.40); the agent never does.
- Revised definitions are **library version 3**, opt-in per control for existing engagements; open and signed-off test sheets keep their attributes.
- Low and not-established attributes enter as **proposed, not tested**, with their question.

## 5. Revised definitions (Phase 4)

Source of truth: `services/api/ai_workforce_api/definitions_itgc.py` and `definitions_business.py`, typed by `testing_definitions.py`. [testing-definitions.md](testing-definitions.md) is generated from them, and a test fails if the two disagree.

Each control has its objective, type, performer, reviewer, trigger, population, sampling basis, and procedures for design, operating effectiveness, and roll-forward. Each attribute has the condition it tests, why it matters, the evidence, what to read from it, the comparison, when it passes, is an exception, lacks evidence, or needs a person, what not to infer, its source basis, a confidence (high, moderate, low, not established), and any assumption or question.

| Measure | Count |
| --- | --- |
| Controls reviewed | 48 |
| Version 2 attributes | 134 |
| Reworded into version 3 (traced by their earlier wording) | 125 |
| Retired, each with its reason | 9 |
| New attributes | 16 |
| Version 3 attributes | 141 |
| High / moderate (tested) | 104 / 11 |
| Low / not established (proposed with a question) | 24 / 2 |
| Proposed attributes that hold testing until answered | 12 |
| Controls whose design must be confirmed first | 9 |
| Controls with open questions | 25 |
| Procedures: design / operating / roll-forward | 48 / 54 / 47 |

[Assess] Every control's wording changed. No version 2 attribute was found to be wrong for its control. The changes add precision (which record, which dates, compared how), make the evidence explicit, and separate what the description states from what depends on the client.

Two points a reviewer should check first:

- **Approval of credit memos (OTC-04).** The approval is tested at high confidence. Only the approver's level against the matrix is proposed, because the matrix is the client's.
- **Review precision.** For the seven review controls, "every item over the threshold was identified" is low confidence, because the library does not know the threshold. It blocks testing until a person states it: a review control tested without its precision does not show it would detect a misstatement [Pub KPMG Q5.10; Std AS 2201.42].

### How it reaches the platform

- **New engagements.** New engagements copy the version 3 attributes. At launch, and when a control joins scope, each attribute is linked to its definition. Low and not-established attributes are added as library proposals carrying their question.
- **What holds testing.** A blocking proposal holds the control's readiness at "Definition and criteria" until a person approves it (with the client's value) or rejects it. A non-blocking proposal shows as a point to look at. A control whose design must be confirmed gets an open question that holds testing until resolved with a note.
- **Existing engagements.** A control copied from version 2 shows the comparison (keep, reword, add, propose, retire, with reasons) on its Design tab. A person adopts it, and the adoption is audited. Sheets already created keep their attributes.
- **The testing agent.** It receives each attribute's definition with the sample. Its results are pass, exception, insufficient evidence (stored as `UNABLE`), human review required (`REVIEW`), and not applicable. Insufficient evidence and human review both block sign-off until a person decides. The independent reviewer uses the same results.

## 6. Validation (Phase 6)

What was checked, by automated tests (`tests/test_testing_definitions.py`):

- **Structure.**
  - Every attribute has a basis from the source table.
  - Every proposed attribute has a question.
  - Every procedure names attributes that exist.
  - Every version 2 attribute is kept, reworded, or retired with a reason.
  - The library tests exactly the high and moderate attributes.
  - The sample table equals the engine's and is labelled as firm methodology.
- **Plumbing.**
  - The tester's prompt carries each definition.
  - A result needing human review keeps the conclusion open and blocks sign-off.
  - A person can then record the item as a deviation.
  - Kickoff links definitions and holds testing for blocking answers; rejected proposals are not raised again.
  - Adoption from version 2 works once and is audited.
- **Cases in the definitions.** Each definition names its own adequate evidence (pass), contrary evidence (exception), and inadequate evidence (insufficient). Many cover persuasive but insufficient evidence explicitly, for example:
  - a current user listing offered for a leaver's removal date (AC-02);
  - a ticket closed without an approval (AC-01);
  - a plausible but uncorroborated explanation on a review (the `_resolved` attributes).

**Not done.** The testing agent's behaviour was not evaluated against these cases with a live model. The automated tests script the model's answers, so they show the platform handles each result correctly, not that the model chooses correctly. A live evaluation needs synthetic evidence sets per attribute (adequate, inadequate, persuasive but insufficient, contradictory) and a reviewer's expected result for each.

## 7. Summary for the reviewer (Phase 7)

### Prioritised remediation

1. **A methodology owner reviews the definitions.** Start with the 21 register entries that block automated testing and the 9 design confirmations.
2. **Confirm or replace the firm methodology:**
   - the sample size table;
   - zero tolerance;
   - test of one for automated controls;
   - evidence-based roll-forward instead of inquiry alone for low risk.
   No standard prescribes any of them (AS 2315.38; AS 2201.48 Note; AS 2201.B28; AS 2201.56 Note).
3. **Check every cited paragraph** against the PCAOB edition in force for the engagement period. Only the 2024 compiled edition was read.
4. **Compare with each firm's methodology.** Deloitte, PwC, and EY publications were not reviewed; KPMG's ICFR Handbook (2025) was.
5. **Run a live-model evaluation** on synthetic evidence for each attribute before relying on the agent's results.
6. **Wire the remaining definition fields into the workpaper templates** (procedures and limitations per phase). Today they show on the control record and in the generated document.

### Uncertainty register

The full register (46 entries) is in [testing-definitions.md](testing-definitions.md#uncertainty-register): eight framework-wide entries, nine design confirmations, the controls' open questions, and each proposed attribute. Twenty-one block automated testing until answered.

### What did not change

- Control IDs and references.
- The evidence planning of 8.7.
- The sample size table and zero-tolerance conclusion (flagged, not changed).
- Engagements launched before version 3, until a person adopts it per control.
- Open and signed-off test sheets.
