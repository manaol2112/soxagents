# Engagement onboarding

Every new engagement opens in **Setup**. A team sets it up once, and the planner then proposes the work. Approving the plan starts the engagement.

## Steps

| Step | What the team sets up | Ready when |
| --- | --- | --- |
| Scope and period | Scope text and period end | Scope and period end are set |
| Team and access | An engagement lead, preparers, an independent reviewer | There is a lead and a reviewer |
| Risk and control matrix | The client's RCM (its in-scope systems are identified from it) or the standard library, then scope, owners, frequency, nature, and systems per control | At least one control is in scope, there is at least one in-scope system, and each control has a system. A control owner is optional |
| Workpaper templates | A design and a testing template per control, previewed with a real control | A person confirmed the templates |
| PBC plan | Client coordinator, client email domains, due days, reminder cadence | A coordinator and domains are set, and every owner named is inside them. Requests for controls without an owner go to the coordinator |
| Review and start | Readiness, the agents on the team, and the kickoff plan | The plan is approved |

Readiness is computed from the records each time. It is never stored, so it cannot go stale.

## Team and access

The team is the engagement's project membership, so being on it is what gives a project manager, reviewer, or contributor access to the engagement. Owners and admins can open every engagement. The engagement role (lead, preparer, reviewer) is descriptive; the organization role still decides permissions.

## RCM

The control library is code in `services/api/ai_workforce_api/controls.py`: 48 controls in 14 areas. There are 16 IT general controls (logical access, change management, IT operations), application controls and key reports (IPE), and starter controls for entity-level controls and each business cycle (order to cash, procure to pay, record to report, treasury, hire to retire, inventory, fixed assets, tax). Each has a risk, a control activity, test attributes, suggested evidence, and a default frequency and nature. A test pins the library's fingerprint. The team chooses which areas to load, and can add areas later. Loading copies the controls into the engagement, which keeps the library key and version. Sample sizes follow frequency (annual 1, quarterly and monthly 2, weekly 5, daily 20, more often or event-driven 25). An automated control is tested once.

## Areas and testers

Every control belongs to one of 15 standard areas: the three IT general control areas, application controls (ITAC), key reports and IPE, entity-level controls, the eight business cycles, and other business process. The area decides the standard tester: the three ITGC testers take their own areas, and the business process controls tester takes everything else. A person can change a control's area, or choose another tester for one control (for example, an ITGC tester for an application control). An uploaded RCM keeps the client's own word for the area next to the standard one.

## Client RCM upload

Instead of the library, a team can upload the client's own RCM, in the client's format and terminology. The library and an upload are alternatives: either one replaces the other until kickoff.

1. **Upload.** An `.xlsx` workbook or a `.csv` file, up to 5 MB, 20 sheets, 2,000 rows, and 80 columns. The file is untrusted. Only cell values are read: formulas are not evaluated (a workbook's cached values are used), and macros, links, and embedded objects are ignored. Workbooks are opened through `defusedxml` and checked against zip bombs. The file is not stored; the import keeps its hash, size, and parsed cells. A file name is a label only.
2. **Layout.** The sheet and heading row are detected (a cover sheet or title rows are skipped) and can be changed.
3. **Columns.** Each client column is matched to a platform field (control ID, name, description, risk, process or area, frequency, nature, key control, owner, owner email, applications, test procedures, evidence), kept as a client column, or dropped. Suggestions come from a reviewed synonym list in `services/api/ai_workforce_api/rcm_import.py`, and first from how this engagement's own earlier uploads were mapped. An engagement never learns from another engagement's RCM: headings and client terms are client data. A person confirms the mapping. Control ID and description are required.
4. **Terms.** For process or area, frequency, and nature, every distinct client term is mapped once to a standard value, because the standard value decides the tester agent, the sample size, and the testing template. At upload, reviewed keyword rules and this engagement's earlier uploads suggest values ("As needed" to event-driven, "ITDM" to IT-dependent manual). Then, in the background, an agent maps the terms that are still blank: Claude reads each term with the controls that use it (so "IT" next to access reviews is logical access) and gives a one-line reason, shown under the term. **Remap with agent** redoes every term and replaces the current choices; without a model it puts back the rule suggestions. The answer is checked: only terms in the file and only standard values are taken. Changing which column holds a term maps again. Nothing imports while a term is unmapped. Rows without a control ID add no terms.
5. **In-scope systems.** In the background, an agent identifies every system the RCM relies on: from the systems column, and from the control text, which often names systems the column leaves out (the ticketing tool used for approvals, the directory used for access, the database behind a backup control). It merges the ways one system is written ("SAP", "SAP ECC 6.0") under one name, sets its layer (application, database, operating system, infrastructure, or tool), and links it to the controls that rely on it. Claude does this when a model is configured; its answer is kept only where a system's name or a variant appears in the RCM text and its control IDs exist, so it cannot add systems the RCM does not name. Without a model, the systems column and a reviewed list of common systems in `services/api/ai_workforce_api/rcm_systems.py` are used. A person renames, re-layers, or leaves out systems before import. Changing the column mapping scans again. Values like "N/A" or "All systems" are not systems.
6. **Preview and import.** The preview lists the controls, the rows that will be skipped and why (no control ID, a repeated ID, no description, a credential-shaped value), and applications that will be added. Importing replaces the engagement's controls in one transaction, adds the confirmed systems as in-scope applications (each control tagged with its own), adds any other new applications, and asks for the workpaper templates to be confirmed again.

Each imported control keeps the client's words for area, frequency, and nature next to the standard value, and every kept client column under its own heading. Both appear on the control and on its workpapers. When the RCM names owners without emails, the team adds each owner's email once and every control they own gets it. A control ID becomes a PBC reference by replacing characters that references do not allow (`AC 1.01` becomes `AC-1.01`).

## Workpaper templates

Templates are code in `services/api/ai_workforce_api/workpapers.py`: a walkthrough and test of design, operating effectiveness for a manual control, and operating effectiveness for an automated control. A preview fills a template with one engagement control: its header fields, the sample size, and a testing matrix with one row per sample and one column per attribute. Previews never contain results. Changing a control's template asks for confirmation again.

## Kickoff

When every step is ready, the engagement planner proposes a plan. For each in-scope control it proposes a walkthrough, an evidence request, an operating effectiveness test (after the walkthrough and the evidence), and an independent review (after the test). It ends with the engagement report, after every review. Each task goes to the right standard agent.

Approving the plan, in one transaction:

- Locks the setup. Only team changes are allowed afterwards.
- Activates the engagement.
- Creates every task as ready, assigned to its agent, with its dependencies.
- Drafts one PBC request per control, addressed to its owner, with the plan's due date and reminder cadence.

The plan is fingerprinted. If the setup changes after the plan was proposed, approval is refused and the planner proposes again. An engagement starts once. Nothing is emailed: each request still needs an approver before it is sent. Right after kickoff, the evidence coordinator drafts each request from its control in the background. See [Drafting from the control](pbc.md#drafting-from-the-control).

Owners, admins, and project managers on the engagement change setup and approve the plan. Everyone with access can follow it.
