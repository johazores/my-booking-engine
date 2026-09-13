# Travelport reservation reference route authority

## Purpose

Known-locator Travelport Retrieve is read-only, but its path selects the supplier reservation that can become recovery evidence. SF therefore treats the reservation reference as provider authority before any Retrieve request can reach the Travelport transport.

This hardening does not enable the Travelport `reservation` capability.

## Production rule

The durable Travelport reservation reference and the reservation-only transport route gate share one provider-specific authority helper.

A provider reservation reference is accepted only when it is:

- a string;
- non-empty after trimming;
- already trimmed, with no leading/trailing whitespace;
- at most 512 JavaScript string code units, matching the existing recovery-provider boundary;
- well-formed UTF-16, so lone high or low surrogate code units cannot cross into URL serialization; and
- free of ASCII control characters (`U+0000` through `U+001F`, plus `U+007F`).

The recovery provider validates the durable `providerReservationReference` with that helper before it constructs `GET /11/hotel/book/reservations/{AggregatorLocatorCode}`. Because a reference must be well-formed before that point, `encodeURIComponent` cannot surface a native `URIError` for malformed Unicode outside SF's provider failure taxonomy.

The outer reservation transport independently applies the same authority to the encoded path segment before provider I/O. It requires exactly one path segment, successful percent decoding, the shared bounded reference rule above, and exact canonical round-trip encoding with `encodeURIComponent`. Non-canonical percent encodings, malformed escapes, padded references, control-bearing references, ill-formed Unicode, and references over 512 code units therefore fail as `INVALID_REQUEST` before the provider fetch is invoked.

Internal characters that the existing recovery provider already permits remain permitted. For example, an internal space or slash is valid only when represented by the exact `encodeURIComponent` form in the single raw path segment. Valid non-BMP Unicode represented by a well-formed surrogate pair is also preserved. This change does not invent a narrower supplier locator alphabet that Travelport has not established.

The general Travelport transport keeps its broader single-segment logic because that layer also serves SearchComplete and Availability continuation identifiers with different acceptance criteria. Reservation Retrieve is narrowed by the reservation-specific outer authority before delegation, so unrelated pagination semantics are not changed.

## Failure semantics

Malformed or non-canonical reservation references are local request-authority failures. They cannot trigger provider I/O and cannot become `FOUND`, `NOT_FOUND`, confirmation, or lifecycle evidence.

A reference that passes this route boundary still has no commercial meaning by itself. Existing trace binding, structured response-family validation, machine-authority validation, reservation identity checks, confirmation continuity, and supplier-attempt reconciliation continue to govern downstream evidence.

## Validation

Focused tests cover:

- ordinary and maximum-length (512) references;
- exact canonical encoding;
- canonical encoded internal spaces and slashes that preserve the existing recovery contract;
- valid non-BMP Unicode;
- lone high and low surrogate rejection;
- leading/trailing ASCII and Unicode whitespace;
- ASCII control characters;
- malformed and non-canonical percent encodings;
- nested raw path segments; and
- references over 512 code units.

The route-level regression verifies invalid references are rejected before provider I/O and that valid Create, Sync, and bounded Retrieve shapes remain reachable. A dependency-free source contract pins both the recovery provider and the reservation transport to the same shared reference authority so the two boundaries cannot silently drift apart.

Full repository validation still requires the repository Node 24/TypeScript 6 environment. Live Travelport non-production verification remains required before reservation activation.

## References

- `docs/travelport-reservation-unicode-authority.md`
- `docs/travelport-reservation-response-trace-authority.md`
- `docs/supplier-reservation-correlation.md`
- `docs/travelport-known-locator-reservation-type.md`
- Travelport Retrieve Hotel Reservation API: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Retrieve.htm
