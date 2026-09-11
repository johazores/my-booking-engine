# Travelport Sync pre-write identity authority

## Purpose

Travelport Booking.com Sync is an external recovery write. It exists only for the narrow supplier-sold / Travelport-PNR-incomplete workflow already described in `travelport-booking-sync-recovery-authority.md`. A successful Sync response is useful only when SF can prove that the returned hospitality segment is the same property, stay, room quantity, and guest count that the durable supplier reservation expected.

The Sync executor therefore treats that expected reservation identity as pre-write authority rather than as a response-only comparison hint.

## Boundary

Before OAuth, transport preflight, the durable provider-request marker, or any provider network call, `TravelportStaysReservationSyncExecutor` now validates and materializes an immutable snapshot containing only:

- Travelport chain code;
- Travelport property code;
- arrival local date;
- departure local date;
- the current single-room quantity; and
- total guest count.

Chain and property identifiers must remain canonical alphanumeric machine tokens inside the existing length limits. Dates must be real `YYYY-MM-DD` local dates with departure after arrival. The current production contract remains exactly one room and one to nine guests.

Malformed authority fails as `INVALID_REQUEST` before provider I/O. The response classifier receives the immutable snapshot, not the caller-owned object. This prevents a mutable caller from validating one reservation identity before the write and presenting a different identity after the provider response.

The ordinary server coordinator already constructs this identity from tenant-scoped durable reservation state through `normalizeTravelportStaysReservationExpectation`, which returns a frozen object. The executor-level snapshot is intentional defense in depth at the provider write boundary and protects future server-only callers from bypassing that assumption.

## Related request authority

The same scope also aligns the Sync executor cache-key boundary with the rest of the Travelport reservation adapters. Cache keys must be exact bounded strings and reject the full ASCII control range `U+0000` through `U+001F` plus `U+007F`; values are never made valid by trimming.

Other related paths were reviewed rather than changed unnecessarily:

- initial and reviewed Create already validate the same property/stay/room/guest result authority before OAuth and provider marking;
- known-locator Retrieve normalizes its expected reservation before access-token acquisition and provider I/O; and
- the Sync request builder already validates the retained offer authority, Booking.com supplier confirmation, and traveler request material independently.

## Provider contract

Travelport documents Sync Reservation as `POST book/reservations/` with no query parameters. The request is intended to synchronize a Booking.com reservation after the documented aggregator sell failure without re-selling the Booking.com segment. The response uses the Create Reservation response structure, so SF must retain exact reservation identity evidence for response settlement.

This hardening does not enable Travelport `reservation`, broaden recovery eligibility, change the durable recovery state machine, or infer new semantics for `13034` or locator-less ambiguity.

## Validation

Focused executor behavior coverage proves malformed property/stay/room/guest authority and embedded ASCII-control cache keys fail before OAuth/provider I/O or the durable marker. The dependency-free contract test additionally pins:

- identity validation and immutable materialization before Sync request construction;
- ordering before OAuth, transport preflight, durable provider marking, and commercial provider I/O;
- reuse of the materialized identity after provider I/O instead of caller-owned state;
- property/stay/room/guest constraints; and
- full ASCII-control rejection on the Sync cache authority boundary.

Full repository validation still requires the repository Node 24.20+/TypeScript 6 environment. Database-backed scenarios require an explicitly disposable PostgreSQL target. Live Sync verification remains blocked on provisioned Travelport non-production access and the wider reservation activation prerequisites.

## References

- Travelport Sync Reservation API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Sync.htm
- Travelport Stays APIs Guide: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/Guides/HotelAPIsGuide.htm
- `docs/travelport-booking-sync-recovery-authority.md`
- `docs/travelport-stays-integration.md`
