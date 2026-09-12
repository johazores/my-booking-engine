# Travelport Stays Reservation Operation Input Authority

## Purpose

Travelport reservation operations are commercial boundaries even while the `reservation` capability remains disabled. Initial Create, reviewed Create, Booking.com Sync, and known-locator recovery accept caller-owned JavaScript objects before OAuth or provider transport. `Readonly` typing alone cannot prevent a getter, proxy, or mutable caller from changing or throwing while those operations materialize request authority.

SF now establishes one shared fail-closed operation-input boundary before each of those reservation paths performs business validation or provider I/O.

## Allowlisted operation snapshots

`materializeTravelportStaysReservationOperationInput` copies only the declared top-level fields for an operation into a new frozen object. Every declared field is read once during that copy. Arrays are rejected as operation objects, and a revoked proxy or throwing accessor is converted to a fixed `INVALID_REQUEST` error rather than allowing caller-controlled exception text to escape.

The operation-specific allowlists are intentionally narrow:

- initial Create snapshots request correlation, already-built non-secret request material, fresh payment authority, deferred payment-card acquisition, expected reservation identity, and the durable provider-request marker;
- reviewed Create snapshots the same fields plus the accepted-review object, then separately snapshots its price-change and guarantee-change booleans before URL/query construction;
- Booking.com Sync snapshots correlation, recovery reference, supplier confirmation, normalized traveler, expected reservation identity, and the durable provider-request marker before request construction and OAuth;
- known-locator recovery snapshots the provider locator, correlation ID, and expected reservation input before normalization and token acquisition.

The existing deeper authority boundaries remain in force. Expected reservation identity is normalized into an immutable stay snapshot, Sync request construction produces provider-specific request authority before OAuth, the payment-card source snapshots its own sensitive result separately, and constructor authority remains isolated from caller mutation.

## Failure semantics

Operation materialization is not provider transport and creates no retry authority. If caller-owned material cannot be read safely, the operation fails before OAuth, before card acquisition, before a durable external-write marker, and before any Travelport commercial request. Source exception messages are not propagated.

Once a Create or Sync durable provider-request marker has succeeded, existing ambiguity and recovery rules still apply. This change does not reinterpret provider timeouts, `13034`, locator-less outcomes, or provider confirmation evidence.

## Similar-issue sweep

The same top-level caller-owned pattern existed in all three implemented reservation I/O entry points: Create, Sync, and known-locator recovery. Reviewed Create also had a direct `input.acceptedReview` read before the common Create path. All four entry paths now use the same allowlisted materialization rule rather than fixing only one caller.

The payment-card capability was reviewed as part of the sweep and already establishes an independent one-read frozen context/card snapshot with sanitized source failures, so it was not duplicated here.

## Activation boundary

Travelport `reservation` remains deliberately disabled. This authority hardening does not provide the concrete reviewed PCI-safe FormOfPayment/guarantee source and does not replace live non-production SearchComplete → Rules → Availability → initial Create → reviewed Create → Sync/recovery verification. Authoritative live `13034` and locator-less correlation/retry semantics also remain activation gates.

Related documentation:

- `docs/travelport-reservation-prewrite-authority.md`
- `docs/travelport-stays-reservation-expectation-authority.md`
- `docs/travelport-reservation-payment-card-boundary.md`
- `docs/travelport-stays-constructor-authority.md`
