-- Persist an explicit authorized commercial-review decision without making REVIEW_REQUIRED
-- an ordinary retry state or enabling a second provider write. Existing review rows remain valid
-- with all acceptance fields NULL until an authorized fresh-authority review is completed.
ALTER TABLE "hospitality_supplier_reservation_operations"
ADD COLUMN "reviewAcceptedAt" TIMESTAMPTZ(6),
ADD COLUMN "reviewAcceptedByUserId" UUID,
ADD COLUMN "reviewAcceptedAttemptSequence" INTEGER,
ADD COLUMN "reviewAcceptedPriceChange" BOOLEAN,
ADD COLUMN "reviewAcceptedGuaranteeChange" BOOLEAN,
ADD COLUMN "reviewAcceptedCurrency" CHAR(3),
ADD COLUMN "reviewAcceptedTotalMinor" BIGINT,
ADD COLUMN "reviewAcceptedOfferFingerprint" CHAR(64),
ADD COLUMN "reviewAcceptedTermsFingerprint" CHAR(64),
ADD COLUMN "reviewAcceptedAuthorityFingerprint" CHAR(64),
ADD COLUMN "reviewAcceptanceFingerprint" CHAR(64);

ALTER TABLE "hospitality_supplier_reservation_operations"
ADD CONSTRAINT "hospitality_supplier_reservation_operations_review_acceptance_contract_check"
CHECK (
  (
    "reviewAcceptedAt" IS NULL
    AND "reviewAcceptedByUserId" IS NULL
    AND "reviewAcceptedAttemptSequence" IS NULL
    AND "reviewAcceptedPriceChange" IS NULL
    AND "reviewAcceptedGuaranteeChange" IS NULL
    AND "reviewAcceptedCurrency" IS NULL
    AND "reviewAcceptedTotalMinor" IS NULL
    AND "reviewAcceptedOfferFingerprint" IS NULL
    AND "reviewAcceptedTermsFingerprint" IS NULL
    AND "reviewAcceptedAuthorityFingerprint" IS NULL
    AND "reviewAcceptanceFingerprint" IS NULL
  )
  OR (
    "status" = 'REVIEW_REQUIRED'
    AND "reviewAcceptedAt" IS NOT NULL
    AND "reviewAcceptedByUserId" IS NOT NULL
    AND "reviewAcceptedAttemptSequence" = "attemptCount"
    AND "reviewAcceptedPriceChange" IS NOT NULL
    AND "reviewAcceptedGuaranteeChange" IS NOT NULL
    AND "reviewAcceptedCurrency" = "currency"
    AND "reviewAcceptedTotalMinor" IS NOT NULL
    AND "reviewAcceptedTotalMinor" >= 0
    AND "reviewAcceptedOfferFingerprint" IS NOT NULL
    AND "reviewAcceptedTermsFingerprint" IS NOT NULL
    AND "reviewAcceptedAuthorityFingerprint" IS NOT NULL
    AND "reviewAcceptanceFingerprint" IS NOT NULL
    AND (
      (
        "lastFailureCode" = 'SUPPLIER_PRICE_CHANGED'
        AND "reviewAcceptedPriceChange" = TRUE
        AND "reviewAcceptedGuaranteeChange" = FALSE
      )
      OR (
        "lastFailureCode" = 'SUPPLIER_GUARANTEE_CHANGED'
        AND "reviewAcceptedPriceChange" = FALSE
        AND "reviewAcceptedGuaranteeChange" = TRUE
      )
      OR (
        "lastFailureCode" = 'SUPPLIER_PRICE_AND_GUARANTEE_CHANGED'
        AND "reviewAcceptedPriceChange" = TRUE
        AND "reviewAcceptedGuaranteeChange" = TRUE
      )
    )
  )
);
