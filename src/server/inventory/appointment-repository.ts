import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';

function boundedPage(page: number) {
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function boundedPageSize(pageSize: number) {
  return Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= 50 ? pageSize : 20;
}

export async function listAppointmentServicesForOrganization(input: {
  organizationId: string;
  page: number;
  pageSize: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  const pageSize = boundedPageSize(input.pageSize);
  const requestedPage = boundedPage(input.page);
  const where = { organizationId: input.organizationId };
  const total = await db.appointmentService.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const services = await db.appointmentService.findMany({
    where,
    orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: { _count: { select: { staffAssignments: true } } },
  });
  return { services, total, page, totalPages, pageSize };
}

export async function listAppointmentStaffForOrganization(input: {
  organizationId: string;
  page: number;
  pageSize: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  const pageSize = boundedPageSize(input.pageSize);
  const requestedPage = boundedPage(input.page);
  const where = { organizationId: input.organizationId };
  const total = await db.appointmentStaff.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const staff = await db.appointmentStaff.findMany({
    where,
    orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: { _count: { select: { schedules: true, serviceAssignments: true } } },
  });
  return { staff, total, page, totalPages, pageSize };
}

export async function readAppointmentStaffForOrganization(input: {
  organizationId: string;
  staffId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.staffId, 'staffId');
  return db.appointmentStaff.findFirst({
    where: { id: input.staffId, organizationId: input.organizationId },
  });
}

export async function listAppointmentSchedulesForStaff(input: {
  organizationId: string;
  staffId: string;
  page: number;
  pageSize: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.staffId, 'staffId');
  const pageSize = boundedPageSize(input.pageSize);
  const requestedPage = boundedPage(input.page);
  const where = { organizationId: input.organizationId, staffId: input.staffId };
  const total = await db.appointmentSchedule.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const schedules = await db.appointmentSchedule.findMany({
    where,
    orderBy: [{ status: 'asc' }, { dayOfWeek: 'asc' }, { startsAtMinute: 'asc' }, { id: 'asc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return { schedules, total, page, totalPages, pageSize };
}

export async function listAppointmentServiceAssignmentsForStaff(input: {
  organizationId: string;
  staffId: string;
  page: number;
  pageSize: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.staffId, 'staffId');
  const pageSize = boundedPageSize(input.pageSize);
  const requestedPage = boundedPage(input.page);
  const where = { organizationId: input.organizationId, staffId: input.staffId };
  const total = await db.appointmentStaffService.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const assignments = await db.appointmentStaffService.findMany({
    where,
    orderBy: [{ service: { name: 'asc' } }, { serviceId: 'asc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: { service: true },
  });
  return { assignments, total, page, totalPages, pageSize };
}
