-- Clients (Milestone 8.18).
--
-- A firm keeps a list of its clients, and each engagement belongs to one. Until now the
-- client was a line of text on each engagement, so nothing tied two years of the same
-- client together and a typo made a second client. A client's name is unique in the firm
-- however it is cased or spaced. Each engagement's settings keep a copy of its client's
-- name for the pages that read it; the database keeps that copy equal to the client's
-- name, so renaming a client renames it on every engagement.

CREATE TABLE clients (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES organizations (id),
    name text NOT NULL,
    created_by uuid REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT clients_name CHECK (
        char_length(name) BETWEEN 1 AND 200 AND name = btrim(name) AND name !~ '\s{2,}'
    ),
    CONSTRAINT clients_scope_key UNIQUE (id, organization_id)
);

CREATE UNIQUE INDEX clients_name_folded ON clients (organization_id, lower(name));

ALTER TABLE engagement_settings
    ADD COLUMN client_id uuid,
    ADD CONSTRAINT engagement_settings_client_fk
        FOREIGN KEY (client_id, organization_id) REFERENCES clients (id, organization_id);

CREATE INDEX engagement_settings_client ON engagement_settings (client_id)
    WHERE client_id IS NOT NULL;

-- The engagements' clients so far: one per firm and name, ignoring case and spacing, in
-- the spelling of the firm's first engagement for it.
INSERT INTO clients (organization_id, name, created_at)
SELECT DISTINCT ON (s.organization_id, lower(regexp_replace(btrim(s.client_name), '\s+', ' ', 'g')))
       s.organization_id, regexp_replace(btrim(s.client_name), '\s+', ' ', 'g'), p.created_at
FROM engagement_settings s
JOIN projects p ON p.id = s.project_id
WHERE btrim(s.client_name) <> ''
ORDER BY s.organization_id, lower(regexp_replace(btrim(s.client_name), '\s+', ' ', 'g')),
         p.created_at;

UPDATE engagement_settings s
SET client_id = c.id
FROM clients c
WHERE c.organization_id = s.organization_id
  AND lower(c.name) = lower(regexp_replace(btrim(s.client_name), '\s+', ' ', 'g'))
  AND btrim(s.client_name) <> '';

UPDATE engagement_settings s
SET client_name = c.name
FROM clients c
WHERE c.id = s.client_id AND s.client_name <> c.name;

-- An engagement's copy of its client's name follows the client.
CREATE FUNCTION engagement_client_name() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.client_id IS NULL THEN
        NEW.client_name := '';
    ELSE
        SELECT name INTO NEW.client_name FROM clients WHERE id = NEW.client_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER engagement_settings_client_name
    BEFORE INSERT OR UPDATE OF client_id, client_name ON engagement_settings
    FOR EACH ROW EXECUTE FUNCTION engagement_client_name();

CREATE FUNCTION client_renamed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE engagement_settings SET client_name = NEW.name WHERE client_id = NEW.id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER clients_renamed
    AFTER UPDATE OF name ON clients
    FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name)
    EXECUTE FUNCTION client_renamed();
