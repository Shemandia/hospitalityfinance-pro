CREATE OR REPLACE FUNCTION prevent_audit_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is immutable; updates and deletes are not allowed';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_audit_event_update ON audit_events;
CREATE TRIGGER trg_prevent_audit_event_update
BEFORE UPDATE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_event_mutation();

DROP TRIGGER IF EXISTS trg_prevent_audit_event_delete ON audit_events;
CREATE TRIGGER trg_prevent_audit_event_delete
BEFORE DELETE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_event_mutation();
