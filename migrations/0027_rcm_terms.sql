-- The client's terms, mapped by an agent. After an upload, and when a person asks to
-- remap, an agent maps each distinct client term for area, frequency, and nature to a
-- standard value, with a short reason. Filling only sets terms a person has not mapped;
-- remapping redoes every term. A person still reviews the mapping before import.

ALTER TABLE rcm_imports
    ADD COLUMN terms_status text NOT NULL DEFAULT 'PENDING',
    ADD COLUMN terms_mode text NOT NULL DEFAULT 'FILL',
    ADD COLUMN terms_source text,
    ADD COLUMN terms_note text NOT NULL DEFAULT '',
    ADD COLUMN terms_basis text NOT NULL DEFAULT '',
    ADD COLUMN terms_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN terms_lease_until timestamptz,
    ADD COLUMN terms_model_call_id uuid,
    ADD COLUMN term_reasons jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD CONSTRAINT rcm_imports_terms_status CHECK (
        terms_status IN ('PENDING', 'WORKING', 'READY', 'FAILED')
    ),
    ADD CONSTRAINT rcm_imports_terms_mode CHECK (terms_mode IN ('FILL', 'REMAP')),
    ADD CONSTRAINT rcm_imports_terms_source CHECK (
        terms_source IS NULL OR terms_source IN ('MODEL', 'RULES')
    ),
    ADD CONSTRAINT rcm_imports_terms_note CHECK (char_length(terms_note) <= 200),
    ADD CONSTRAINT rcm_imports_terms_attempts CHECK (terms_attempts BETWEEN 0 AND 20),
    ADD CONSTRAINT rcm_imports_term_reasons CHECK (jsonb_typeof(term_reasons) = 'object'),
    ADD CONSTRAINT rcm_imports_terms_call_fk
        FOREIGN KEY (terms_model_call_id) REFERENCES model_calls (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Uploads made before this migration were mapped by rules only. They stay as they are.
UPDATE rcm_imports SET terms_status = 'READY', terms_source = 'RULES' WHERE status <> 'MAPPING';
