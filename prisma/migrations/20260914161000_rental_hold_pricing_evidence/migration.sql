ALTER TABLE "rental_availability_holds"
ADD COLUMN "quotedCurrency" CHAR(3),
ADD COLUMN "quotedTotalMinor" BIGINT,
ADD COLUMN "pricingFingerprint" CHAR(64),
ADD COLUMN "pricingSnapshot" JSONB,
ADD COLUMN "pricingObservedAt" TIMESTAMPTZ(6);

ALTER TABLE "rental_availability_holds"
ADD CONSTRAINT "rental_availability_holds_pricing_evidence_complete_check"
CHECK (
    (
        "quotedCurrency" IS NULL
        AND "quotedTotalMinor" IS NULL
        AND "pricingFingerprint" IS NULL
        AND "pricingSnapshot" IS NULL
        AND "pricingObservedAt" IS NULL
    )
    OR
    (
        "quotedCurrency" IS NOT NULL
        AND "quotedTotalMinor" IS NOT NULL
        AND "pricingFingerprint" IS NOT NULL
        AND "pricingSnapshot" IS NOT NULL
        AND "pricingObservedAt" IS NOT NULL
    )
);

ALTER TABLE "rental_availability_holds"
ADD CONSTRAINT "rental_availability_holds_quoted_currency_check"
CHECK ("quotedCurrency" IS NULL OR "quotedCurrency" ~ '^[A-Z]{3}$');

ALTER TABLE "rental_availability_holds"
ADD CONSTRAINT "rental_availability_holds_quoted_total_check"
CHECK ("quotedTotalMinor" IS NULL OR "quotedTotalMinor" > 0);

ALTER TABLE "rental_availability_holds"
ADD CONSTRAINT "rental_availability_holds_pricing_fingerprint_check"
CHECK ("pricingFingerprint" IS NULL OR "pricingFingerprint" ~ '^[0-9a-f]{64}$');

ALTER TABLE "rental_availability_holds"
ADD CONSTRAINT "rental_availability_holds_pricing_snapshot_check"
CHECK ("pricingSnapshot" IS NULL OR jsonb_typeof("pricingSnapshot") = 'object');

CREATE FUNCTION sf_guard_rental_hold_pricing_evidence_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."quotedCurrency" IS DISTINCT FROM OLD."quotedCurrency"
       OR NEW."quotedTotalMinor" IS DISTINCT FROM OLD."quotedTotalMinor"
       OR NEW."pricingFingerprint" IS DISTINCT FROM OLD."pricingFingerprint"
       OR NEW."pricingSnapshot" IS DISTINCT FROM OLD."pricingSnapshot"
       OR NEW."pricingObservedAt" IS DISTINCT FROM OLD."pricingObservedAt" THEN
        RAISE EXCEPTION 'rental hold pricing evidence is immutable'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_availability_holds_pricing_evidence_immutable_guard
BEFORE UPDATE OF "quotedCurrency", "quotedTotalMinor", "pricingFingerprint", "pricingSnapshot", "pricingObservedAt"
ON "rental_availability_holds"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_hold_pricing_evidence_immutable();
