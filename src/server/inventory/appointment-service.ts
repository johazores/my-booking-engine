import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  assertAppointmentArchiveConfirmation,
  assertAppointmentRemoveConfirmation,
  normalizeAppointmentScheduleInput,
  normalizeAppointmentServiceCode,
  normalizeAppointmentServiceInput,
  normalizeAppointmentStaffInput,
  type AppointmentScheduleInput,
  type AppointmentServiceInput,
  type AppointmentStaffInput,
} from './appointment-domain.ts';
import {
  listAppointmentSchedulesForStaff,
  listAppointmentServiceAssignmentsForStaff,
  listAppointmentServicesForOrganization,
  listAppointmentStaffForOrganization,
  readAppointmentStaffForOrganization,
} from './appointment-repository.ts';

export class AppointmentInventoryConflictError extends Error {
  constructor(message = 'An appointment inventory record already exists in this scope.') {
    super(message);
    this.name = 'AppointmentInventoryConflictError';
  }
}

export class AppointmentInventoryUnavailableError extends Error {
  constructor(message = 'Appointment inventory is not available in this organization.') {
    super(message);
    this.name = 'AppointmentInventoryUnavailableError';
  }
}

export class AppointmentInventoryDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppointmentInventoryDependencyError';
  }
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

async function requireInventoryRead(input: { organizationId: string; actorUserId: string }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'inventory:read',
  });
}

async function requireInventoryManage(input: { organizationId: string; actorUserId: string }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'inventory:manage',
  });
}

export async function listAppointmentInventory(input: {
  organizationId: string;
  actorUserId: string;
  servicePage: number;
  staffPage: number;
  pageSize: number;
}) {
  await requireInventoryRead(input);
  const [serviceResult, staffResult] = await Promise.all([
    listAppointmentServicesForOrganization({
      organizationId: input.organizationId,
      page: input.servicePage,
      pageSize: input.pageSize,
    }),
    listAppointmentStaffForOrganization({
      organizationId: input.organizationId,
      page: input.staffPage,
      pageSize: input.pageSize,
    }),
  ]);
  return { serviceResult, staffResult };
}

export async function readAppointmentStaffInventory(input: {
  organizationId: string;
  actorUserId: string;
  staffId: string;
  schedulePage: number;
  servicePage: number;
  pageSize: number;
}) {
  await requireInventoryRead(input);
  const staff = await readAppointmentStaffForOrganization(input);
  if (!staff) throw new AppointmentInventoryUnavailableError('Staff member is not available in this organization.');
  const [scheduleResult, serviceResult] = await Promise.all([
    listAppointmentSchedulesForStaff({
      organizationId: input.organizationId,
      staffId: input.staffId,
      page: input.schedulePage,
      pageSize: input.pageSize,
    }),
    listAppointmentServiceAssignmentsForStaff({
      organizationId: input.organizationId,
      staffId: input.staffId,
      page: input.servicePage,
      pageSize: input.pageSize,
    }),
  ]);
  return { staff, scheduleResult, serviceResult };
}

export async function createAppointmentService(input: {
  organizationId: string;
  actorUserId: string;
  service: AppointmentServiceInput;
}) {
  await requireInventoryManage(input);
  const service = normalizeAppointmentServiceInput(input.service);
  try {
    return await db.$transaction(async (transaction) => {
      const created = await transaction.appointmentService.create({
        data: { organizationId: input.organizationId, ...service },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'inventory.appointment-service.created',
          resourceType: 'appointment-service',
          resourceId: created.id,
          afterData: {
            code: created.code,
            durationMinutes: created.durationMinutes,
            bufferBeforeMinutes: created.bufferBeforeMinutes,
            bufferAfterMinutes: created.bufferAfterMinutes,
            status: created.status,
          },
        },
      });
      return created;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppointmentInventoryConflictError('An appointment service with that code already exists in this organization.');
    }
    throw error;
  }
}

export async function createAppointmentStaff(input: {
  organizationId: string;
  actorUserId: string;
  staff: AppointmentStaffInput;
}) {
  await requireInventoryManage(input);
  const staff = normalizeAppointmentStaffInput(input.staff);
  try {
    return await db.$transaction(async (transaction) => {
      const created = await transaction.appointmentStaff.create({
        data: { organizationId: input.organizationId, ...staff },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'inventory.appointment-staff.created',
          resourceType: 'appointment-staff',
          resourceId: created.id,
          afterData: { code: created.code, timezone: created.timezone, status: created.status },
        },
      });
      return created;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppointmentInventoryConflictError('An appointment staff member with that code already exists in this organization.');
    }
    throw error;
  }
}

