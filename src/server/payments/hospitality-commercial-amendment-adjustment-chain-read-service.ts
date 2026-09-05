import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  loadVerifiedHospitalityCommercialAmendmentAdjustmentChain,
} from './hospitality-commercial-amendment-adjustment-chain-service.ts';

export type HospitalityCommercialAdjustmentRowReference = Readonly<{
  id: string;
  bookingId: string;
  sourceInvoiceId: string;
}>;

export async function verifyHospitalityCommercialAmendmentAdjustmentRows(input: {
  organizationId: string;
  rows: readonly HospitalityCommercialAdjustmentRowReference[];
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  if (input.rows.length === 0) return;

  const groups = new Map<string, HospitalityCommercialAdjustmentRowReference[]>();
  for (const row of input.rows) {
    assertUuidIdentifier(row.id, 'adjustmentNoteId');
    assertUuidIdentifier(row.bookingId, 'bookingId');
    assertUuidIdentifier(row.sourceInvoiceId, 'sourceInvoiceId');
    const key = `${row.bookingId}:${row.sourceInvoiceId}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  for (const rows of groups.values()) {
    const first = rows[0]!;
    const verified = await db.$transaction((transaction) =>
      loadVerifiedHospitalityCommercialAmendmentAdjustmentChain({
        transaction,
        organizationId: input.organizationId,
        bookingId: first.bookingId,
        sourceInvoiceId: first.sourceInvoiceId,
        allowTerminalCancellation: true,
      }));
    const verifiedIds = new Set(verified.priorAdjustments.map((entry) => entry.adjustmentNoteId));
    for (const row of rows) {
      if (!verifiedIds.has(row.id)) {
        throw new Error('Commercial adjustment note is not present in its verified source chain.');
      }
    }
  }
}
