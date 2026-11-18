-- The development object store holds the original file of a policy or procedure too
-- (migration 0125), under documents/. It stays write-once, as evidence does.

ALTER TABLE mock_objects DROP CONSTRAINT mock_objects_key;
ALTER TABLE mock_objects ADD CONSTRAINT mock_objects_key
    CHECK (object_key ~ '^(evidence|exports|documents)/[0-9a-f-]{36}$');
