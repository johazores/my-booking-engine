CREATE TABLE "rental_manual_provider_references" (
    "organizationId" UUID NOT NULL,
    "providerReference" VARCHAR(160) NOT NULL,
    "sourceLedger" VARCHAR(96) NOT NULL,
    "sourceId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_manual_provider_references_pkey"
      PRIMARY KEY ("organizationId", "providerReference"),
    CONSTRAINT "rental_manual_provider_references_source_check"
      CHECK (
        "sourceLedger" IN (
          'rental_payment_transactions',
          'rental_damage_settlement_transactions',
          'rental_security_bond_transactions',
          'rental_late_return_settlement_transactions',
          'rental_booking_commercial_amendment_settlement_transactions',
          'rental_booking_effective_refund_transactions'
        )
      ),
    CONSTRAINT "rental_manual_provider_references_reference_check"
      CHECK (btrim("providerReference") <> '')
);

CREATE UNIQUE INDEX "rental_manual_provider_references_source_key"
  ON "rental_manual_provider_references"("organizationId", "sourceLedger", "sourceId");
CREATE INDEX "rental_manual_provider_references_org_created_idx"
  ON "rental_manual_provider_references"("organizationId", "createdAt");

-- Fail the migration instead of silently choosing a winner if legacy data somehow
-- contains a cross-ledger duplicate. Existing guards should make this impossible,
-- but the registry backfill is intentionally defensive.
DO $$
BEGIN
    IF EXISTS (
        SELECT refs."organizationId", refs."providerReference"
          FROM (
            SELECT "organizationId", "providerReference"
              FROM "rental_payment_transactions"
             WHERE "providerCode" = 'manual'
            UNION ALL
            SELECT "organizationId", "providerReference"
              FROM "rental_damage_settlement_transactions"
             WHERE "providerCode" = 'manual'
            UNION ALL
            SELECT "organizationId", "providerReference"
              FROM "rental_security_bond_transactions"
             WHERE "providerCode" = 'manual'
            UNION ALL
            SELECT "organizationId", "providerReference"
              FROM "rental_late_return_settlement_transactions"
             WHERE "providerCode" = 'manual'
            UNION ALL
            SELECT "organizationId", "providerReference"
              FROM "rental_booking_commercial_amendment_settlement_transactions"
             WHERE "providerCode" = 'manual'
            UNION ALL
            SELECT "organizationId", "providerReference"
              FROM "rental_booking_effective_refund_transactions"
             WHERE "providerCode" = 'manual'
          ) refs
         GROUP BY refs."organizationId", refs."providerReference"
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'cannot build rental manual provider reference registry because duplicate tenant references already exist'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

INSERT INTO "rental_manual_provider_references" (
    "organizationId", "providerReference", "sourceLedger", "sourceId", "createdAt"
)
SELECT "organizationId", "providerReference", 'rental_payment_transactions', "id", "createdAt"
  FROM "rental_payment_transactions"
 WHERE "providerCode" = 'manual'
UNION ALL
SELECT "organizationId", "providerReference", 'rental_damage_settlement_transactions', "id", "createdAt"
  FROM "rental_damage_settlement_transactions"
 WHERE "providerCode" = 'manual'
UNION ALL
SELECT "organizationId", "providerReference", 'rental_security_bond_transactions', "id", "createdAt"
  FROM "rental_security_bond_transactions"
 WHERE "providerCode" = 'manual'
UNION ALL
SELECT "organizationId", "providerReference", 'rental_late_return_settlement_transactions', "id", "createdAt"
  FROM "rental_late_return_settlement_transactions"
 WHERE "providerCode" = 'manual'
UNION ALL
SELECT "organizationId", "providerReference", 'rental_booking_commercial_amendment_settlement_transactions', "id", "createdAt"
  FROM "rental_booking_commercial_amendment_settlement_transactions"
 WHERE "providerCode" = 'manual'
UNION ALL
SELECT "organizationId", "providerReference", 'rental_booking_effective_refund_transactions', "id", "createdAt"
  FROM "rental_booking_effective_refund_transactions"
 WHERE "providerCode" = 'manual';

CREATE FUNCTION sf_author_rental_manual_provider_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    source_exists BOOLEAN := FALSE;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'rental manual provider reference registry is append-only'
            USING ERRCODE = '23514';
    END IF;

    CASE NEW."sourceLedger"
      WHEN 'rental_payment_transactions' THEN
        SELECT EXISTS (
          SELECT 1 FROM "rental_payment_transactions" row
           WHERE row."id" = NEW."sourceId"
             AND row."organizationId" = NEW."organizationId"
             AND row."providerCode" = 'manual'
             AND row."providerReference" = NEW."providerReference"
        ) INTO source_exists;
      WHEN 'rental_damage_settlement_transactions' THEN
        SELECT EXISTS (
          SELECT 1 FROM "rental_damage_settlement_transactions" row
           WHERE row."id" = NEW."sourceId"
             AND row."organizationId" = NEW."organizationId"
             AND row."providerCode" = 'manual'
             AND row."providerReference" = NEW."providerReference"
        ) INTO source_exists;
      WHEN 'rental_security_bond_transactions' THEN
        SELECT EXISTS (
          SELECT 1 FROM "rental_security_bond_transactions" row
           WHERE row."id" = NEW."sourceId"
             AND row."organizationId" = NEW."organizationId"
             AND row."providerCode" = 'manual'
             AND row."providerReference" = NEW."providerReference"
        ) INTO source_exists;
      WHEN 'rental_late_return_settlement_transactions' THEN
        SELECT EXISTS (
          SELECT 1 FROM "rental_late_return_settlement_transactions" row
           WHERE row."id" = NEW."sourceId"
             AND row."organizationId" = NEW."organizationId"
             AND row."providerCode" = 'manual'
             AND row."providerReference" = NEW."providerReference"
        ) INTO source_exists;
      WHEN 'rental_booking_commercial_amendment_settlement_transactions' THEN
        SELECT EXISTS (
          SELECT 1 FROM "rental_booking_commercial_amendment_settlement_transactions" row
           WHERE row."id" = NEW."sourceId"
             AND row."organizationId" = NEW."organizationId"
             AND row."providerCode" = 'manual'
             AND row."providerReference" = NEW."providerReference"
        ) INTO source_exists;
      WHEN 'rental_booking_effective_refund_transactions' THEN
        SELECT EXISTS (
          SELECT 1 FROM "rental_booking_effective_refund_transactions" row
           WHERE row."id" = NEW."sourceId"
             AND row."organizationId" = NEW."organizationId"
             AND row."providerCode" = 'manual'
             AND row."providerReference" = NEW."providerReference"
        ) INTO source_exists;
      ELSE
        RAISE EXCEPTION 'rental manual provider reference registry source ledger is unsupported'
            USING ERRCODE = '23514';
    END CASE;

    IF NOT source_exists THEN
        RAISE EXCEPTION 'rental manual provider reference registry row is not backed by matching tenant settlement evidence'
            USING ERRCODE = '23514';
    END IF;

    NEW."createdAt" := clock_timestamp();
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_manual_provider_references_authority_guard
BEFORE INSERT OR UPDATE OR DELETE ON "rental_manual_provider_references"
FOR EACH ROW
EXECUTE FUNCTION sf_author_rental_manual_provider_reference();

-- Rewire all six BEFORE INSERT guards to the registry-backed function. The
-- advisory lock remains the concurrency boundary; the registry is now the one
-- authoritative lookup instead of six independently maintained cross-table scans.
CREATE OR REPLACE FUNCTION sf_guard_rental_manual_reference_cross_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    retained_source_ledger VARCHAR(96);
    retained_source_id UUID;
BEGIN
    IF NEW."providerCode" <> 'manual' THEN
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME NOT IN (
        'rental_payment_transactions',
        'rental_damage_settlement_transactions',
        'rental_security_bond_transactions',
        'rental_late_return_settlement_transactions',
        'rental_booking_commercial_amendment_settlement_transactions',
        'rental_booking_effective_refund_transactions'
    ) THEN
        RAISE EXCEPTION 'manual rental provider reference guard is attached to an unexpected table'
            USING ERRCODE = '23514';
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-manual-reference:' || NEW."organizationId"::text || ':' || NEW."providerReference",
            0
        )
    );

    SELECT registry."sourceLedger", registry."sourceId"
      INTO retained_source_ledger, retained_source_id
      FROM "rental_manual_provider_references" registry
     WHERE registry."organizationId" = NEW."organizationId"
       AND registry."providerReference" = NEW."providerReference";

    IF retained_source_id IS NOT NULL
       AND (retained_source_ledger <> TG_TABLE_NAME OR retained_source_id <> NEW."id")
    THEN
        RAISE EXCEPTION 'manual rental provider reference is already retained as commercial evidence in this tenant'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rental_payment_transactions_cross_scope_reference_guard ON "rental_payment_transactions";
