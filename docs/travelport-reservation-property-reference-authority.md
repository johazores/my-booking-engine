# Travelport reservation property-reference authority

## Purpose

SF carries a Travelport hotel property selection from provider search/pricing into reservation Create, reviewed Create, Booking.com Sync, and known-locator recovery as an opaque base64url supplier property reference. That reference is machine evidence. These flows can submit or settle commercial reservation state, so SF must not turn a differently encoded or whitespace-confusable reference into the same property identity.

This contract hardens the existing disabled Travelport reservation path. It does not enable the `reservation` capability or relax any activation gate.

## Canonical reference boundary

`decodeTravelportStaysPropertyReference` now accepts only a bounded, exact base64url token. The input must:

- be non-empty and no longer than the existing 4,096-character bound;
- contain no leading or trailing whitespace;
- contain no ASCII controls from `U+0000` through `U+001F` or `U+007F`;
- contain only the base64url alphabet already used by SF; and
- round-trip through Node base64url decoding and encoding without changing bytes or spelling.

The round-trip check rejects non-canonical base64url aliases that can decode to the same bytes because of unused terminal bits. This prevents two textual supplier references from collapsing onto the same decoded reservation identity.

## Decoded property identity

The decoded object still requires exact `authority = TVPT`, an alphanumeric chain code of one to sixteen characters, and an alphanumeric property code of one to thirty-two characters.

Chain and property codes are no longer trimmed. Values such as `" HI"`, `"HI\t"`, or `"ABC12 "` fail closed rather than becoming `HI` or `ABC12` after decoding. The resulting chain/property identity is used unchanged by the shared reservation expectation consumed by initial Create, reviewed Create, Booking.com Sync, and known-locator recovery.

This is identity validation, not tenant authorization. Tenant/integration ownership and the durable reservation operation remain enforced by the provider-neutral server-side reservation services before a commercial provider action or recovery read is attempted.

## Provider contract

Travelport documents Hotel `PropertyKey` as the chain/property identifier used to select a property, and the current SearchComplete contract returns `rateKey.value` as a unique identifier for the rate. SF therefore treats its stored supplier references and the provider identifiers they represent as machine values, not presentation text.

## Validation

Focused behavior coverage verifies:

- canonical SF property references continue to decode;
- padded and control-bearing outer references fail closed;
- padded/control-bearing decoded chain and property values fail closed;
- unsupported authority and malformed base64url still fail closed; and
- a deliberately constructed non-canonical base64url spelling that decodes to identical JSON bytes is rejected.

The dependency-free reservation machine-token contract also pins the full ASCII-control guard, exact-whitespace rule, canonical base64url round-trip, and removal of decoded chain/property trimming.

Full repository validation still requires the repository-supported Node 24 / TypeScript 6 dependency environment. Live provider verification still requires provisioned Travelport non-production credentials and the separately reviewed PCI-safe payment/guarantee source.

## Activation boundary

Travelport `reservation` remains deliberately unadvertised. The existing Phase 15 gates remain:

1. provision and review a concrete PCI-safe FormOfPayment/guarantee source;
2. complete live non-production SearchComplete → Rules → Availability → initial Create → reviewed second Create → Sync/recovery verification; and
3. establish authoritative live handling for `13034` and locator-less recovery semantics.

Related contracts:

- `docs/travelport-stays-integration.md`
- `docs/travelport-reservation-commercial-machine-token-authority.md`
- `docs/travelport-known-locator-machine-token-authority.md`
- `docs/travelport-reservation-response-evidence.md`
