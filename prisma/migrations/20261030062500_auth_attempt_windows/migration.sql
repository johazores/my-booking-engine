-- Database-clock, cross-instance credential ingress budgets.
-- Subject digests are keyed HMACs, never plaintext emails or untrusted IP headers.
CREATE TABLE "auth_attempt_windows" (
  "operation" VARCHAR(16) NOT NULL,
  "scope" VARCHAR(12) NOT NULL,
  "subjectHash" CHAR(64) NOT NULL,
  "windowStart" TIMESTAMPTZ(6) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "auth_attempt_windows_pkey"
    PRIMARY KEY ("operation", "scope", "subjectHash", "windowStart"),
  CONSTRAINT "auth_attempt_windows_operation_check" CHECK ("operation" IN ('sign-in', 'sign-up')),
  CONSTRAINT "auth_attempt_windows_scope_check" CHECK ("scope" IN ('identity', 'global')),
  CONSTRAINT "auth_attempt_windows_attempts_check" CHECK ("attempts" BETWEEN 1 AND 5000),
  CONSTRAINT "auth_attempt_windows_subject_hash_check" CHECK ("subjectHash" ~ '^[0-9a-f]{64}$')
);
CREATE INDEX "auth_attempt_windows_windowStart_idx"
  ON "auth_attempt_windows" ("windowStart");
