import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { resolveInventoryPagination } from './inventory-pagination.ts';

export async function listAppointmentServicesForOrganization(input: {
  organizationId: string;
  page: number;
  pageSize: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  const where = { organizationId: input.organizationId };
  const total = await db.appointmentService.count({ where });
  const pagination = resolveInventoryPagination({ total, page: input.page, pageSize: input.pageSize });
  const services = await db.appointmentService.findMany({
    where,
    orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    skip: pagination.skip,
    take: pagination.take,
    include: { _count: { select: { staffAssignments: true } } },
  });
  return { services, total, page: pagination.page, totalPages: pagination.totalPages, pageSize: pagination.pageSize };
}

export async function listAppointmentStaffForOrganization(input: {
  organizationId: string;
  page: number;
  pageSize: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  const where = { organizationId: input.organizationId };
  const total = await db.appointmentStaff.count({ where });
  const pagination = resolveInventoryPagination({ total, page: input.page, pageSize: input.pageSize });
  const staff = await db.appointmentStaff.findMany({
    where,
    orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    skip: pagination.skip,
    take: pagination.take,
    include: { _count: { select: { schedules: true, serviceAssignments: true } } },
  });
  return { staff, total, page: pagination.page, totalPages: pagination.totalPages, pageSize: pagination.pageSize };
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
  const where = { organizationId: input.organizationId, staffId: input.staffId };
  const total = await db.appointmentSchedule.count({ where });
  const pagination = resolveInventoryPagination({ total, page: input.page, pageSize: input.pageSize });
  const schedules = await db.appointmentSchedule.findMany({
    where,
    orderBy: [{ status: 'asc' }, { dayOfWeek: 'asc' }, { startsAtMinute: 'asc' }, { id: 'asc' }],
    skip: pagination.skip,
    take: pagination.take,
  });
  return { schedules, total, page: pagination.page, totalPages: pagination.totalPages, pageSize: pagination.pageSize };
}

export async function listAppointmentServiceAssignmentsForStaff(input: {
  organizationId: string;
  staffId: string;
  page: number;
  pageSize: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.staffId, 'staffId');
  const where = { organizationId: input.organizationId, staffId: input.staffId };
  const total = await db.appointmentStaffService.count({ where });
  const pagination = resolveInventoryPagination({ total, page: input.page, pageSize: input.pageSize });
  const assignments = await db.appointmentStaffService.findMany({
    where,
    orderBy: [{ service: { name: 'asc' } }, { serviceId: 'asc' }],
    skip: pagination.skip,
    take: pagination.take,
    include: { service: true },
  });
  return { assignments, total, page: pagination.page, totalPages: pagination.totalPages, pageSize: pagination.pageSize };
}
