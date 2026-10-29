import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Invoice number sequence integrity tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('hospitality invoice number sequences reject rewrites and unmatched advancement', async (t) => {
  const { db } = await import('../database.ts');
  const runId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  let fixturesCleaned = false;
  async function cleanupFixtures() {
    if (fixturesCleaned) return;
    await db.hospitalityInvoiceNumberSequence.deleteMany({ where: { organizationId } });
    await db.organization.deleteMany({ where: { id: organizationId } });
    fixturesCleaned = true;
  }
  t.after(async () => {
    try {
      await cleanupFixtures();
    } finally {
      await db.$disconnect();
    }
  });
  const organization = await db.organization.create({
    data: {
      id: organizationId,
      name: 'Invoice Sequence Integrity Tenant',
      slug: `invoice-sequence-${runId}`.slice(0, 63),
      kind: 'HOTEL',
      currency: 'AUD',
    },
  });
  const where = {
    organizationId_jurisdictionCode_documentType: {
      organizationId: organization.id,
      jurisdictionCode: 'AU',
      documentType: 'TAX_INVOICE',
    },
  } as const;

  try {
    await assert.rejects(
      db.hospitalityInvoiceNumberSequence.create({
        data: {
          organizationId: organization.id,
          jurisdictionCode: 'AU',
          documentType: 'ADJUSTMENT_NOTE',
          nextValue: 9n,
        },
      }),
      /does not match issued legal-document history/i,
    );

    await db.hospitalityInvoiceNumberSequence.create({
      data: {
        organizationId: organization.id,
        jurisdictionCode: 'AU',
        documentType: 'TAX_INVOICE',
        nextValue: 1n,
      },
    });

    await assert.rejects(
      db.hospitalityInvoiceNumberSequence.update({
        where,
        data: { nextValue: { increment: 2n } },
      }),
      /must advance exactly one value at a time/i,
    );

    await assert.rejects(
      db.hospitalityInvoiceNumberSequence.update({
        where,
        data: { jurisdictionCode: 'NZ' },
      }),
      /sequence identity is immutable/i,
    );

    await assert.rejects(
      db.hospitalityInvoiceNumberSequence.update({
        where,
        data: { nextValue: { increment: 1n } },
      }),
      /does not match issued legal-document history/i,
    );

    const retained = await db.hospitalityInvoiceNumberSequence.findUnique({ where });
    assert.equal(retained?.nextValue, 1n);
  } finally {
    await cleanupFixtures();
  }
});
