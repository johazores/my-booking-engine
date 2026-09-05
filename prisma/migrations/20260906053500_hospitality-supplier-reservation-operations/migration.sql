CREATE TYPE "HospitalitySupplierReservationOperationStatus" AS ENUM (
  'PREPARED',
  'SUBMITTING',
  'CONFIRMED',
  'AMBIGUOUS',
  'RECONCILING',
  'FAILED'
);

CREATE TYPE "HospitalitySupplierReservationAttemptKind" AS ENUM (
  'CREATE',
  'RECONCILE'
);

CREATE TYPE "HospitalitySupplierReservationAttemptStatus" AS ENUM (
  'STARTED',
  'SUCCEEDED',
  'FAILED',
  'AMBIGUOUS',
  'NOT_FOUND'
);

CREATE TABLE "hospitality_supplier_reservation_operations" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "integrationId" UUID NOT NULL,
  "integrationCredentialVersion" INTEGER NOT NULL,
  "idempotencyKey" VARCHAR(120) NOT NULL,
  "requestFingerprint" CHAR(64) NOT NULL,
  "providerCode" VARCHAR(64) NOT NULL,
  "supplierPropertyReference" VARCHAR(4096) NOT NULL,
  "supplierOfferReference" VARCHAR(4096) NOT NULL,
  "offerFingerprint" CHAR(64) NOT NULL,
  "termsFingerprint" CHAR(64) NOT NULL,
  "reservationPayloadFingerprint" CHAR(64) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "expectedTotalMinor" BIGINT NOT NULL,
  "arrivalDate" DATE NOT NULL,
  "departureDate" DATE NOT NULL,
  "rooms" INTEGER NOT NULL,
  "adults" INTEGER NOT NULL,
  "childAges" INTEGER[] NOT NULL,
  "status" "HospitalitySupplierReservationOperationStatus" NOT NULL DEFAULT 'PREPARED',
  "providerReservationReference" VARCHAR(512),
  "lastProviderCorrelationId" VARCHAR(512),
  "lastFailureCode" VARCHAR(64),
  "lastFailureRetryable" BOOLEAN,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMPTZ(6),
  "reconciledAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "hospitality_supplier_reservation_operations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hospitality_supplier_reservation_operations_credential_version_check" CHECK ("integrationCredentialVersion" >= 1),
  CONSTRAINT "hospitality_supplier_reservation_operations_idempotency_check" CHECK ("idempotencyKey" ~ '^[A-Za-z0-9._:-]{8,120}$'),
  CONSTRAINT "hospitality_supplier_reservation_operations_request_fingerprint_check" CHECK ("requestFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "hospitality_supplier_reservation_operations_offer_fingerprint_check" CHECK ("offerFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "hospitality_supplier_reservation_operations_terms_fingerprint_check" CHECK ("termsFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "hospitality_supplier_reservation_operations_payload_fingerprint_check" CHECK ("reservationPayloadFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "hospitality_supplier_reservation_operations_provider_code_check" CHECK ("providerCode" ~ '^[a-z][a-z0-9-]{1,63}$'),
  CONSTRAINT "hospitality_supplier_reservation_operations_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "hospitality_supplier_reservation_operations_total_check" CHECK ("expectedTotalMinor" >= 0 AND "expectedTotalMinor" <= 9000000000000000),
  CONSTRAINT "hospitality_supplier_reservation_operations_dates_check" CHECK ("departureDate" > "arrivalDate"),
  CONSTRAINT "hospitality_supplier_reservation_operations_occupancy_check" CHECK (
    "rooms" BETWEEN 1 AND 16
    AND "adults" BETWEEN 1 AND 64
    AND cardinality("childAges") <= 32
    AND array_position("childAges", NULL) IS NULL
    AND 0 <= ALL("childAges")
    AND 17 >= ALL("childAges")
    AND ("adults" + cardinality("childAges")) <= 64
  ),
  CONSTRAINT "hospitality_supplier_reservation_operations_attempt_count_check" CHECK ("attemptCount" >= 0),
  CONSTRAINT "hospitality_supplier_reservation_operations_confirmed_reference_check" CHECK (
    (
      "status" = 'CONFIRMED'
      AND "providerReservationReference" IS NOT NULL
      AND length(btrim("providerReservationReference")) >= 1
    )
    OR ("status" <> 'CONFIRMED' AND "providerReservationReference" IS NULL)
  ),
  CONSTRAINT "hospitality_supplier_reservation_operations_failed_contract_check" CHECK (
    "status" <> 'FAILED'
    OR ("lastFailureCode" IS NOT NULL AND "lastFailureRetryable" IS NOT NULL)
  ),
  CONSTRAINT "hospitality_supplier_reservation_operations_failure_code_check" CHECK (
    "lastFailureCode" IS NULL
    OR "lastFailureCode" ~ '^[A-Z][A-Z0-9_:-]{1,63}$'
  ),
  CONSTRAINT "hospitality_supplier_reservation_operations_provider_reference_check" CHECK (
    "providerReservationReference" IS NULL
    OR (
      "providerReservationReference" = btrim("providerReservationReference")
      AND "providerReservationReference" !~ E'[\\r\\n]'
    )
  ),
  CONSTRAINT "hospitality_supplier_reservation_operations_correlation_check" CHECK (
    "lastProviderCorrelationId" IS NULL
    OR (
      "lastProviderCorrelationId" = btrim("lastProviderCorrelationId")
      AND "lastProviderCorrelationId" !~ E'[\\r\\n]'
    )
  )
);

CREATE UNIQUE INDEX "hospitality_supplier_reservation_operations_id_org_key"
  ON "hospitality_supplier_reservation_operations"("id", "organizationId");

CREATE UNIQUE INDEX "hospitality_supplier_reservation_operations_org_idempotency_key"
  ON "hospitality_supplier_reservation_operations"("organizationId", "idempotencyKey");

CREATE UNIQUE INDEX "hospitality_supplier_reservation_operations_org_provider_reference_key"
  ON "hospitality_supplier_reservation_operations"("organizationId", "integrationId", "providerReservationReference");

CREATE INDEX "hospitality_supplier_reservation_operations_org_status_created_idx"
  ON "hospitality_supplier_reservation_operations"("organizationId", "status", "createdAt");

CREATE INDEX "hospitality_supplier_reservation_operations_org_integration_status_idx"
  ON "hospitality_supplier_reservation_operations"("organizationId", "integrationId", "status", "createdAt");

ALTER TABLE "hospitality_supplier_reservation_operations"
  ADD CONSTRAINT "hospitality_supplier_reservation_operations_integration_fkey"
  FOREIGN KEY ("integrationId", "organizationId")
  REFERENCES "integrations"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "hospitality_supplier_reservation_attempts" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "reservationId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "kind" "HospitalitySupplierReservationAttemptKind" NOT NULL,
  "status" "HospitalitySupplierReservationAttemptStatus" NOT NULL DEFAULT 'STARTED',
  "providerCorrelationId" VARCHAR(512),
  "normalizedFailureCode" VARCHAR(64),
  "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(6),
  CONSTRAINT "hospitality_supplier_reservation_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hospitality_supplier_reservation_attempts_sequence_check" CHECK ("sequence" >= 1),
  CONSTRAINT "hospitality_supplier_reservation_attempts_completion_check" CHECK (
    ("status" = 'STARTED' AND "completedAt" IS NULL)
    OR ("status" <> 'STARTED' AND "completedAt" IS NOT NULL)
  ),
  CONSTRAINT "hospitality_supplier_reservation_attempts_failure_code_check" CHECK (
    (
      "normalizedFailureCode" IS NULL
      OR "normalizedFailureCode" ~ '^[A-Z][A-Z0-9_:-]{1,63}$'
    )
    AND ("status" <> 'FAILED' OR "normalizedFailureCode" IS NOT NULL)
  ),
  CONSTRAINT "hospitality_supplier_reservation_attempts_kind_status_check" CHECK (
    "status" <> 'NOT_FOUND' OR "kind" = 'RECONCILE'
  ),
  CONSTRAINT "hospitality_supplier_reservation_attempts_correlation_check" CHECK (
    "providerCorrelationId" IS NULL
    OR (
      "providerCorrelationId" = btrim("providerCorrelationId")
      AND "providerCorrelationId" !~ E'[\\r\\n]'
    )
  )
);

CREATE UNIQUE INDEX "hospitality_supplier_reservation_attempts_org_reservation_sequence_key"
  ON "hospitality_supplier_reservation_attempts"("organizationId", "reservationId", "sequence");

CREATE INDEX "hospitality_supplier_reservation_attempts_org_reservation_started_idx"
  ON "hospitality_supplier_reservation_attempts"("organizationId", "reservationId", "startedAt");

CREATE INDEX "hospitality_supplier_reservation_attempts_org_status_started_idx"
  ON "hospitality_supplier_reservation_attempts"("organizationId", "status", "startedAt");

ALTER TABLE "hospitality_supplier_reservation_attempts"
  ADD CONSTRAINT "hospitality_supplier_reservation_attempts_reservation_fkey"
  FOREIGN KEY ("reservationId", "organizationId")
  REFERENCES "hospitality_supplier_reservation_operations"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
