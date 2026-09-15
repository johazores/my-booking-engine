# Commercial amendment lifecycle write scope

Normal hospitality commercial amendments freeze a reviewed booking and pricing snapshot before money moves. Preparation, safe expiry/cancellation, and final serializable apply therefore use a defense-in-depth persistence boundary: a final Prisma mutation must retain the same tenant, booking, amendment lifecycle, version, commercial identity, and exact money snapshot that were validated under the booking and inventory locks.

This contract strengthens the final write boundary. It does not replace authentication, `booking:manage` plus `payment:manage` authorization, advisory locks, serializable transactions, settlement reconciliation, inventory protection, pricing revalidation, or audit history.

## Preparation and terminal lifecycle invariant

Preparation creates a tenant-owned `HospitalityBookingCommercialAmendment` only after the confirmed paid booking, reconciled settlement, reviewed adjustment fingerprint, target room/rate assignment, restrictions, occupancy, pricing, and capacity are revalidated. The created row freezes the source booking version, current and target commercial identity, before/after money, provider, direction, target protection, and bounded expiry.

When an expired prepared amendment has no payment activity requiring recovery, the final `EXPIRED` mutation retains the amendment ID together with `organizationId`, `bookingId`, expected `PREPARED` state, expired `expiresAt`, and the target hold identity that was released in the same serializable transaction.

Explicit cancellation follows the same rule. After payment evidence proves cancellation is safe and any target hold is released, the final amendment mutation retains tenant and booking scope plus the prepared lifecycle, booking version, selection and adjustment fingerprints, settlement provider, direction, currency, before/after totals, delta, target hold identity, and expiry that authorized the terminal transition. A stale or rebound amendment cannot be terminalized through an ID-only write.

## Final booking mutation invariant

`applyHospitalityBookingCommercialAmendment` remains the only boundary allowed to commit the reviewed non-zero commercial change. Before mutation it revalidates the exact booking version and current commercial snapshot, target selection, current restrictions and capacity, target pricing, target hold/protection, and complete amendment-attributed settlement.

The final booking mutation retains:

- booking `id` and `organizationId`
- expected `CONFIRMED` lifecycle
- the frozen amendment `bookingVersion`
- property, current room type, current rate plan, and current quantity
- expected pre-apply `PAID` booking payment state
- exact currency and every persisted before-price aggregate
- the before pricing fingerprint

Only if that predicate still matches can SF replace room/rate/quantity/add-ons, accepted price aggregates/fingerprint, and the denormalized payment state. The allocation mutation already uses the organization+booking composite key. Target hold release remains inside the existing tenant-scoped availability-hold core and participates in the same serializable apply transaction.

## Final amendment mutation invariant

The final `PREPARED -> APPLIED` mutation retains the amendment ID together with organization and booking ownership, source booking version, selection and adjustment fingerprints, settlement provider, direction, currency, before/after totals and delta, current/target room-rate-quantity identity, target hold/protection identity, and expiry.

Because booking mutation, allocation movement, target hold release, amendment terminalization, and audit writes share one serializable transaction, a failure of the final amendment predicate rolls the whole apply back rather than leaving a partially applied commercial change.

## Similar-issue boundary

This review covers the normal versioned commercial-amendment preparation, expiry/cancellation, and final apply persistence family. The direct zero-delta commercial-modification path, traveler/reschedule/cancellation lifecycles, legal-document issuance, and expired amendment Stripe compensation have different acceptance criteria. Expired Stripe recovery already has its own write-scope contract and is not duplicated here.

## Validation

`scripts/commercial-amendment-lifecycle-write-scope.test.mjs` is a dependency-free source contract. It guards the two amendment terminal mutations, the final booking mutation, the final amendment apply mutation, tenant-owned allocation/hold boundaries, required permissions, locking/settlement dependencies, and the documented architecture contract.

The source contract does not replace repository validation. Full Node 24 / TypeScript validation, Prisma validate/generate, migrations and drift checks, production build, PostgreSQL locking/concurrency scenarios, and live payment-provider verification remain required when those environments are available. No database or provider check is considered passed merely because the source contract passes.

GitHub Actions are intentionally not used for this repository. Validation for this boundary must use local/manual repository commands and explicitly disposable infrastructure where database execution is required.
