# Rental damage cases

SF records a durable operational damage-case workflow after a non-clear rental return inspection. This workflow exists to retain repair-assessment and resolution evidence without turning an inspection into an automatic customer charge.

A damage case can be opened only from retained `DAMAGE_REPORTED` or `UNSAFE` return-inspection evidence for the same tenant booking and returned physical unit. A `CLEAR` inspection cannot create a damage case.

## Durable lifecycle

`RentalDamageCase` has four states:

- `OPEN` — follow-up has been opened from non-clear inspection evidence.
- `ASSESSED` — staff retained an exact repair-cost estimate in the booking currency and assessment notes.
- `WAIVED` — the operational damage case was explicitly waived with a retained reason. This is terminal.
- `CLOSED` — an assessed case was resolved with retained resolution notes. This is terminal.

Allowed transitions are `OPEN -> ASSESSED`, `OPEN -> WAIVED`, `ASSESSED -> WAIVED`, and `ASSESSED -> CLOSED`. Terminal cases cannot be changed or deleted.

Each booking and each source return inspection can own at most one damage case. The server derives `rental-damage-case:<bookingId>` as the idempotency key; browser input cannot select or override it.

## Authority and tenant isolation

Reading a damage case requires `booking:read`.

Opening, assessing, waiving, and closing require both `booking:manage` and `inventory:manage`. Every server operation validates UUID identifiers and repeats `organizationId` on damage-case, booking, inspection, unit, and operational-state reads/writes.

The writer uses the existing tenant/unit advisory lock. Opening a case revalidates the exact confirmed booking, non-clear return inspection, returned unit, and booking currency after the lock is held.

PostgreSQL independently enforces the same source binding: the inspection must belong to the tenant booking and retained unit, its outcome must be `DAMAGE_REPORTED` or `UNSAFE`, the booking currency must match the damage-case currency, and the unit must remain active.

## Operational quarantine

An unresolved `OPEN` or `ASSESSED` damage case is an operational safety boundary.

Opening a case keeps the returned unit `OUT_OF_SERVICE`. If the non-clear inspection already quarantined it, the existing operational reason is preserved. If the unit is unexpectedly available, opening the case moves it out of service before the case is inserted.

Both the application operational-state writer and PostgreSQL reject returning the unit to `AVAILABLE` while an unresolved damage case exists. PostgreSQL also rejects archiving the unit while the case is unresolved.

Waiving or closing the final active damage case does not automatically make the unit available. Maintenance or another retained operational concern may still exist, so readiness remains an explicit inventory-management decision.

## Repair estimate semantics

An assessment records an exact non-negative repair-cost estimate using the booking currency and the shared exact-money parser. During `OPEN` and `ASSESSED`, that estimate remains operational evidence rather than an amount due from the customer.

After an assessed case is resolved and `CLOSED`, authorized commercial staff can record one separate append-only customer-liability decision. That decision is intentionally downstream of the closed operational case and cannot exceed the retained repair estimate under the current contract.

See `docs/rental-damage-liability.md` for the liability authority and settlement boundary.

The repair estimate itself is not a payment authorization/capture, refund adjustment, security-bond/deposit forfeiture decision, or tax/accounting settlement.

## Audit and time authority

Opening, assessment, waiver, and closure create tenant audit events without customer payment data or secrets.

PostgreSQL authors `openedAt`, `assessedAt`, `waivedAt`, `closedAt`, `createdAt`, and `updatedAt` with `clock_timestamp()` at the applicable lifecycle boundary. Source evidence is immutable after opening, and terminal cases are immutable.

## Staff workflow

The rental booking detail displays the damage-case workflow immediately below a retained non-clear return inspection. Authorized staff can open a case with a required summary; an open case can be assessed with an exact repair estimate and required notes, or waived with a required reason; an assessed case can be closed with required resolution notes, or waived with a required reason; terminal evidence remains read-only.

After a closed assessed case, actors with booking/payment commercial permissions can see the separate customer-liability decision workflow. The UI keeps operational repair evidence distinct from commercial liability and explicitly states that neither action by itself collects money.

## Deliberate boundaries

This foundation now implements operational damage assessment/resolution plus a separate post-closure customer-liability decision. It still does not implement automatic charges, damage settlement, security bonds/deposits, insurance claims, repair vendors, purchase orders, parts/labor line items, file/photo evidence, notifications, or external maintenance synchronization.

Future collection or security-bond workflows must consume the immutable liability decision rather than rewriting inspection or damage-case evidence.

## Validation

`src/server/bookings/rental-damage-case-domain.test.ts` covers normalization, exact-money assessment input, required terminal evidence, and lifecycle transitions.

`scripts/rental-damage-case-source-contract.test.mjs` protects schema ownership, deterministic idempotency, non-clear inspection binding, dual permissions, tenant/unit locking, operational quarantine, unresolved-case release/archive guards, PostgreSQL time authority, real staff actions, and the deliberate no-charge boundary.

The downstream commercial decision has its own validation documented in `docs/rental-damage-liability.md`.

Full repository validation remains `npm run validate` on the Node version declared in `package.json`. Migration and trigger behavior should also be executed through `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
