"""Northstar Technologies, Inc.: the synthetic FY2027 IT SOX engagement a trial firm's demo
is built from (Trial Management and Synthetic Demo Experience, Step 4A; dataset
`northstar/1`).

Everything here is fiction, generated deterministically from one seed so every firm's
demo reads the same and every relationship holds: a terminated employee in the HR
listing is the same person, with the same dates, in the SAP user listing and the removal
log; a transport without an approval is the same transport in the import log, the change
ticket population and the CAB minutes. The expected outcomes are not kept here: the
tests derive them from these records (tests/northstar_manifest.py), and no runtime
agent is given them.

- records.py: the populations (people, users, requests, transports, tickets, jobs,
  invoices, revenue) and the engagement's profile, systems and controls;
- files.py: the evidence files rendered from the records (CSV, XLSX, PDF, DOCX);
- dataset.py: the DemoDataset that writes it all for one firm (demo_datasets.py).
"""
