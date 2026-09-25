import type { Prisma } from '../../generated/prisma/client.ts';

export class HospitalityLegalDocumentClockUnavailableError extends Error {
  constructor() {
    super('Database clock is unavailable for legal-document issuance.');
    this.name = 'HospitalityLegalDocumentClockUnavailableError';
  }
}

export async function readHospitalityLegalDocumentIssueTime(
  transaction: Pick<Prisma.TransactionClient, '$queryRaw'>,
) {
  const [databaseClock] = await transaction.$queryRaw<Array<{ issuedAt: Date }>>`
    SELECT date_trunc('milliseconds', clock_timestamp()) AS "issuedAt"
  `;
  const issuedAt = databaseClock?.issuedAt;
  if (!(issuedAt instanceof Date) || !Number.isFinite(issuedAt.getTime())) {
    throw new HospitalityLegalDocumentClockUnavailableError();
  }
  return issuedAt;
}
