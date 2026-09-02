import type { Prisma } from '@prisma/client';

type CommercialAmendmentReader = Pick<Prisma.TransactionClient, 'hospitalityBookingCommercialAmendment'>;

export const ACTIVE_COMMERCIAL_AMENDMENT_CONFLICT_MESSAGE =
  'Booking has a prepared commercial amendment. Cancel or finish that amendment before making another booking or payment change.';

export async function findActiveHospitalityBookingCommercialAmendment(input: {
  reader: CommercialAmendmentReader;
  organizationId: string;
  bookingId: string;
  now: Date;
}) {
  return input.reader.hospitalityBookingCommercialAmendment.findFirst({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      status: 'PREPARED',
      expiresAt: { gt: input.now },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, direction: true, expiresAt: true },
  });
}
