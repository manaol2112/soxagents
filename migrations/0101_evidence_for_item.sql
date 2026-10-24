-- Evidence added for one item of a request (by the product owner's decision, 22 Oct 2026).
--
-- One request often asks for several items (the access policy and one walkthrough
-- instance). A person who adds a file on one item says what it is for: the file serves
-- that item only, and the evidence reader judges it against that item only. A file added
-- on the request itself, or sent by the owner, serves the request's items as before (each
-- one the reader does not find it fails to cover).
--
-- requirement_id names the item. It is set only on a file filed to a request, and the
-- application checks it is one of that request's items. Taking the file off its request
-- clears it.

ALTER TABLE evidence_matches
    ADD COLUMN requirement_id uuid,
    ADD CONSTRAINT evidence_matches_requirement_fk
        FOREIGN KEY (requirement_id) REFERENCES evidence_requirements (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT evidence_matches_requirement_filed CHECK (
        requirement_id IS NULL OR (status = 'FILED' AND pbc_request_id IS NOT NULL)
    );
