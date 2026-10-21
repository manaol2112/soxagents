-- Milestone 3a closure: what an agent call was made from. The evidence files (ids and
-- content hashes), the sheet and its version, the approved plan revision, the request or
-- control the call worked on, as the job knew them when it asked. With the prompt
-- version and the model this makes the call reproducible and reviewable without the
-- prompt text. Never the key, never the prompt.

ALTER TABLE model_calls
    ADD COLUMN inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD CONSTRAINT model_calls_inputs_object CHECK (jsonb_typeof(inputs) = 'object');
