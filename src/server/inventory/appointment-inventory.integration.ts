import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Appointment inventory integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('appointment inventory enforces tenant scope, permissions, staff-service ownership, schedules, lifecycle, and audit', async () => {
  const [{ db }, appointments] = await Promise.all([
    import('../database.ts'),
    import('./appointment-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const adminA = await db.user.create({ data: { email: `appointment-admin-a-${runId}@example.test`, status: 'ACTIVE' } });
  const staffUserA = await db.user.create({ data: { email: `appointment-staff-a-${runId}@example.test`, status: 'ACTIVE' } });
  const adminB = await db.user.create({ data: { email: `appointment-admin-b-${runId}@example.test`, status: 'ACTIVE' } });
  const organizationA = await db.organization.create({
    data: {
      name: 'Appointment Tenant A',
      slug: `appointment-a-${runId}`.slice(0, 63),
      kind: 'APPOINTMENT_BUSINESS',
      timezone: 'Asia/Manila',
    },
  });
  const organizationB = await db.organization.create({
    data: {
      name: 'Appointment Tenant B',
      slug: `appointment-b-${runId}`.slice(0, 63),
      kind: 'APPOINTMENT_BUSINESS',
      timezone: 'Asia/Manila',
    },
  });
  await db.organizationMembership.createMany({ data: [
    { organizationId: organizationA.id, userId: adminA.id, status: 'ACTIVE', role: 'ADMIN' },
    { organizationId: organizationA.id, userId: staffUserA.id, status: 'ACTIVE', role: 'STAFF' },
    { organizationId: organizationB.id, userId: adminB.id, status: 'ACTIVE', role: 'ADMIN' },
  ] });

  try {
    const serviceA = await appointments.createAppointmentService({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      service: {
        name: 'Initial consultation',
        code: 'CONSULT',
        description: 'First appointment',
        durationMinutes: '60',
        bufferBeforeMinutes: '10',
        bufferAfterMinutes: '10',
      },
    });
    const serviceB = await appointments.createAppointmentService({
      organizationId: organizationB.id,
      actorUserId: adminB.id,
      service: {
        name: 'Other tenant service',
        code: 'OTHER',
        description: '',
        durationMinutes: '30',
        bufferBeforeMinutes: '0',
        bufferAfterMinutes: '0',
      },
    });
    const appointmentStaffA = await appointments.createAppointmentStaff({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      staff: {
        name: 'Jamie Cruz',
        code: 'JAMIE',
        description: 'Senior specialist',
        timezone: 'Asia/Manila',
      },
    });

    await assert.rejects(
      appointments.createAppointmentService({
        organizationId: organizationA.id,
        actorUserId: staffUserA.id,
        service: {
          name: 'Denied',
          code: 'DENIED',
          description: '',
          durationMinutes: '30',
          bufferBeforeMinutes: '0',
          bufferAfterMinutes: '0',
        },
      }),
      /permission/i,
    );
    await assert.rejects(
      appointments.assignAppointmentServiceToStaff({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        staffId: appointmentStaffA.id,
        serviceCode: serviceB.code,
      }),
      /not active in this organization/i,
    );

    const assignment = await appointments.assignAppointmentServiceToStaff({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      staffId: appointmentStaffA.id,
      serviceCode: serviceA.code,
    });
    const repeatedAssignment = await appointments.assignAppointmentServiceToStaff({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      staffId: appointmentStaffA.id,
      serviceCode: serviceA.code,
    });
    assert.equal(repeatedAssignment.serviceId, assignment.serviceId);

    const schedule = await appointments.createAppointmentSchedule({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      staffId: appointmentStaffA.id,
      schedule: { dayOfWeek: '1', startsAt: '09:00', endsAt: '17:00' },
    });
    await assert.rejects(
      appointments.createAppointmentSchedule({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        staffId: appointmentStaffA.id,
        schedule: { dayOfWeek: '1', startsAt: '12:00', endsAt: '18:00' },
      }),
      /overlaps another active schedule/i,
    );

    const overview = await appointments.listAppointmentInventory({
      organizationId: organizationA.id,
      actorUserId: staffUserA.id,
      servicePage: 1,
      staffPage: 1,
      pageSize: 20,
    });
    assert.deepEqual(overview.serviceResult.services.map((service) => service.id), [serviceA.id]);
    assert.deepEqual(overview.staffResult.staff.map((staff) => staff.id), [appointmentStaffA.id]);

    const detail = await appointments.readAppointmentStaffInventory({
      organizationId: organizationA.id,
      actorUserId: staffUserA.id,
      staffId: appointmentStaffA.id,
      schedulePage: 1,
      servicePage: 1,
      pageSize: 20,
    });
    assert.equal(detail.scheduleResult.schedules[0]?.id, schedule.id);
    assert.equal(detail.serviceResult.assignments[0]?.serviceId, serviceA.id);
    await assert.rejects(
      appointments.readAppointmentStaffInventory({
        organizationId: organizationB.id,
        actorUserId: adminB.id,
        staffId: appointmentStaffA.id,
        schedulePage: 1,
        servicePage: 1,
        pageSize: 20,
      }),
      /not available in this organization/i,
    );

    await assert.rejects(
      appointments.archiveAppointmentService({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        serviceId: serviceA.id,
        confirmation: 'ARCHIVE',
      }),
      /remove active staff assignments/i,
    );
    await assert.rejects(
      appointments.archiveAppointmentStaff({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        staffId: appointmentStaffA.id,
        confirmation: 'ARCHIVE',
      }),
      /archive active schedules and remove service assignments/i,
    );

    await appointments.archiveAppointmentSchedule({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      staffId: appointmentStaffA.id,
      scheduleId: schedule.id,
      confirmation: 'ARCHIVE',
    });
    await appointments.removeAppointmentServiceFromStaff({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      staffId: appointmentStaffA.id,
      serviceId: serviceA.id,
      confirmation: 'REMOVE',
    });
    await appointments.archiveAppointmentService({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      serviceId: serviceA.id,
      confirmation: 'ARCHIVE',
    });
    await appointments.archiveAppointmentStaff({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      staffId: appointmentStaffA.id,
      confirmation: 'ARCHIVE',
    });

    const events = await db.auditEvent.findMany({
      where: { organizationId: organizationA.id, resourceType: { startsWith: 'appointment-' } },
    });
    assert.ok(events.some((event) => event.action === 'inventory.appointment-service.created'));
    assert.ok(events.some((event) => event.action === 'inventory.appointment-staff.created'));
    assert.ok(events.some((event) => event.action === 'inventory.appointment-staff-service.assigned'));
    assert.ok(events.some((event) => event.action === 'inventory.appointment-schedule.created'));
    assert.ok(events.some((event) => event.action === 'inventory.appointment-staff.archived'));
  } finally {
    await db.auditEvent.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.appointmentStaffService.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.appointmentSchedule.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.appointmentStaff.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.appointmentService.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.organizationMembership.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.organization.deleteMany({ where: { id: { in: [organizationA.id, organizationB.id] } } });
    await db.user.deleteMany({ where: { id: { in: [adminA.id, staffUserA.id, adminB.id] } } });
  }
});
