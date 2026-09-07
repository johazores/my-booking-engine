# Supplier Reservation Traveler Authority

SF has a server-only traveler authority boundary for external supplier reservation writes. It is used by the currently implemented but product-unreachable Travelport Create Reservation and Booking.com Sync coordinators. This does not expose a reservation action and does not enable the Travelport `reservation` capability.

## Why this boundary exists

A supplier reservation request stores a `reservationPayloadFingerprint`, but a commercial or recovery write must not accept arbitrary traveler details later and assume they are the same details that were reviewed when the request was prepared.

`prepareHospitalitySupplierReservationWithTravelerAuthority` is the production preparation wrapper. It normalizes the primary traveler, computes the deterministic `reservationPayloadFingerprint` itself, and delegates only that fingerprint to the tenant-scoped reservation operation ledger. Production supplier modules are source-guarded from bypassing this wrapper and supplying their own traveler payload fingerprint.

The supplier operation must not persist the raw primary traveler in `HospitalitySupplierReservationOperation`, supplier attempt history, audit JSON, or provider-request logs.

## Canonical primary traveler

The current supplier write contract is deliberately single-room. The authority shape therefore binds exactly one primary traveler with:

- first name;
- last name;
- canonical lowercase email;
- telephone country calling code;
- telephone area code; and
- telephone subscriber number.

Names are whitespace-normalized and bounded to the existing 80-character booking-guest limit. That is the provider-neutral authority limit, not permission to exceed a provider-specific limit. Email is bounded to 320 characters and validated before fingerprinting. Telephone components are bounded decimal strings so later provider mapping cannot reinterpret punctuation or formatting differently.

The fingerprint uses a versioned canonical field order and SHA-256. It is identity/retry evidence, not a replacement for the traveler record and not authorization to change traveler details.

## Create submission re-binding

`reviewAndClaimHospitalitySupplierReservationSubmission` requires the primary traveler again. After server-side organization permission checks and the tenant-scoped operation read, it:

1. verifies the operation is still submittable;
2. rejects anything except the currently supported one-room submission shape;
3. canonicalizes the supplied primary traveler;
4. recomputes its payload fingerprint and requires an exact match with the durable `reservationPayloadFingerprint`;
5. loads the exact Travelport integration/credential version and repeats fresh provider authority;
6. maps the fresh offer, traveler, and payment instruction into provider-specific non-secret Create Reservation request material; and
7. only then may claim the external write.

A changed name, email, or telephone therefore fails before provider I/O and before a create attempt is claimed. The normalized traveler and Travelport request material returned by the server-only gate are ephemeral inputs for the provider executor. They must not be logged, copied into audit JSON, or persisted in the supplier operation ledger.

## Travelport traveler mapping boundary

`buildTravelportStaysReservationTravelerRequest` is the shared provider-specific traveler mapper for both Create and Booking.com Sync. It emits the same non-secret `Traveler` shape from the canonical SF authority:

- `PersonName.Given` and `PersonName.Surname`;
- `Telephone` with `countryAccessCode`, `areaCityCode`, and `phoneNumber`; and
- `Email.value`.

Travelport documents a 22-character combined limit for `Given` plus `Surname` and says longer names are truncated in the response. SF must not let provider truncation silently change the traveler identity bound into the durable request fingerprint. The shared mapper therefore fails closed when the combined canonical first and last name exceeds 22 characters. It does not truncate the name. The user must review a provider-compatible traveler name and prepare a new authorized request.

The Create request mapper separately carries the freshly selected Availability `CatalogOfferingIdentifier` and exact non-secret `Payment` amount/indicators. It deliberately does **not** construct `FormOfPayment`, `PaymentCard`, card number, CVV/security code, cardholder, or billing-card data. Those fields remain behind the PCI-safe form-of-payment boundary.

The Booking.com Sync request reuses only the durable recovery authority, original supplier confirmation, and the same traveler identity/contact mapping. It contains no form-of-payment or card material.

The current boundary also does not add loyalty identifiers. Rates requiring a loyalty ID at reservation continue to fail closed in the create-readiness gate.

## Recovery-write re-binding

`syncTravelportStaysBookingDotComReservation` normalizes the traveler supplied for recovery and recomputes the same durable traveler payload fingerprint before a `RECOVERY_WRITE` claim. Changed traveler/contact data therefore cannot recover a different reservation.

After the tenant-scoped claim, the Travelport Sync request uses the shared traveler mapper again before the durable provider-request marker. Any provider-specific traveler mapping failure is therefore deterministic pre-provider failure; once the marker exists, uncertainty remains ambiguous and cannot authorize an automatic repeated Sync.

## Remaining activation blockers

Travelport `reservation` capability remains disabled even though server-only Create and Sync execution now exist. Production activation still requires:

- a reviewed PCI-safe form-of-payment and guarantee source for the provisioned Travelport Create path;
- live non-production SearchComplete → Rules → Availability → Create → Sync verification;
- explicit authorized price/guarantee-change acceptance behavior;
- authoritative validation of `13034`, locator-less negative/correlation, and recovery retry semantics; and
- complete product/API states only after the provider capability is enabled.

No PAN, CVV/security code, payment-card plaintext, provider access token, or integration credential belongs in traveler authority or the non-secret traveler request material.

## Provider references

Travelport Hotel v11 Create Reservation and Sync Reservation document `Traveler`, `PersonName`, `Telephone`, the 22-character combined `Given`/`Surname` limit, and Booking.com email requirements:

- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Sync.htm
