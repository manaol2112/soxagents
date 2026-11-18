# Evidence files

Milestone 7.1 stores the bytes for an inbound attachment. Milestone 7.3 reads each stored file and suggests what kind of evidence it is. Milestone 7.4 has the control's tester review screenshots and test them against the control, for a person to sign off. None of them changes a request: a person still marks it received. Milestone 8.1c lets the team upload evidence directly, and a filed upload marks its request received ([Evidence intake](#evidence-intake)).

## Custody

A person with project update rights sends the bytes to `POST .../mailbox-attachments/{id}/content`. The service hashes them. The number of bytes must equal the attachment's recorded size. When the mail already declared a SHA-256 hash, the bytes must match it. The file name and type come from that attachment record, not from the upload.

The same bytes stored again return the same record. Different bytes are refused. The application generates the object key, `evidence/{id}`. A database trigger rejects updates and deletes of the custody record. A file added by mistake is withdrawn or replaced instead, and its record stays ([Withdrawing and replacing evidence](#withdrawing-and-replacing-evidence)).

`GET .../evidence-files/{id}/content` reads the object and returns it only when the hash and size still match the record. The response is an attachment download and is marked `nosniff`. A reader on the project can download. Another organization gets nothing. Audit payloads store the hash and size only, never the file name or the bytes.

## Reading and classification

Storing a file queues one analysis for it (`evidence_analyses`). The evidence coordinator reads the file in the background, on the local worker or a Temporal workflow (`evidence_analysis`), with up to three attempts. The bytes are read through the custody check: if the stored object no longer matches its hash, the analysis fails and the audit trail records it.

Since Milestone 3a every model call of a read goes through one caller (`provenance.py`): the FAST tier for matching, classification and model OCR, the control's tester's BALANCED tier for the screenshot review, the firm's budgets, and a provenance record per call. The analysis says who produced its classification: `MODEL`, `RULES` (no model configured, or nothing readable to send), `FALLBACK` (the model failed or its answer was rejected and the keyword rules classified the file; the note names the failure first and the failed call is linked) or `FAILED`. A person can cancel a queued or running read (`POST …/agent-runs/analysis/{id}/cancel`); reading the file again is the recovery ([operations.md](operations.md)).

### Reading the file

Reading is deterministic and values-only (`evidence_extraction.py`). The kind comes from the file's bytes, not its name.

| File | What is read |
| --- | --- |
| `.xlsx` | Cell values from each sheet (cached results, never formulas or external links). The largest sheet gives the columns and the row count |
| `.csv`, `.txt` | The text. A CSV gives its columns and row count |
| `.docx` | Paragraphs and tables. Embedded images go to OCR |
| PDF | The text layer. Pages with almost no text are treated as scans and go to OCR; their OCR text is labelled with the page it is on, in page order, so a cited passage opens on that page (a scan whose image cannot be taken is named in the note; a blank page is passed over). A password-protected PDF is not read |
| PNG, JPEG, GIF, BMP, TIFF, WebP | OCR |
| Anything else, including `.xls` and `.doc` | Not read. A person reviews it |

Limits: 200,000 characters of text, 300 PDF pages, 10 images for OCR, 100,000 rows, and archives that expand past 150 MB are refused before they are opened. Secret-looking values are redacted from the text that is kept.

### OCR

OCR sits behind one interface (`evidence_ocr.py`) with two engines:

- **Local** (the default): Tesseract, run as a fixed command with the image on stdin. Images never leave the firm. Set `OCR_TESSERACT_PATH`, or put `tesseract` on the `PATH`. Without it, the file is marked for a person to read.
- **Model**: the configured model provider reads up to five page images in one call. A firm's owner or admin opts in under **AI workforce → Evidence reading** (`PUT /organizations/{id}/evidence-settings`). The change is audited. If the model cannot answer, local OCR is tried next. Without the opt-in, no image is ever sent.

### Classification

The suggestion says what kind of evidence the file is (population, walkthrough, design, configuration, change history, key report, policy, sample, or other), how it covers each item its request asked for (covered, partly covered, not covered), what to follow up, and the period the file shows. When the request carries planned requirements, its items are the requirements themselves, in full, and each item's coverage is recorded under the requirement's id, set from the request, never from the answer (see [testing.md](testing.md#the-readers-view-of-each-requirement)).

- The request comes from the reply the file arrived on, when that reply is matched or assigned. The requested items come from the request's draft (Milestone 7.1d). A file on an unmatched reply is classified without coverage.
- Claude reads a bounded excerpt (12,000 characters) of the redacted text, with the request and the control. Reviewed keyword rules give the suggestion when no model is configured, nothing could be read, or the model's answer fails its checks.
- The answer is untrusted. Only known kinds and real request items are kept. Item titles come from the request, not the answer. Notes are cleaned of links and secret-looking values.
- The suggestion is not a test conclusion. Testing comes in Phase 8.

### Review

On the Evidence page, each stored file shows how it was read, the suggested kind, the coverage, and what to follow up. A person with project update rights confirms the kind, with an optional note, or asks the agent to read the file again. A confirmed reading is not reread. Confirming never changes the request. Every step is in the audit trail without the file name or its text.

## First-pass review of screenshots

Milestone 7.4. For a screenshot, a scanned page, or an image in a document, the control's tester (for example, the ITGC access tester) reviews the evidence before a person does (`evidence_review.py`). It reads the images with Claude vision, so the firm must opt into model OCR. Without that, the file is marked **Needs a person**, with feedback that says why.

The agent checks the evidence itself, each as OK, issue, or unclear:

| Check | What it looks for |
| --- | --- |
| Legible and complete | Readable, full resolution, nothing cut off or scrolled out of view |
| System and environment | The in-scope system's name is visible, and it is production |
| Date and period | A visible date or time, in the audit period or at period end |
| No signs of editing | Cropping, pasting, annotations over values, or values that contradict each other. Flagged, never concluded |
| Applies to the control | The screenshot shows what the control is about |

Then it tests each of the control's test attributes as pass, exception, or not determinable, with what it observed and what was expected. When the expectation is a policy it does not have, it says so rather than guessing.

The proposed conclusion is derived in code from those results, never taken from the model:

- An issue with legibility or applicability, or no linked attributes: **cannot conclude yet**.
- Any attribute exception: **exception**.
- Every attribute passes and no check has an issue: **no exception**.
- Otherwise: **cannot conclude yet**.

When a check finds an issue or an attribute is an exception, the auditor sees the agent's feedback on the file, and the agent drafts a follow-up request to the control owner (for example, "please send the same screenshot with the system clock visible"). The follow-up is a normal draft request: it goes out only after the usual approval. It never asks for passwords or access, and it never contains links. An unreadable image (too small, too large, or corrupt) gets a follow-up asking for a full-resolution capture.

A person with project update rights signs the review off: accept the proposed conclusion, or override it with a conclusion and a reason. A signed-off review is final, and its file is not reread. The sign-off is in the audit trail with the proposed and final conclusions. Nothing changes the request status. Testing workpapers and sample selection come in Phase 8.

## Evidence intake

Milestone 8.1c. The team adds evidence on the **Evidence** page, **Files** tab: drop a folder (or choose one) or files from the computer. Every file inside a folder uploads, subfolders included, and its folder path is kept (for example `Acme PBC/ITGC-AC-02 Leavers`). System files (`.DS_Store`, `Thumbs.db`, `desktop.ini`, Office `~$` files, hidden folders), empty files, and files over 25 MB are skipped and listed. Three files upload at a time, with progress.

`POST .../evidence-uploads?batch_id=&name=&path=` takes one file's bytes. The service hashes them and keeps the same immutable custody record as a mailbox attachment, with `source = UPLOAD`, the folder path, the batch, and the person. A name or path that climbs out of its folder, names a drive, or holds control characters is refused. The same bytes with the same name and folder are stored once, so uploading a folder again is safe.

Each upload is matched to its control by the evidence coordinator, in the same background job that reads it:

1. **Rules.** A control ID in the folder path or file name, however it is spelled (`ITGC-AC-02`, `itgc_ac_2`, `AC-02` when only one control has it), is a confident match. Two different IDs are not.
2. **Claude.** Otherwise Claude chooses from the engagement's in-scope controls, from the folder path, the name, the columns, and an excerpt of the text, and says how sure it is. Only a control from the list can be chosen. At 80% or more the file is filed; below that, the answer becomes suggestions.
3. **Suggestions.** Without a model, or when the answer is rejected, controls sharing words with the file are suggested.

A confident match is filed at once and shown as **Filed by agent** with its confidence and reason. Anything else waits in **Needs a match** with up to three suggestions. The file is then read and classified against its control's request, screenshots are reviewed, and a population can propose samples, all as for a mailbox file.

Filing marks the control's request (the earliest open one, sample requests last):

- **Received** when the files filed to it cover every requested item, or the request lists no items; **partly received** otherwise. Without a drafted item list (a request sent from the evidence plan skips its draft), each requested item counts by its own evidence, as the plan shows it: a file added on the item, a file on the request the reader does not say misses it, a file a sibling control shares, or one a person linked (31 October 2026: one item's file marked such a request received, so its other items read received with nothing of their own).
- A sent request moves as if the owner replied, and its open follow-ups stop once it is received.
- A received request does not by itself start testing. A phase goes to testing only once each of its requested items is complete: a person accepted it, the evidence reader found a file that covers it in full, or it is marked not applicable (product owner, 31 October 2026: one design file moved the control to Testing, though the reader found it covered the item only in part). Until then the phase stays at the Request step and says how many items are not complete.
- A sample of one is traced across the item's files (product owner, 31 October 2026; `sample_traces.py`, migration 0139). The reader judges each file alone, so a population, two system extracts and a ticket that together walk one leaver through the control each read as not covering the item. On a design item that asks for the control's execution, the trace reads them together: it recognizes the sample from the evidence (a ticket or document that names a person, account or ticket number found in one of the item's listings; identifiers are matched whole, never a surname alone, and only from columns whose values tell rows apart), and proposes it with its reasons; a person confirms it or picks another. When nothing names the sample, or several fit, it asks which one is the sample, lists the likely rows, and offers a search of the listing. Once there is a sample each file says what it shows for it ("traces Farah Navarro, row 1", "no row for Farah Navarro") in place of the reader's coverage, and the dates line up against the event: each removal with its business days (weekdays; holidays are not known) against the limit the control states, and activity after the event. A document that names no one in the listings, such as a walkthrough memo, is shown as general and is not a point. What the trace observes once a person confirms the sample (a removal over the limit, a listing with no row for the sample, a document about another instance, activity after the event) becomes findings with a drafted follow-up a person sends; a later pick leaves the earlier pick's findings stale. Matching and dates are deterministic, no model reads the files for the trace, and the trace never accepts the item: a full trace with nothing to settle says it is ready for a person to accept. A pick from the evidence dialog's row picker records the same findings.
- A request that was never sent (a draft, or awaiting approval) is marked **provided directly, not by email**. Its pending send approval is withdrawn (`approval.withdrawn`), so it never goes out. Migration 0033 allows this status without an outbound message only for such requests.
- A received, closed, or cancelled request is not changed.

A person can file a file that needs a match, confirm the agent's filing, move a file to another control, or take it off its control (`POST .../evidence-files/{id}/filing`). Moving or filing reads the file again against the new control. The old request follows the evidence left on it (`evidence_receipts.follow_evidence`): received while every item still has evidence or a person accepted every item, partly received while some evidence is left, and back to the status it had before any evidence came once none is left. An unsent request goes back to draft, since its withdrawn approval does not return. A file whose screenshot review is signed off stays filed. Every change is in the audit trail (`evidence.uploaded`, `evidence.filed`, `pbc.received_from_evidence`, `pbc.receipt_undone`).

On a control's **Evidence** tab, each file the control received is listed with what the agents found: its kind, the screenshot review's proposed conclusion (or its signed-off one), the feedback, and the follow-up points; opening a file shows the whole reading and review, with its sign-off. The tab refreshes while files are being read.

`GET .../evidence-register` lists every stored file, uploaded or emailed, with its folder, control, request status, kind, and agent review, for the register. The `evidence_file_links` view gives each file's request and control however it arrived, and the console, sampling, and reading all use it.

## Secure upload links

Milestone 8.12. Evidence comes from the client only through a secure upload link, never as an email attachment (`evidence_portal.py`, migration 0066).

**The link.** An evidence request email (template `pbc-request` version 2) and its reminders (`pbc-reminder` version 2) carry a link instead of asking for attachments. The approver approves the message with a placeholder where the link goes; when the message is delivered, a new link is minted for the recipient and put in its place. Only the SHA-256 hash of the link's token is stored (`evidence_portal_links`), so neither the database nor the audit trail holds a working link. The link belongs to the recipient on that engagement: it opens every request sent to that address that is still open (sent, not closed or cancelled) and no more than 30 days past its due date (`DAYS_AFTER_DUE`). It works from `APP_BASE_URL` (`/upload/<token>`).

**Proving it is them.** Opening the link shows the engagement and the address masked (`i**@client.example`), and nothing else. The owner asks for a code, which is emailed to the same address: six digits, valid for 10 minutes, five tries, at most five codes an hour per link (`evidence_portal_codes`, hashed with the link's id). A wrong try is counted even though the request fails. The code opens a session of two hours (`evidence_portal_sessions`, hashed), held by the web app in an httpOnly, SameSite=Strict cookie (`aw_portal`) that the page's scripts cannot read. The page sets `Referrer-Policy: no-referrer` and asks search engines not to index it. When email cannot be sent, no usable code is issued and the owner is asked to contact the audit team. With the mock mailbox and `EMAIL_MOCK_INBOUND_ENABLED=true` (local development only), the page shows the code instead, since no email leaves.

**Uploading.** In the session the owner sees their open requests (reference, control, what is asked, the due date, and until when uploads are open) and the names of the files they have sent; they can never see or download anything else, except reference materials the audit team explicitly shared on one of those requests (migration 0075; see [pbc.md](pbc.md#request-details)), which they can download in the session. Material kept internal is never listed. Each file (up to 25 MB) is stored with the same immutable custody record as any upload, with the owner's address in place of a team member (`evidence_files.uploaded_by_email`, `portal_session_id`; `stored_by` is empty only for these). It is filed by its owner to the request's control (`evidence_matches.filed_by = 'OWNER'`), and the evidence coordinator reads it as it reads every file, which marks the request received or partly received. The request's owner on the team is recorded as having asked for that reading. The register shows such a file as added by `<address> (secure link)`.

**The owner's workspace.** The portal (`portal_workspace.py`, migration 0078; web `portal-view.tsx`) is the owner's working space. The list shows summary counts that filter it, search, status and type filters, a due-date sort, and one compact row per request (title, reference, control, type, period, due date, status, and how many items have files). Requests closed by the team stay listed, read only. Opening a request (kept in the address as `?request=`) shows its explanation, then each requested item (a numbered item of its wording) as its own card with its period, format and expectations, the files sent for it, and a drag-and-drop upload with progress, a 25 MB check before sending, and retry. A request a person wrote freely is shown as written, with one upload. The wording's closing line is kept apart from the last item (`ContentBody.closing`).

- *Uploads* reach the audit team the moment they arrive, as before (decided by the product owner). An upload names the item it is for (`evidence_matches.owner_item`), and is linked to the item's planned requirement, by title, as `origin = 'OWNER'` (`evidence_requirement_files`). A file arriving never makes anything accepted: the item reads *Uploaded* until the team judges the requirement's sufficiency.
- *Statuses* are derived, never stored: Awaiting your response, In progress, Submitted, Under review, More information requested (a requirement judged insufficient or needing follow-up), Completed (every requirement accepted, or the request closed).
- *Answers.* The request's questions take answers (`request_answers`, keyed by a hash of the question's wording, so an answer stays with its question; edits are audited as `evidence.portal_answered`).
- *Messages.* The owner and the team write to each other on the request (`request_messages`, immutable except that the team marks the owner's messages seen). A team reply (`POST .../pbc-requests/{id}/messages`, people with task update rights) emails the owner a fresh secure link with the message, through the mailbox and only to an allowed recipient. Opening the request on the team side marks the owner's messages seen. Audit: `evidence.portal_message`, `request.message_sent`.
- *Submit evidence* records that the owner is done (`pbc_requests.owner_submitted_at`, an optional note). It needs at least one file; items still without a file need the owner's confirmation. The owner can add files and submit again.
- The team reads all of it under **Client responses** on the request. Nothing internal (planning, rationale, testing, other people's files) reaches the owner, who still cannot open or download files they sent.

**The team.** The Evidence page's Requests tab lists **Secure upload links**: each owner holding one, their open requests, when they last opened the link and last uploaded, and **Turn off**, which revokes every link that address holds on the engagement and ends its sessions (`POST .../evidence-portal/revoke`). A new request email gives the owner a new link. With the mock mailbox, **Open as owner** mints a preview link for local testing (`POST .../evidence-portal/preview-link`); the API refuses it with any other mailbox.

**Email attachments.** An attachment on a client's reply is kept with the reply and shown as *Not taken as evidence*; the API refuses to store it as evidence (`POST .../mailbox-attachments/{id}/content` answers 409). Files stored from email before this milestone keep their custody and stay readable.

**Audit.** `evidence_portal.code_sent` (with whether it was delivered), `evidence_portal.code_refused`, `evidence_portal.verified`, `evidence.portal_uploaded` (the request, the file's hash and size), `evidence_portal.revoked`, and `evidence_portal.preview_link`. The owner acts without an account, so these have no actor, and none of them holds the owner's address or any token.

## Storage

Object storage uses the S3 API. See [ADR 0005](decisions/0005-object-storage.md).

Leave `S3_ENDPOINT_URL`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` empty to use the mock store. The mock keeps bytes in `mock_objects`. Tests use that store.

`make start` runs MinIO on `localhost:9000`. The community images are no longer anonymously pullable, so Compose uses `quay.io/minio/aistor/minio:RELEASE.2026-09-19T17-05-25Z`. To use it, create a private bucket and set the four values. Use `http://localhost:9000` as the endpoint. The MinIO root user and password are the access key and secret. The API does not log them. A bucket that is not private is out of policy.

## Evidence by application

A control often covers several applications (a password control over Active Directory, the database, the ERP, Linux, and AWS). Each evidence file is tagged with the application it shows (migration 0035, `evidence_apps.py`):

- **One application.** The file shows one of the control's applications.
- **All applications.** The file applies to every one of them, such as a policy.
- **Some applications.** A person named several of them (migration 0102); only a person sets this.
- **Not known.** The coordinator could not tell, and the file did not come in on one application's request; a person sets it.

Claude names the application while it classifies the file, from the applications of the control's family only (every instance of the control, see [controls per application](onboarding.md#controls-per-application-85)). Otherwise the rules look for the application's name, its acronyms (Active Directory as AD, E-Business Suite as EBS, Red Hat Enterprise Linux as RHEL, Database as DB), and words only that application has, in the file name and folder first. A control with one application tags every file with it. When neither can tell, a file uploaded to a request takes the application of that request's control instance, since each instance is for one application (`request_default`; the reason reads "Uploaded to the request for …"). A file the reader sees showing another application, or all of them, keeps that tag. A person can change the tag on the control's Evidence tab or in the file panel on the Evidence page; a person's tag is never overwritten, and the file is placed again for testing.

**Policies and procedures across systems (product owner, 22 Oct 2026).** Adding evidence on a policy or procedure item (process documentation) of a control over several systems asks which systems it applies to: all of them, or only those ticked (this instance's system is ticked first). The answer is the person's tag, which the coordinator never changes. The file then serves the same item (same phase and requirement key) on each named system's instance of the control, shown there as "shared from" the system it was added on, with what the reader found; testing places it on each of them (`place_by_application`), and readiness and the register count it for each. A tag only the coordinator suggested shares nothing with other items, though testing still uses it. Shared items: `evidence_plans.shared_from_sibling`; the tag test: `evidence_apps.tag_covers` and `control_instances.FAMILY_FILES`.

**Decision (product owner, 22 Oct 2026).** A file uploaded to an instance's request was left Not known when its name and text named no application, and every such file was flagged "Application not set" though it was uploaded for that application, and testing already placed it there. Such a file now takes the request's application; migration 0100 applies this to earlier files the coordinator left Not known on an instance's request (a person's tag is never changed). The test `test_a_control_over_several_applications_is_tested_per_application` expected `notes.csv`, uploaded to the Active Directory request, to stay `UNKNOWN`; it now expects `ONE`, Active Directory, with that reason. Where the file is tested is unchanged.

An instance's Evidence tab shows its own files and those a sibling instance shares with it (tagged for every application, or for this one), grouped by application. A file uploaded to one instance's request but showing another application is tested on that other instance. In the Controls register, each instance counts the files that are evidence for it. When a file names a control that has several instances, the rules file it to the instance of the application it shows; a policy for every application is filed to the first and shared; otherwise a person chooses the instance.

## Withdrawing and replacing evidence

Milestone 8.3b. A custody record is never changed or deleted, so a file added by mistake is withdrawn or replaced, never removed (migration 0038). Anyone who can upload evidence on the project can do either, on the file's side panel on the **Evidence** page or on the control's **Evidence** tab. Replacing and restoring take a reason. Withdrawing takes one only if the person gives it (by the product owner's decision, 22 Oct 2026): who withdrew the file and when are always recorded, and a withdrawal without a reason records "No reason given." Each change is in the audit trail. The same bytes as a withdrawn file, added again on an item of its request, restore it for that item (the restoration recorded as the person's); added any other way, they are refused and the file is restored from the withdrawn files.

- **Withdraw** (`POST .../evidence-files/{id}/withdraw`). The file leaves the register, its request, its control's testing, the workpapers, and the console. Its request follows the evidence left on it, as when a file is moved, whichever file first marked it received (31 October 2026: withdrawing one of two items' files left the request received). A restored file counts again, and a request whose every item a person accepted is received again. The file comes off the open test sheet's items, and the tester looks again. Its record and bytes stay, and it can still be downloaded.
- **Replace** (`POST .../evidence-files/{id}/replace?name=&reason=`, with the new file's bytes). The new file is stored as a new custody record and takes the old one's place: its control and request (filed by the person), the application it shows, and the sample items it was on. The request's receipt moves with it, so the request does not change. The old file is withdrawn and names its replacement. The agent reads the new file, and testing runs again. The same bytes are refused.
- **Restore** (`POST .../evidence-files/{id}/restore`). A withdrawn file returns to its control and request, and the tester looks again. A replaced file is not restored; withdraw its newer version instead.

Withdrawn files are listed under **Withdrawn**, with who withdrew them, when, why, and any replacement. Uploading a withdrawn file again is refused with a pointer to restore it.

Evidence someone relied on stays. A file cannot be withdrawn or replaced while:

- the agent is still reading it;
- its screenshot review is signed off;
- an approved sample was drawn from it (a population file);
- a person accepted an evidence item it served at the time (a population accepted as complete and accurate included; a file added after the acceptance was not part of it);
- it is on an item of signed-off testing; or
- a prepared workpaper cites it.

Anything else can be withdrawn or replaced, whatever else its control has signed off (product owner, 31 October 2026: a file uploaded after the control's design workpaper was prepared, and never accepted or used, could not be removed). A person changes the decision or reopens that work first, with a reason. On a control's Request step and in the evidence dialog the withdrawal is sent in place: a refusal shows its reason in the form, and a withdrawal is confirmed on the item or in the dialog, with no page reload (31 October 2026: a refused withdrawal reloaded the page with its notice inside the closed Files received section, so nothing seemed to happen). A proposed sample whose population was withdrawn cannot be approved; the replacement's population proposes it again.

## Previewing evidence

Milestone 8.4b. Every evidence file can be previewed in the page, from the **Preview** button on its row on a control's **Evidence** tab, from its side panel in the evidence register, and from its chip on the **Testing** tab.

- **PDFs** are rendered page by page in the browser (pdf.js, `pdfjs-dist` 6.3.289). Forms and scripts in the PDF are never run.
- **Images** (PNG, JPEG, GIF, WebP) are shown as they are.
- **Spreadsheets, CSVs, and documents** are shown as the text the evidence coordinator read from them, with sheets as headings and rows as tables.

`GET .../evidence-files/{id}/preview` serves a file inline only when its own bytes are a PDF or one of those images, whatever its declared type. An HTML or SVG file is never shown inline. The response is marked `nosniff`, `Content-Security-Policy: sandbox`, and not cached, and is read through the custody check. `GET .../evidence-files/{id}/reading` returns the read text, up to 200,000 characters. A withdrawn file can still be previewed, as it can be downloaded.

## Evidence-to-attribute mapping

Milestone 3b (`evidence_mapping.py`, migration 0096). For a control whose evidence plan is
approved, **Map evidence** on the Test step (or `POST …/controls/{id}/evidence-mapping`)
reads the approved attributes at the plan's current revision and, for each, names what
the plan requires, which in-force files are candidates (the files linked to the
requirements that serve the attribute, or sent on their requests), the passages that bear
on it, the facts those passages state and the interpretations drawn from them, what is
missing, what conflicts, and a status: MISSING, INCOMPLETE, CONTRADICTORY,
POTENTIALLY_SUFFICIENT or UNKNOWN. Every passage is a quote the file holds, found in its
stored text and located to a page, a sheet, a data row and a column (with the cell for a
workbook), or the file; a quote the file does not hold is dropped, a fact without one
becomes an inference marked unverified, a sufficient status without a verified passage is
lowered, and a contradiction needs two verified passages. The run is a proposal for the
tester, never a test conclusion, and changes nothing else: the plan, the attributes, a
requirement's sufficiency, approvals and sign-offs are untouched. Runs are append-only
and pinned to the plan revision, the attribute list and each file's content hash; a read
says when a run is stale (a file replaced, withdrawn or added; the attributes changed; the
plan approved again). Without a model the rules name the candidates and a person maps.
The model sees the files as untrusted data inside the evidence block; an instruction in a
file is content to report, never followed ([milestone-3-plan.md §16](milestone-3-plan.md)).

## The evidence dialog

In a request's panel each evidence item is a card (product owner's reference, 31 October 2026). Each file it holds shows as a file card: its type, name and coverage, when it was uploaded and its size (and who linked it, for a linked file), the evidence reader's proposal as a pill that opens what it found, and the file's own menu (Download, Replace file, Withdraw, Unlink). An item with no file says "No evidence linked yet". One action bar closes the card: Add or link evidence (upload, a policy on file, or a file the control holds), the item's menu (Insufficient, Follow up, Mark not applicable), and Accept evidence, which accepts this item only and shows only when a file of its own serves it (the API refuses to accept an item no file serves: a request received as a whole, or a file for another item, is nothing to accept). A person can reopen a decision from the item's menu, with why; the item is then judged again. Unlinking an item's file moves its request as a withdrawal does: the request follows the evidence left on it.

Since 31 October 2026 (product owner) evidence is added and reviewed in one dialog on the control's Request step (`evidence-dialog.tsx`). Adding: the person chooses the item (by phase, always in view), drops or browses the file, and the evidence reader classifies it as it does every file; the dialog shows the type, the reader's confidence and why, and suggests the next step by phase and type. A population on a design item offers a sample of one picked from its rows (`walkthrough_instances.py`, migration 0138), interim testing (the file linked to the interim population item as well), or keeping it in Design & Implementation. A population on an operating item is confirmed, accepted as complete and accurate by a person, then sampled at the size the person chooses (1, 5, 10 or another number; the test plan's size is shown beside it and both are audited) and approved by a person. Any other file is confirmed or retyped. Once a file is in hand the drop zone gives way to the file (product owner's reference, 31 October 2026): its status, name, type, size and date with Preview, Data (for a table) and Details, a document tile with its withdraw action, the item and phase it is for, whether it is ready for review, and its viewer with a full-screen preview; another file for the item is added from "Add another file for this item". Reviewing (no progress steps): the same dialog opens on a file with its Preview, Data (for a table), Details and Traceability, and the findings, coverage and decisions of the evidence findings below.

## Evidence findings

Increment 2 of the Evidence Intelligence Workspace (`evidence_findings.py`, migration
0137; [evidence-intelligence.md](evidence-intelligence.md)). When a reading lands, the
reader's gaps become findings (with the question the reader proposed for each and the
passage it rests on, kept only when the quote is in the stored text), as do the requested
items the file covers in part or not at all, and the deterministic checks on the read
text: placeholder text located to its line, a policy or design document whose text
states no version, approval or effective date, and dates outside an interim or
roll-forward item's window. When a mapping run completes, what an attribute still lacks,
the conflicts between passages and the concerns become findings too. A finding is
recorded once per content (a fingerprint), pinned to the plan revision and the file's
hash, and marked stale when the plan is approved again, the file is replaced or
withdrawn, or a later reading no longer finds it; a mapping finding names the approved
attribute by its own identifier and code; findings are never deleted and their history
(`evidence_finding_events`) is append-only.

A person accepts, edits the question, dismisses, resolves, accepts a clarification, asks
for more, marks not applicable (with a reason), escalates or reopens
(`POST …/controls/{id}/evidence-findings/{finding}/decide`, project update rights, a
person only). The accepted findings go to the control owner as one message on the
request (`POST …/controls/{id}/evidence-findings/follow-up`), composed from their
questions, reviewed and confirmed by the person; links and requests for credentials are
refused, the owner is emailed a fresh link, and the send is audited
(`evidence.follow_up_sent`). The owner's message, portal answers or submission on the
request, or a later file read on it, attach to the open findings and propose ANSWERED; a
person decides what it resolves. An agent never sends a follow-up and never closes a
finding.