CREATE TRIGGER rental_payment_transactions_cross_scope_reference_guard
BEFORE INSERT ON "rental_payment_transactions"
FOR EACH ROW EXECUTE FUNCTION sf_guard_rental_manual_reference_cross_scope();

DROP TRIGGER IF EXISTS rental_damage_settlement_transactions_cross_scope_reference_guard ON "rental_damage_settlement_transactions";
CREATE TRIGGER rental_damage_settlement_transactions_cross_scope_reference_guard
BEFORE INSERT ON "rental_damage_settlement_transactions"
FOR EACH ROW EXECUTE FUNCTION sf_guard_rental_manual_reference_cross_scope();

DROP TRIGGER IF EXISTS rental_security_bond_transactions_cross_scope_reference_guard ON "rental_security_bond_transactions";
CREATE TRIGGER rental_security_bond_transactions_cross_scope_reference_guard
BEFORE INSERT ON "rental_security_bond_transactions"
FOR EACH ROW EXECUTE FUNCTION sf_guard_rental_manual_reference_cross_scope();

DROP TRIGGER IF EXISTS rental_late_return_settlement_transactions_cross_scope_reference_guard ON "rental_late_return_settlement_transactions";
CREATE TRIGGER rental_late_return_settlement_transactions_cross_scope_reference_guard
BEFORE INSERT ON "rental_late_return_settlement_transactions"
FOR EACH ROW EXECUTE FUNCTION sf_guard_rental_manual_reference_cross_scope();

