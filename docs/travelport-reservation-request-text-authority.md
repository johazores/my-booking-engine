# Travelport Reservation Request Text Authority

## Purpose

Travelport reservation writes accept a small amount of provider-bound traveler, supplier-reference, Sync, and form-of-payment text. Those values become authoritative request material and must not carry transport/control characters or ill-formed Unicode that downstream systems could interpret, replace, or serialize differently.

This boundary strengthens the existing server-only Travelport Create and Booking.com Sync infrastructure. It does not enable the Travelport `reservation` capability, expose a booking action, or provide a production PCI card source.

## Unicode scalar-value authority

JavaScript strings can contain lone UTF-16 surrogate code units even when `JSON.stringify` succeeds. Those strings are not well-formed Unicode scalar-value sequences. Serializing them can preserve an escaped surrogate in JSON, while URL or downstream provider processing may reject, replace, or reinterpret the same value.

Provider-bound reservation request authority therefore uses `String.prototype.isWellFormed()` before durable provider-write marking. Ill-formed Unicode now fails closed in:

- primary traveler first name, surname, and email authority;
- Travelport Create provider submission references;
- Travelport Create cardholder and optional billing text through the shared bounded single-line mapper;
- Booking.com Sync supplier confirmation references; and
- durable Booking.com Sync offer-authority recovery references, both when created and when parsed.

Valid well-formed non-BMP text remains valid where the existing field grammar already permits it. This change does not invent a narrower supplier alphabet or normalize provider machine identifiers into a different value.

## Traveler contact authority

The provider-neutral primary-traveler authority rejects the full ASCII control range `U+0000` through `U+001F` plus `U+007F` in traveler text and requires names and email to be well-formed Unicode before the canonical traveler is fingerprinted.

Telephone components remain decimal-only. Email continues to use the existing product normalization contract: surrounding whitespace is removed and casing is canonicalized before validation and fingerprinting. Control-bearing or ill-formed email cannot therefore become durable `reservationPayloadFingerprint` authority or reach either Travelport Create or Booking.com Sync request mapping.

## Sensitive Create text authority

The ephemeral Travelport form-of-payment mapper applies the same full ASCII-control and well-formed-Unicode rejection to every bounded single-line value before request serialization. This includes:

- cardholder name;
- billing address line;
- billing city;
- optional billing state/province;
- billing country code;
- billing postal code;
- optional payment telephone components; and
- the server-only Create token-cache key that shares the same exact single-line validator.

Existing provider-specific shape checks remain in force after this boundary. PAN and security code stay numeric-only; card code must match freshly accepted supplier payment authority; country code remains uppercase two-letter authority; telephone fields retain their current provider-compatible character constraints; and the card must remain valid through the stay.

The mapper does not trim an otherwise invalid single-line value into something different. Leading/trailing whitespace continues to fail closed. Internal ASCII controls such as tab, NUL, unit separator, and DEL, plus lone high or low UTF-16 surrogates, fail closed before the sensitive body can reach the provider transport.

## Create and Sync machine text

Create request material independently rejects ill-formed supplier submission references before they can become `CatalogOfferingIdentifier` authority. Booking.com Sync independently rejects ill-formed supplier confirmation references and its durable offer-authority recovery token before either value can enter the Sync request body.

These guards complement the existing reservation response and known-locator Unicode authority. Provider response evidence, durable recovery identifiers, and outbound request authority now apply the same fail-closed rule rather than relying on JSON escaping or runtime replacement behavior.

## Failure ordering and privacy

These checks happen while deterministic request material is being normalized or built and before `beforeProviderRequest` records the durable provider-write boundary. Invalid text therefore cannot create ambiguous Travelport write authority.

No new traveler or card fields are persisted or logged. PAN, CVV/security code, cardholder data, billing address, and payment telephone remain ephemeral inside the server adapter boundary. The concrete production card source is still intentionally absent pending a separate PCI review.

## Validation

Focused regression coverage proves that:

- NUL, unit separator, and DEL cannot enter canonical traveler email authority;
- NUL, tab, unit separator, and DEL cannot enter provider-bound cardholder/billing text;
- lone high and low UTF-16 surrogates cannot enter traveler identity/contact, Create supplier references, cardholder/billing text, Sync supplier confirmations, or Sync recovery offer authority;
- a valid surrogate pair remains usable where the existing traveler grammar permits the resulting non-BMP character;
- `JSON.stringify` accepting an ill-formed JavaScript string is not treated as request validity;
- valid existing traveler canonicalization and payment-card request mapping remain unchanged; and
- source-level contracts keep the guards and focused tests in the default repository test surface.

Full repository validation still requires the repository-supported Node 24.20+ / TypeScript 6 toolchain. Live Create/Sync validation still requires provisioned Travelport non-production credentials and the separately reviewed payment source.

## Activation boundary

Travelport `reservation` remains deliberately disabled. Activation still requires the concrete PCI-safe FormOfPayment/guarantee source, live SearchComplete → Rules → Availability → Create → reviewed Create → Sync/recovery verification, and authoritative live `13034` / locator-less correlation and retry behavior.

## Related authority

- `docs/travelport-reservation-unicode-authority.md`
- `docs/travelport-reservation-reference-route-authority.md`
- `docs/travelport-reservation-payment-card-boundary.md`
- `docs/supplier-reservation-traveler-authority.md`
