-- A scoping review asked for while one is running runs again once it finishes, so a
-- change made meanwhile (the controls loading, say) is not missed.

ALTER TABLE system_reviews ADD COLUMN again boolean NOT NULL DEFAULT false;
