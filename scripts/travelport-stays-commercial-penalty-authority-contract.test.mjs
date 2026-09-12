import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const commercial = readFileSync(
  new URL('../src/server/suppliers/travelport-stays-commercial-authority.ts', import.meta.url),
  'utf8',
);

test('commercial money authority requires plain decimal syntax before compatibility parsing', () => {
  assert.ok(commercial.includes("const MONEY_TEXT_PATTERN = /^\\d+(?:\\.\\d+)?$/;"));
  assert.match(commercial, /function exactDecimalText/);
  assert.match(commercial, /MONEY_TEXT_PATTERN/);
  assert.match(commercial, /exactMoneyIfPresent\(component\.amount\)/);
  assert.match(commercial, /exactMoneyIfPresent\(price\.TotalPrice\)/);
  assert.match(commercial, /exactMoneyIfPresent\(amount\.value\)/);
});

test('Rules penalty authority pins documented penalty variants and field semantics', () => {
  assert.match(commercial, /RULE_PENALTY_TYPES = new Set\(\[/);
  assert.match(commercial, /'HotelPenaltyAmount'/);
  assert.match(commercial, /'HotelPenaltyPercent'/);
  assert.match(commercial, /'HotelPenaltyNights'/);
  assert.match(commercial, /penaltyType === 'HotelPenaltyAmount'/);
  assert.match(commercial, /penaltyType === 'HotelPenaltyPercent'/);
  assert.match(commercial, /penalty\.appliesTo !== 'Amount'/);
  assert.match(commercial, /requiredDecimal\(penalty\.Nights, 'nights-penalty'\)/);
  assert.match(commercial, /enumStringIfPresent\(penalty\.subjectToTax, RULE_SUBJECT_TO_TAX/);
});

test('Rules penalty authority rejects contradictory type-specific fields', () => {
  assert.match(commercial, /penaltyFieldAbsent\(penalty, 'Percent', 'amount-penalty'\)/);
  assert.match(commercial, /penaltyFieldAbsent\(penalty, 'Nights', 'amount-penalty'\)/);
  assert.match(commercial, /penaltyFieldAbsent\(penalty, 'Amount', 'percent-penalty'\)/);
  assert.match(commercial, /penaltyFieldAbsent\(penalty, 'Amount', 'nights-penalty'\)/);
  assert.match(commercial, /incomplete amount-penalty authority evidence/);
});
