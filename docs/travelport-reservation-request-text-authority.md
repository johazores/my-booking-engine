# Travelport Reservation Request Text Authority

## Purpose

Travelport reservation writes accept a small amount of provider-bound traveler and form-of-payment text. Those values are not opaque provider identifiers, but they still become authoritative request material and must not carry transport/control characters that can be interpreted differently by downstream systems.

This boundary strengthens the existing server-only Travelport Create and Booking.com Sync infrastructure. It does not enable the Travelport `reservation` capability, expose a booking action, or provide a production PCI card source.

## Traveler contact authority

The provider-neutral primary-traveler authority now rejects the full ASCII control range `U+0000` through `U+001F` plus `U+007F` in email before the canonical traveler is fingerprinted.

Names already reject the same control range and telephone components are decimal-only. Email continues to use the existing product normalization contract: surrounding whitespace is removed and casing is canonicalized before validation and fingerprinting. Control-bearing email cannot therefore become durable `reservationPayloadFingerprint` authority or reach either Travelport Create or Booking.com Sync request mapping.

## Sensitive Create text authority

The ephemeral Travelport form-of-payment mapper applies the same full ASCII-control rejection to every bounded single-line value before request serialization. This includes:

- cardholder name;
- billing address line;
- billing city;
- optional billing state/province;
- billing country code;
- billing postal code;
- optional payment telephone components; and
- the server-only Create token-cache key that shares the same exact single-line validator.

Existing provider-specific shape checks remain in force after this boundary. PAN and security code stay numeric-only; card code must match freshly accepted supplier payment authority; country code remains uppercase two-letter authority; telephone fields retain their current provider-compatible character constraints; and the card must remain valid through the stay.

The mapper does not trim an otherwise invalid single-line value into something different. Leading/trailing whitespace continues to fail closed for this sensitive provider request material. Internal ASCII controls such as tab, NUL, unit separator, and DEL now fail closed as well.

## Failure ordering and privacy

These checks happen while deterministic request material is being built and before `beforeProviderRequest` records the durable provider-write boundary. Invalid text therefore cannot create ambiguous Travelport write authority.

No new traveler or card fields are persisted or logged. PAN, CVV/security code, cardholder data, billing address, and payment telephone remain ephemeral inside the server adapter boundary. The concrete production card source is still intentionally absent pending a separate PCI review.

## Validation

Focused regression coverage proves that:

- NUL, unit separator, and DEL cannot enter canonical traveler email authority;
- NUL, tab, unit separator, and DEL cannot enter provider-bound cardholder/billing text;
- valid existing traveler canonicalization and payment-card request mapping remain unchanged; and
- source-level contracts keep both guards and their focused tests in the default repository test surface.

Full repository validation still requires the repository-supported Node 24.20+ / TypeScript 6 toolchain. Live Create/Sync validation still requires provisioned Travelport non-production credentials and the separately reviewed payment source.

## Activation boundary

Travelport `reservation` remains deliberately disabled. Activation still requires the concrete PCI-safe FormOfPayment/guarantee source, live SearchComplete → Rules → Availability → Create → reviewed Create → Sync/recovery verification, and authoritative live `13034` / locator-less correlation and retry behavior.
