-- Reverse-and-replace (import plan, owner decision 5): a posted source
-- document is never posted twice, but it can be replaced on purpose. The
-- original is reversed and the corrected document is posted as the next
-- revision of the same reference, in one transaction, by someone holding
-- INTEGRATIONS_REPLACE, with an audit event linking the three journals.

-- One posting per entity, source system, reference and revision. A plain
-- second post is revision 0 again and is refused, as before.
DROP INDEX "journals_entity_id_source_system_source_document_ref_key";

ALTER TABLE "journals"
    ADD COLUMN "replaces_journal_id" TEXT,
    ADD COLUMN "source_revision" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "journals_replaces_journal_id_key" ON "journals"("replaces_journal_id");

CREATE UNIQUE INDEX "journals_entity_id_source_system_source_document_ref_source_key"
    ON "journals"("entity_id", "source_system", "source_document_ref", "source_revision");

ALTER TABLE "journals" ADD CONSTRAINT "journals_replaces_journal_id_fkey"
    FOREIGN KEY ("replaces_journal_id") REFERENCES "journals"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- The permission, for tenants provisioned before this release (provisioning
-- writes the catalogue for new ones). ADMIN holds every permission.
INSERT INTO "permissions" ("id", "code", "description", "category", "updated_at")
VALUES (gen_random_uuid()::text, 'INTEGRATIONS_REPLACE',
        'Replace a posted imported document (reverse and post again)', 'Integrations', now())
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
  FROM "roles" r, "permissions" p
 WHERE r."code" = 'ADMIN' AND p."code" = 'INTEGRATIONS_REPLACE'
ON CONFLICT DO NOTHING;
