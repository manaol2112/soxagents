# Evidence files

Milestone 7.1 stores the bytes for an inbound attachment. Milestone 7.3 reads each stored file and suggests what kind of evidence it is. Milestone 7.4 has the control's tester review screenshots and test them against the control, for a person to sign off. None of them changes a request: a person still marks it received.

## Custody

A person with project update rights sends the bytes to `POST .../mailbox-attachments/{id}/content`. The service hashes them. The number of bytes must equal the attachment's recorded size. When the mail already declared a SHA-256 hash, the bytes must match it. The file name and type come from that attachment record, not from the upload.

The same bytes stored again return the same record. Different bytes are refused. The application generates the object key, `evidence/{id}`. A database trigger rejects updates and deletes of the custody record.

`GET .../evidence-files/{id}/content` reads the object and returns it only when the hash and size still match the record. The response is an attachment download and is marked `nosniff`. A reader on the project can download. Another organization gets nothing. Audit payloads store the hash and size only, never the file name or the bytes.

## Reading and classification

Storing a file queues one analysis for it (`evidence_analyses`). The evidence coordinator reads the file in the background, on the local worker or a Temporal workflow (`evidence_analysis`), with up to three attempts. The bytes are read through the custody check: if the stored object no longer matches its hash, the analysis fails and the audit trail records it.

### Reading the file

Reading is deterministic and values-only (`evidence_extraction.py`). The kind comes from the file's bytes, not its name.

| File | What is read |
| --- | --- |
| `.xlsx` | Cell values from each sheet (cached results, never formulas or external links). The largest sheet gives the columns and the row count |
| `.csv`, `.txt` | The text. A CSV gives its columns and row count |
| `.docx` | Paragraphs and tables. Embedded images go to OCR |
| PDF | The text layer. Pages with almost no text are treated as scans and go to OCR. A password-protected PDF is not read |
| PNG, JPEG, GIF, BMP, TIFF, WebP | OCR |
| Anything else, including `.xls` and `.doc` | Not read. A person reviews it |

Limits: 200,000 characters of text, 300 PDF pages, 10 images for OCR, 100,000 rows, and archives that expand past 150 MB are refused before they are opened. Secret-looking values are redacted from the text that is kept.

### OCR

OCR sits behind one interface (`evidence_ocr.py`) with two engines:

- **Local** (the default): Tesseract, run as a fixed command with the image on stdin. Images never leave the firm. Set `OCR_TESSERACT_PATH`, or put `tesseract` on the `PATH`. Without it, the file is marked for a person to read.
- **Model**: the configured model provider reads up to five page images in one call. A firm's owner or admin opts in under **AI workforce → Evidence reading** (`PUT /organizations/{id}/evidence-settings`). The change is audited. If the model cannot answer, local OCR is tried next. Without the opt-in, no image is ever sent.

### Classification

The suggestion says what kind of evidence the file is (population, walkthrough, design, configuration, change history, key report, policy, sample, or other), how it covers each item its request asked for (covered, partly covered, not covered), what to follow up, and the period the file shows.

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

## Storage

Object storage uses the S3 API. See [ADR 0005](decisions/0005-object-storage.md).

Leave `S3_ENDPOINT_URL`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` empty to use the mock store. The mock keeps bytes in `mock_objects`. Tests use that store.

`make start` runs MinIO on `localhost:9000`. The community images are no longer anonymously pullable, so Compose uses `quay.io/minio/aistor/minio:RELEASE.2026-09-19T17-05-25Z`. To use it, create a private bucket and set the four values. Use `http://localhost:9000` as the endpoint. The MinIO root user and password are the access key and secret. The API does not log them. A bucket that is not private is out of policy.