export async function assignAppointmentServiceToStaff(input: {
  organizationId: string;
  actorUserId: string;
  staffId: string;
  serviceCode: string;
}) {
  await requireInventoryManage(input);
  assertUuidIdentifier(input.staffId, 'staffId');
  const serviceCode = normalizeAppointmentServiceCode(input.serviceCode);
  return db.$transaction(async (transaction) => {
    const [staff, service] = await Promise.all([
      transaction.appointmentStaff.findFirst({
        where: { id: input.staffId, organizationId: input.organizationId, status: 'ACTIVE' },
        select: { id: true },
      }),
      transaction.appointmentService.findFirst({
        where: { organizationId: input.organizationId, code: serviceCode, status: 'ACTIVE' },
        select: { id: true, code: true },
      }),
    ]);
    if (!staff) throw new AppointmentInventoryUnavailableError('Staff member is not active in this organization.');
    if (!service) throw new AppointmentInventoryUnavailableError('Appointment service is not active in this organization.');
    const existing = await transaction.appointmentStaffService.findUnique({
      where: {
        organizationId_staffId_serviceId: {
          organizationId: input.organizationId,
          staffId: staff.id,
          serviceId: service.id,
        },
      },
    });
    if (existing) return existing;
    const created = await transaction.appointmentStaffService.create({
      data: { organizationId: input.organizationId, staffId: staff.id, serviceId: service.id },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.appointment-staff-service.assigned',
        resourceType: 'appointment-staff-service',
        resourceId: `${staff.id}:${service.id}`,
        afterData: { staffId: staff.id, serviceId: service.id, serviceCode: service.code },
      },
    });
    return created;
  }, { isolationLevel: 'Serializable' });
}

export async function removeAppointmentServiceFromStaff(input: {
  organizationId: string;
  actorUserId: string;
  staffId: string;
  serviceId: string;
  confirmation: string;
}) {
  await requireInventoryManage(input);
  assertUuidIdentifier(input.staffId, 'staffId');
  assertUuidIdentifier(input.serviceId, 'serviceId');
  assertAppointmentRemoveConfirmation(input.confirmation);
  return db.$transaction(async (transaction) => {
    const assignment = await transaction.appointmentStaffService.findUnique({
      where: {
        organizationId_staffId_serviceId: {
          organizationId: input.organizationId,
          staffId: input.staffId,
          serviceId: input.serviceId,
        },
      },
      include: { service: { select: { code: true } } },
    });
    if (!assignment) {
      throw new AppointmentInventoryUnavailableError('Staff service assignment is not available in this organization.');
    }
    await transaction.appointmentStaffService.delete({
      where: {
        organizationId_staffId_serviceId: {
          organizationId: input.organizationId,
          staffId: input.staffId,
          serviceId: input.serviceId,
        },
      },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.appointment-staff-service.removed',
        resourceType: 'appointment-staff-service',
        resourceId: `${input.staffId}:${input.serviceId}`,
        beforeData: { staffId: input.staffId, serviceId: input.serviceId, serviceCode: assignment.service.code },
      },
    });
  }, { isolationLevel: 'Serializable' });
}