DROP TRIGGER IF EXISTS rental_booking_commercial_amendment_settlement_transactions_cross_scope_reference_guard ON "rental_booking_commercial_amendment_settlement_transactions";
CREATE TRIGGER rental_booking_commercial_amendment_settlement_transactions_cross_scope_reference_guard
BEFORE INSERT ON "rental_booking_commercial_amendment_settlement_transactions"
FOR EACH ROW EXECUTE FUNCTION sf_guard_rental_manual_reference_cross_scope();

DROP TRIGGER IF EXISTS rental_booking_effective_refund_transactions_cross_scope_reference_guard ON "rental_booking_effective_refund_transactions";
CREATE TRIGGER rental_booking_effective_refund_transactions_cross_scope_reference_guard
BEFORE INSERT ON "rental_booking_effective_refund_transactions"
FOR EACH ROW EXECUTE FUNCTION sf_guard_rental_manual_reference_cross_scope();

CREATE FUNCTION sf_register_rental_manual_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."providerCode" <> 'manual' THEN
        RETURN NEW;
    END IF;

    -- The matching BEFORE trigger already owns this transaction-scoped lock.
    -- Taking it again is harmless and protects this function if trigger wiring
    -- is changed independently in a future migration.
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-manual-reference:' || NEW."organizationId"::text || ':' || NEW."providerReference",
            0
        )
    );

    INSERT INTO "rental_manual_provider_references" (
        "organizationId", "providerReference", "sourceLedger", "sourceId"
    ) VALUES (
        NEW."organizationId", NEW."providerReference", TG_TABLE_NAME, NEW."id"
    );

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_payment_transactions_register_manual_reference
AFTER INSERT ON "rental_payment_transactions"
FOR EACH ROW EXECUTE FUNCTION sf_register_rental_manual_reference();

CREATE TRIGGER rental_damage_settlement_transactions_register_manual_reference
AFTER INSERT ON "rental_damage_settlement_transactions"
FOR EACH ROW EXECUTE FUNCTION sf_register_rental_manual_reference();

CREATE TRIGGER rental_security_bond_transactions_register_manual_reference
AFTER INSERT ON "rental_security_bond_transactions"
FOR EACH ROW EXECUTE FUNCTION sf_register_rental_manual_reference();

CREATE TRIGGER rental_late_return_settlement_transactions_register_manual_reference
AFTER INSERT ON "rental_late_return_settlement_transactions"
FOR EACH ROW EXECUTE FUNCTION sf_register_rental_manual_reference();

CREATE TRIGGER rental_booking_commercial_amendment_settlement_transactions_register_manual_reference
AFTER INSERT ON "rental_booking_commercial_amendment_settlement_transactions"
FOR EACH ROW EXECUTE FUNCTION sf_register_rental_manual_reference();

CREATE TRIGGER rental_booking_effective_refund_transactions_register_manual_reference
AFTER INSERT ON "rental_booking_effective_refund_transactions"
FOR EACH ROW EXECUTE FUNCTION sf_register_rental_manual_reference();
