-- An evaluation fingerprint identifies the evaluated source/configuration state.
-- It is audit evidence, not a workspace-run idempotency key: the same export
-- must be importable again after canonical state or importer logic changes.
DROP INDEX IF EXISTS "ImporterV2WorkspaceBatch_evaluationFingerprint_key";

CREATE INDEX IF NOT EXISTS "ImporterV2WorkspaceBatch_evaluationFingerprint_idx"
ON "ImporterV2WorkspaceBatch"("evaluationFingerprint");
