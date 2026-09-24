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

  return db.$transaction(async (transaction) => {
    const total = await transaction.appointmentService.count({ where });
    const pagination = resolveInventoryPagination({ total, page: input.page, pageSize: input.pageSize });
    const services = await transaction.appointmentService.findMany({
      where,
      orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      skip: pagination.skip,
      take: pagination.take,
      include: { _count: { select: { staffAssignments: true } } },
    });
    return { services, total, page: pagination.page, totalPages: pagination.totalPages, pageSize: pagination.pageSize };
  }, { isolationLevel: 'RepeatableRead' });
}

export async function listAppointmentStaffForOrganization(input: {
  organizationId: string;
  page: number;
  pageSize: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  const where = { organizationId: input.organizationId };

  return db.$transaction(async (transaction) => {
    const total = await transaction.appointmentStaff.count({ where });
    const pagination = resolveInventoryPagination({ total, page: input.page, pageSize: input.pageSize });
    const staff = await transaction.appointmentStaff.findMany({
      where,
      orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      skip: pagination.skip,
      take: pagination.take,
      include: { _count: { select: { schedules: true, serviceAssignments: true } } },
    });
    return { staff, total, page: pagination.page, totalPages: pagination.totalPages, pageSize: pagination.pageSize };
  }, { isolationLevel: 'RepeatableRead' });
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

  return db.$transaction(async (transaction) => {
    const total = await transaction.appointmentSchedule.count({ where });
    const pagination = resolveInventoryPagination({ total, page: input.page, pageSize: input.pageSize });
    const schedules = await transaction.appointmentSchedule.findMany({
      where,
      orderBy: [{ status: 'asc' }, { dayOfWeek: 'asc' }, { startsAtMinute: 'asc' }, { id: 'asc' }],
      skip: pagination.skip,
      take: pagination.take,
    });
    return { schedules, total, page: pagination.page, totalPages: pagination.totalPages, pageSize: pagination.pageSize };
  }, { isolationLevel: 'RepeatableRead' });
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

  return db.$transaction(async (transaction) => {
    const total = await transaction.appointmentStaffService.count({ where });
    const pagination = resolveInventoryPagination({ total, page: input.page, pageSize: input.pageSize });
    const assignments = await transaction.appointmentStaffService.findMany({
      where,
      orderBy: [{ service: { name: 'asc' } }, { serviceId: 'asc' }],
      skip: pagination.skip,
      take: pagination.take,
      include: { service: true },
    });
    return { assignments, total, page: pagination.page, totalPages: pagination.totalPages, pageSize: pagination.pageSize };
  }, { isolationLevel: 'RepeatableRead' });
}
