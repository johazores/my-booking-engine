# Travelport Stays reservation expectation authority

## Purpose

Travelport Create, reviewed Create, Booking.com Sync, and known-locator recovery all consume the same expected-stay identity before provider reservation evidence can change durable booking state. That identity contains the selected property reference, stay dates, single-room quantity, adult count, and child ages.

TypeScript `Readonly` does not make a caller-owned runtime object immutable. The shared reservation expectation normalizer therefore must not validate one view of occupancy or dates and later consume a different view from accessors, proxies, or mutation.

## One-read materialization

`normalizeTravelportStaysReservationExpectation` now materializes its provider-neutral input before decoding or validating reservation identity.

The materializer:

- reads `supplierPropertyReference`, arrival, departure, room count, adult count, and `childAges` exactly once from the caller-owned object;
- copies child ages into a new frozen array before occupancy validation;
- stores those values in a frozen allowlisted snapshot;
- validates property identity, dates, room count, adult count, child ages, and the one-to-nine guest ceiling only from that snapshot; and
- converts throwing accessors, revoked proxies, and child-array materialization failures into a fixed `INVALID_REQUEST` supplier error without propagating caller-controlled exception text.

This closes a time-of-check/time-of-use gap in the shared identity function itself. The existing Create and Sync pre-write snapshots remain useful defense in depth, while known-locator recovery now receives the same one-read guarantee at the point where its provider-neutral expected reservation is normalized.

## Similar-scope review

The shared normalizer is used by initial Create, reviewed Create, Booking.com Sync coordination, and known-locator recovery. Fixing the authority at this common dependency protects all of those flows without duplicating provider-specific snapshots.

The downstream Create/Sync executors already materialize their execution authority, and the public SearchComplete, Rules, Availability, constructor, and payment-card boundaries already use their own one-read/frozen snapshots. This change intentionally does not merge those distinct boundaries or change their retry/recovery semantics.

## Validation

Focused behavior coverage verifies:

- the existing canonical property/date/occupancy behavior;
- exactly one top-level read for every expected-reservation field;
- one-read child-age snapshotting before occupancy validation; and
- sanitized `INVALID_REQUEST` failures for throwing accessors and revoked proxies.

A dependency-free source contract pins the materialization order, frozen child-age snapshot, sanitized failure boundary, documentation scope, and activation boundary.

Full repository validation still requires the repository-supported Node 24.20+ / TypeScript 6 dependency environment and the database checks described in issue #1.

## Activation boundary

This hardening does not enable the Travelport `reservation` capability. Activation still requires a concrete reviewed PCI-safe FormOfPayment/guarantee source, live non-production SearchComplete → Rules → Availability → initial Create → reviewed Create → Sync/recovery verification, and authoritative live `13034` / locator-less correlation and retry semantics.

Related documentation:

- `docs/travelport-reservation-prewrite-authority.md`
- `docs/travelport-sync-prewrite-identity-authority.md`
- `docs/travelport-stays-constructor-authority.md`
- `docs/travelport-reservation-payment-card-boundary.md`
