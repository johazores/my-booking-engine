# Travelport Stays receipt explicit-null evidence

## Purpose

Travelport reservation receipts are provider-owned evidence used to establish durable PNR identity, supplier confirmation identity, and cancellation lifecycle state. SF distinguishes a field that is genuinely omitted from a field that is explicitly present as JSON `null` once the receipt identifies itself as Travelport Stays evidence.

This contract applies to the shared receipt inspector used by Create Reservation, reviewed Create, Booking.com Sync, and known-locator Retrieve. It does not enable the Travelport `reservation` capability.

## Current provider shape

Travelport's current Stays Create and Retrieve examples return three reservation receipt families:

- the supplier receipt uses `sourceContext=Supplier`, a supplier locator type, and a two-character `source`;
- the agency receipt can omit `source`;
- the Travelport PNR receipt omits `source`;
- relevant receipts return a structured `OfferStatus` object with `@type=OfferStatusHospitality` and a lifecycle `Status`.

The current Cancel example similarly returns a supplier cancellation locator with a concrete supplier `source` and a structured `OfferStatus` carrying `Status=Cancelled`.

Those examples establish real omission as a compatibility requirement for `Locator.source` on Travelport/Agency receipts. They do not establish explicit JSON `null` as equivalent to omission.

## Fail-closed rule

For a canonical Stays locator pair, explicit `null` is malformed provider evidence for:

- `Locator.source`; and
- the `Confirmation.OfferStatus` or `Cancellation.OfferStatus` container.

Genuine omission remains compatible at the shared receipt-inspection layer. This is important because `source` is legitimately omitted from current Travelport and Agency receipt examples, and the lower-level inspector can also be used for bounded historical/provider-record inspection where lifecycle status may not be required by the caller.

Create/Sync and active known-locator recovery retain their stricter caller-level rules. A durable active reservation still requires the existing confirmed PNR/supplier status evidence where applicable.

## Multi-content boundary

The stricter null rule is limited to receipts that identify themselves with a supported Stays source/locator pair. Unrelated shared-model confirmation evidence remains outside Stays authority and is not rejected merely because one of its optional fields is null.

This preserves the repository's multi-content compatibility while preventing malformed Stays-owned fields from disappearing beside otherwise valid durable locator evidence.

## Cancellation boundary

A canonical Stays cancellation receipt also treats explicit-null `Locator.source` and explicit-null `Cancellation.OfferStatus` as malformed. Genuine omission remains distinguishable from null at this low-level inspection boundary.

Supplier cancellation authority is still not promoted into active reservation identity. Existing Create/Sync and active Retrieve callers continue to treat supplier cancellation evidence as incompatible with a confirmed active reservation.

## Validation

Focused executable coverage verifies:

- Travelport PNR `source` omission remains valid;
- explicit-null `source` fails for canonical Travelport and Supplier confirmation receipts;
- `OfferStatus` omission remains distinguishable from explicit null;
- explicit-null `OfferStatus` fails for canonical Stays confirmation receipts;
- canonical Stays cancellation rejects explicit-null `source` and `OfferStatus`;
- genuine cancellation omission remains compatible at the shared inspector; and
- unrelated multi-content confirmation evidence remains outside the Stays-only strict null guards.

A dependency-free source contract pins the Stays-only null guards so future refactors cannot silently restore null-as-omission behavior.

Full repository validation, PostgreSQL-backed scenarios, production build, and live Travelport verification remain separate activation requirements.

## References

- Travelport Create Reservation Reference Payload API Reference.
- Travelport Retrieve Hotel Reservation API Reference.
- Travelport Cancel Hotel Reservation API Reference.
- Travelport Sync Reservation API Reference.
- `docs/travelport-reservation-response-evidence.md`.
