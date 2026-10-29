import assert from 'node:assert/strict';
import test, { after } from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Commercial settlement-evidence database integrity tests must run through npm run test:database with TEST_DATABASE_URL.');
}

after(async () => {
  const { db } = await import('../database.ts');
  await db.$disconnect();
});

test('commercial settlement evidence database guards are installed with the intended timing', async () => {
  const { db } = await import('../database.ts');
  const rows = await db.$queryRaw<Array<{ trigger_name: string; table_name: string; enabled: string; definition: string; handler_name: string; event_type: number }>>`
    SELECT trigger_row.tgname AS trigger_name,
           relation_row.relname AS table_name,
           trigger_row.tgenabled::text AS enabled,
           handler_row.proname AS handler_name,
           trigger_row.tgtype::integer AS event_type,
           pg_get_triggerdef(trigger_row.oid) AS definition
      FROM pg_trigger trigger_row
      JOIN pg_class relation_row ON relation_row.oid = trigger_row.tgrelid
      JOIN pg_namespace namespace_row ON namespace_row.oid = relation_row.relnamespace
      JOIN pg_proc handler_row ON handler_row.oid = trigger_row.tgfoid
      JOIN pg_namespace handler_namespace ON handler_namespace.oid = handler_row.pronamespace
     WHERE namespace_row.nspname = current_schema()
       AND relation_row.relkind = 'r'
       AND handler_namespace.nspname = current_schema()
       AND handler_row.pronargs = 0
       AND handler_row.prorettype = 'pg_catalog.trigger'::regtype
       AND NOT trigger_row.tgisinternal
       AND trigger_row.tgname IN (
         'hospitality_commercial_settlement_evidence_insert_guard',
         'hospitality_commercial_settlement_evidence_tx_insert_guard',
         'hospitality_commercial_settlement_evidence_continuity_guard'
       )
     ORDER BY trigger_row.tgname ASC
  `;

  assert.equal(rows.length, 3);
  const expectedTables = new Map([
    ['hospitality_commercial_settlement_evidence_insert_guard', 'hospitality_commercial_settlement_evidence'],
    ['hospitality_commercial_settlement_evidence_tx_insert_guard', 'hospitality_commercial_settlement_evidence_transactions'],
    ['hospitality_commercial_settlement_evidence_continuity_guard', 'hospitality_commercial_settlement_evidence'],
  ]);
  const expectedHandlers = new Map([
    ['hospitality_commercial_settlement_evidence_insert_guard', 'sf_validate_hospitality_commercial_settlement_evidence_insert'],
    ['hospitality_commercial_settlement_evidence_tx_insert_guard', 'sf_validate_hospitality_commercial_settlement_tx_insert'],
    ['hospitality_commercial_settlement_evidence_continuity_guard', 'sf_check_hospitality_commercial_settlement_evidence_continuity'],
  ]);
  const expectedEvents = new Map([
    ['hospitality_commercial_settlement_evidence_insert_guard', 7], // BEFORE INSERT FOR EACH ROW
    ['hospitality_commercial_settlement_evidence_tx_insert_guard', 7],
    ['hospitality_commercial_settlement_evidence_continuity_guard', 5], // AFTER INSERT FOR EACH ROW
  ]);
  for (const row of rows) {
    assert.equal(row.table_name, expectedTables.get(row.trigger_name), `${row.trigger_name} must guard the intended table`);
    assert.equal(row.enabled, 'O', `${row.trigger_name} must be enabled for ordinary writes`);
    assert.equal(row.handler_name, expectedHandlers.get(row.trigger_name), `${row.trigger_name} must call the intended function`);
    assert.equal(row.event_type, expectedEvents.get(row.trigger_name), `${row.trigger_name} must have the intended row/event timing`);
  }
  const byName = new Map(rows.map((row) => [row.trigger_name, row.definition]));
  assert.match(byName.get('hospitality_commercial_settlement_evidence_insert_guard') ?? '', /BEFORE INSERT/i);
  assert.match(byName.get('hospitality_commercial_settlement_evidence_tx_insert_guard') ?? '', /BEFORE INSERT/i);
  assert.match(byName.get('hospitality_commercial_settlement_evidence_continuity_guard') ?? '', /DEFERRABLE INITIALLY DEFERRED/i);
  assert.match(byName.get('hospitality_commercial_settlement_evidence_insert_guard') ?? '', /sf_validate_hospitality_commercial_settlement_evidence_insert/i);
  assert.match(byName.get('hospitality_commercial_settlement_evidence_tx_insert_guard') ?? '', /sf_validate_hospitality_commercial_settlement_tx_insert/i);
  assert.match(byName.get('hospitality_commercial_settlement_evidence_continuity_guard') ?? '', /sf_check_hospitality_commercial_settlement_evidence_continuity/i);
});

test('database functions retain exact issue-time, source-payment, legal-prefix, and continuity checks', async () => {
  const { db } = await import('../database.ts');
  const functionNames = [
    'sf_validate_hospitality_commercial_settlement_evidence_insert',
    'sf_validate_hospitality_commercial_settlement_tx_insert',
    'sf_check_hospitality_commercial_settlement_evidence_continuity',
  ] as const;

  const rows = await db.$queryRaw<Array<{ function_name: string; definition: string }>>`
    SELECT procedure_row.proname AS function_name,
           pg_get_functiondef(procedure_row.oid) AS definition
      FROM pg_proc procedure_row
      JOIN pg_namespace namespace_row ON namespace_row.oid = procedure_row.pronamespace
     WHERE namespace_row.nspname = current_schema()
       AND procedure_row.pronargs = 0
       AND procedure_row.prorettype = 'pg_catalog.trigger'::regtype
       AND procedure_row.proname IN (
         'sf_validate_hospitality_commercial_settlement_evidence_insert',
         'sf_validate_hospitality_commercial_settlement_tx_insert',
         'sf_check_hospitality_commercial_settlement_evidence_continuity'
       )
  `;

  assert.equal(rows.length, functionNames.length);
  const definitions = new Map(rows.map((row) => [row.function_name, row.definition]));

  const headerGuard = definitions.get(functionNames[0]) ?? '';
  assert.match(headerGuard, /NEW\."issuedAt" IS DISTINCT FROM note_issued_at/i);
  assert.match(headerGuard, /adjustmentReason" = 'COMMERCIAL_AMENDMENT'/i);

  const transactionGuard = definitions.get(functionNames[1]) ?? '';
  assert.match(transactionGuard, /FROM "payment_transactions" payment/i);
  assert.match(transactionGuard, /payment\."status" = NEW\."status"/i);
  assert.match(transactionGuard, /payment\."amountMinor" = NEW\."amountMinor"/i);
  assert.match(transactionGuard, /sourceAdjustmentOrdinal" <= evidence_source_adjustment_ordinal/i);

  const continuityGuard = definitions.get(functionNames[2]) ?? '';
  assert.match(continuityGuard, /previous_evidence_id/i);
  assert.match(continuityGuard, /next_evidence_id/i);
  assert.match(continuityGuard, /cannot drop previously frozen payment identities/i);
});