export async function createAppointmentSchedule(input: {
  organizationId: string;
  actorUserId: string;
  staffId: string;
  schedule: AppointmentScheduleInput;
}) {
  await requireInventoryManage(input);
  assertUuidIdentifier(input.staffId, 'staffId');
  const schedule = normalizeAppointmentScheduleInput(input.schedule);
  try {
    return await db.$transaction(async (transaction) => {
      const staff = await transaction.appointmentStaff.findFirst({
        where: { id: input.staffId, organizationId: input.organizationId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!staff) throw new AppointmentInventoryUnavailableError('Staff member is not active in this organization.');
      const overlap = await transaction.appointmentSchedule.findFirst({
        where: {
          organizationId: input.organizationId,
          staffId: staff.id,
          status: 'ACTIVE',
          dayOfWeek: schedule.dayOfWeek,
          startsAtMinute: { lt: schedule.endsAtMinute },
          endsAtMinute: { gt: schedule.startsAtMinute },
        },
        select: { id: true },
      });
      if (overlap) {
        throw new AppointmentInventoryConflictError('That working-hours schedule overlaps another active schedule for this staff member.');
      }
      const created = await transaction.appointmentSchedule.create({
        data: { organizationId: input.organizationId, staffId: staff.id, ...schedule },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'inventory.appointment-schedule.created',
          resourceType: 'appointment-schedule',
          resourceId: created.id,
          afterData: {
            staffId: created.staffId,
            dayOfWeek: created.dayOfWeek,
            startsAtMinute: created.startsAtMinute,
            endsAtMinute: created.endsAtMinute,
            status: created.status,
          },
        },
      });
      return created;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error instanceof AppointmentInventoryConflictError) throw error;
    if (isUniqueConstraintError(error)) {
      throw new AppointmentInventoryConflictError('That working-hours schedule already exists for this staff member.');
    }
    throw error;
  }
}

export async function archiveAppointmentSchedule(input: {
  organizationId: string;
  actorUserId: string;
  staffId: string;
  scheduleId: string;
  confirmation: string;
}) {
  await requireInventoryManage(input);
  assertUuidIdentifier(input.staffId, 'staffId');
  assertUuidIdentifier(input.scheduleId, 'scheduleId');
  assertAppointmentArchiveConfirmation(input.confirmation);
  return db.$transaction(async (transaction) => {
    const current = await transaction.appointmentSchedule.findFirst({
      where: {
        id: input.scheduleId,
        staffId: input.staffId,
        organizationId: input.organizationId,
        status: 'ACTIVE',
      },
      select: { id: true, status: true },
    });
    if (!current) throw new AppointmentInventoryUnavailableError('Schedule is not active in this organization.');
    const archivedAt = new Date();
    const updated = await transaction.appointmentSchedule.update({
      where: { id: current.id },
      data: { status: 'ARCHIVED', archivedAt },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.appointment-schedule.archived',
        resourceType: 'appointment-schedule',
        resourceId: current.id,
        beforeData: { status: current.status },
        afterData: { status: 'ARCHIVED', archivedAt: archivedAt.toISOString() },
      },
    });
    return updated;
  }, { isolationLevel: 'Serializable' });
}

export async function archiveAppointmentService(input: {
  organizationId: string;
  actorUserId: string;
  serviceId: string;
  confirmation: string;
}) {
  await requireInventoryManage(input);
  assertUuidIdentifier(input.serviceId, 'serviceId');
  assertAppointmentArchiveConfirmation(input.confirmation);
  return db.$transaction(async (transaction) => {
    const current = await transaction.appointmentService.findFirst({
      where: { id: input.serviceId, organizationId: input.organizationId, status: 'ACTIVE' },
      select: { id: true, status: true },
    });
    if (!current) throw new AppointmentInventoryUnavailableError('Appointment service is not active in this organization.');
    const assignments = await transaction.appointmentStaffService.count({
      where: { organizationId: input.organizationId, serviceId: current.id },
    });
    if (assignments > 0) {
      throw new AppointmentInventoryDependencyError('Remove active staff assignments before archiving the appointment service.');
    }
    const archivedAt = new Date();
    const updated = await transaction.appointmentService.update({
      where: { id: current.id },
      data: { status: 'ARCHIVED', archivedAt },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.appointment-service.archived',
        resourceType: 'appointment-service',
        resourceId: current.id,
        beforeData: { status: current.status },
        afterData: { status: 'ARCHIVED', archivedAt: archivedAt.toISOString() },
      },
    });
    return updated;
  }, { isolationLevel: 'Serializable' });
}

export async function archiveAppointmentStaff(input: {
  organizationId: string;
  actorUserId: string;
  staffId: string;
  confirmation: string;
}) {
  await requireInventoryManage(input);
  assertUuidIdentifier(input.staffId, 'staffId');
  assertAppointmentArchiveConfirmation(input.confirmation);
  return db.$transaction(async (transaction) => {
    const current = await transaction.appointmentStaff.findFirst({
      where: { id: input.staffId, organizationId: input.organizationId, status: 'ACTIVE' },
      select: { id: true, status: true },
    });
    if (!current) throw new AppointmentInventoryUnavailableError('Staff member is not active in this organization.');
    const [activeSchedules, assignments] = await Promise.all([
      transaction.appointmentSchedule.count({
        where: { organizationId: input.organizationId, staffId: current.id, status: 'ACTIVE' },
      }),
      transaction.appointmentStaffService.count({
        where: { organizationId: input.organizationId, staffId: current.id },
      }),
    ]);
    if (activeSchedules > 0 || assignments > 0) {
      throw new AppointmentInventoryDependencyError('Archive active schedules and remove service assignments before archiving the staff member.');
    }
    const archivedAt = new Date();
    const updated = await transaction.appointmentStaff.update({
      where: { id: current.id },
      data: { status: 'ARCHIVED', archivedAt },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.appointment-staff.archived',
        resourceType: 'appointment-staff',
        resourceId: current.id,
        beforeData: { status: current.status },
        afterData: { status: 'ARCHIVED', archivedAt: archivedAt.toISOString() },
      },
    });
    return updated;
  }, { isolationLevel: 'Serializable' });
}
