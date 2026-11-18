-- Citations in the agent console (product owner's request).
--
-- When an answer relies on what an evidence file says, the agent quotes the exact words.
-- The service checks each quote against the file's stored text before the answer is
-- saved: a quote it cannot find is dropped, so no citation is invented. Each kept
-- citation records the file, the quote, the passage around it, and where in the file it
-- is (a page, a sheet, or an image).

ALTER TABLE console_messages ADD COLUMN citations jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE console_messages ADD CONSTRAINT console_messages_citations CHECK (
    jsonb_typeof(citations) = 'array' AND jsonb_array_length(citations) <= 40
);
