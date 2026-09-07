-- Preserve every accepted commercial-review decision before it is consumed into a second provider write.
-- The history row is immutable application evidence and binds one review attempt to exactly one subsequent
-- CREATE attempt. Existing REVIEW_REQUIRED rows remain unchanged until their accepted decision is consumed.
CREATE TABLE "hospitality_supplier_reservation_review_acceptance_history" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "reservationId" UUID NOT NULL,
  "reviewAttemptSequence" INTEGER NOT NULL,
  "acceptedAt" TIMESTAMPTZ(6) NOT NULL,
  "acceptedByUserId" UUID NOT NULL,
  "reason" VARCHAR(64) NOT NULL,
  "acceptPriceChange" BOOLEAN NOT NULL,
  "acceptGuaranteeChange" BOOLEAN NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "acceptedTotalMinor" BIGINT NOT NULL,
  "acceptedOfferFingerprint" CHAR(64) NOT NULL,
  "acceptedTermsFingerprint" CHAR(64) NOT NULL,
  "acceptedAuthorityFingerprint" CHAR(64) NOT NULL,
  "acceptanceFingerprint" CHAR(64) NOT NULL,
  "consumedAt" TIMESTAMPTZ(6) NOT NULL,
  "consumedAttemptSequence" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "supplier_review_acceptance_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_review_acceptance_history_attempt_fkey"
    FOREIGN KEY ("organizationId", "reservationId", "consumedAttemptSequence")
    REFERENCES "hospitality_supplier_reservation_attempts"("organizationId", "reservationId", "sequence")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "hospitality_supplier_reservation_review_acceptance_history_contract_check"
    CHECK (
      "reviewAttemptSequence" >= 1
      AND "consumedAttemptSequence" = "reviewAttemptSequence" + 1
      AND "acceptedAt" <= "consumedAt"
      AND "acceptedTotalMinor" >= 0
      AND "currency" ~ '^[A-Z]{3}$'
      AND "acceptedOfferFingerprint" ~ '^[0-9a-f]{64}$'
      AND "acceptedTermsFingerprint" ~ '^[0-9a-f]{64}$'
      AND "acceptedAuthorityFingerprint" ~ '^[0-9a-f]{64}$'
      AND "acceptanceFingerprint" ~ '^[0-9a-f]{64}$'
      AND (
        (
          "reason" = 'SUPPLIER_PRICE_CHANGED'
          AND "acceptPriceChange" = TRUE
          AND "acceptGuaranteeChange" = FALSE
        )
        OR (
          "reason" = 'SUPPLIER_GUARANTEE_CHANGED'
          AND "acceptPriceChange" = FALSE
          AND "acceptGuaranteeChange" = TRUE
        )
        OR (
          "reason" = 'SUPPLIER_PRICE_AND_GUARANTEE_CHANGED'
          AND "acceptPriceChange" = TRUE
          AND "acceptGuaranteeChange" = TRUE
        )
      )
    )
);

CREATE UNIQUE INDEX "supplier_review_acceptance_history_review_key"
ON "hospitality_supplier_reservation_review_acceptance_history"
("organizationId", "reservationId", "reviewAttemptSequence");

CREATE UNIQUE INDEX "supplier_review_acceptance_history_consumed_attempt_key"
ON "hospitality_supplier_reservation_review_acceptance_history"
("organizationId", "reservationId", "consumedAttemptSequence");

CREATE UNIQUE INDEX "supplier_review_acceptance_history_fingerprint_key"
ON "hospitality_supplier_reservation_review_acceptance_history"
("organizationId", "reservationId", "acceptanceFingerprint");

CREATE INDEX "supplier_review_acceptance_history_created_idx"
ON "hospitality_supplier_reservation_review_acceptance_history"
("organizationId", "reservationId", "createdAt");
