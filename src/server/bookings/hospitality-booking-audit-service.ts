import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { HospitalityBookingUnavailableError } from './hospitality-booking-service.ts';

function normalizePage(value: number | undefined) {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value as number : 1;
}

export async function listHospitalityBookingAuditEvents(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  page?: number;
  pageSize?: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:read' });
  const booking = await db.hospitalityBooking.findFirst({ where: { id: input.bookingId, organizationId: input.organizationId }, select: { id: true } });
  if (!booking) throw new HospitalityBookingUnavailableError();

  const pageSize = Math.min(50, Math.max(1, Number.isInteger(input.pageSize) ? input.pageSize as number : 20));
  const requestedPage = normalizePage(input.page);
  const where = { organizationId: input.organizationId, resourceType: 'hospitality-booking', resourceId: booking.id };
  const total = await db.auditEvent.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const events = await db.auditEvent.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: { id: true, action: true, beforeData: true, afterData: true, createdAt: true, actorUserId: true },
  });
  return { events, total, page, totalPages };
}
