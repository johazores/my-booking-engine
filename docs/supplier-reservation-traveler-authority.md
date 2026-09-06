# Supplier Reservation Traveler Authority

SF now has a server-only traveler authority boundary for the future external supplier Create Reservation path. This does not expose a reservation action and does not enable the Travelport `reservation` capability.

## Why this boundary exists

A supplier reservation request already stores a `reservationPayloadFingerprint`, but the commercial write must not accept arbitrary traveler details later and assume they are the same details that were reviewed when the request was prepared.

`prepareHospitalitySupplierReservationWithTravelerAuthority` is the production preparation wrapper. It normalizes the primary traveler, computes the deterministic `reservationPayloadFingerprint` itself, and delegates only that fingerprint to the existing tenant-scoped reservation operation ledger. Production supplier modules are source-guarded from bypassing this wrapper and supplying their own traveler payload fingerprint.

The supplier operation must not persist the raw primary traveler in `HospitalitySupplierReservationOperation`, supplier attempt history, audit JSON, or provider-request logs.

## Canonical primary traveler

The current planned supplier write is deliberately single-room. The authority shape therefore binds exactly one primary traveler with:

- first name;
- last name;
- canonical lowercase email;
- telephone country calling code;
- telephone area code; and
- telephone subscriber number.

Names are whitespace-normalized and bounded to the existing 80-character booking-guest limit. That is the provider-neutral authority limit, not permission to exceed a provider-specific limit. Email is bounded to 320 characters and validated before fingerprinting. Telephone components are bounded decimal strings so later provider mapping cannot reinterpret punctuation or formatting differently.

The fingerprint uses a versioned canonical field order and SHA-256. It is identity/retry evidence, not a replacement for the traveler record and not authorization to change traveler details.

## Submission re-binding

`reviewAndClaimHospitalitySupplierReservationSubmission` requires the primary traveler again. After server-side organization permission checks and the tenant-scoped operation read, it:

1. verifies the operation is still submittable;
2. rejects anything except the currently supported one-room submission shape;
3. canonicalizes the supplied primary traveler;
4. recomputes its payload fingerprint and requires an exact match with the durable `reservationPayloadFingerprint`;
5. loads the exact Travelport integration/credential version and repeats fresh provider authority;
6. maps the fresh offer, traveler, and payment instruction into provider-specific non-secret Create Reservation request material; and
7. only then may claim the external write.

A changed name, email, or telephone therefore fails before provider I/O and before a create attempt is claimed. The normalized traveler and Travelport request material returned by the server-only gate are ephemeral inputs for the future provider executor. They must not be logged, copied into audit JSON, or persisted in the supplier operation ledger.

## Travelport mapping boundary

Travelport v11 Create Reservation requires traveler identity and telephone data, and Booking.com requires traveler email. The provider-specific mapper now emits the exact non-secret `Traveler` shape, translating SF telephone authority into Travelport `countryAccessCode`, `areaCityCode`, and `phoneNumber` fields.

Travelport+ documents a 22-character combined limit for `Given` plus `Surname` and says longer names are truncated in the response. SF must not let provider truncation silently change the traveler identity bound into the durable request fingerprint. The mapper therefore fails closed when the combined canonical first and last name exceeds 22 characters. It does not truncate the name. The user must review a provider-compatible traveler name and prepare a new authorized request.

The same mapper carries the freshly selected Availability `CatalogOfferingIdentifier` and exact non-secret `Payment` amount/indicators. It deliberately does **not** construct `FormOfPayment`, `PaymentCard`, card number, CVV/security code, cardholder, or billing-card data. Those fields remain behind the unresolved PCI-safe form-of-payment boundary.

The current boundary also does not add loyalty identifiers. Rates requiring a loyalty ID at reservation continue to fail closed in the existing create-readiness gate.

## Remaining create blockers

Travelport `reservation` capability remains disabled. Traveler authority and provider-specific non-secret request mapping remove create-coordinator dependencies, but a production write still requires:

- a reviewed PCI-safe form-of-payment and guarantee strategy for the provisioned Travelport account;
- the actual Travelport single-room Create Reservation executor/coordinator that can obtain form-of-payment authority without persisting or logging card secrets;
- the existing explicit price/guarantee change decision flow;
- durable provider-request marking, outcome settlement, ambiguity recovery, and Booking.com Sync handling; and
- live non-production verification against provisioned Travelport credentials.

No PAN, CVV/security code, payment-card plaintext, provider access token, or integration credential belongs in traveler authority or the non-secret request material.

## Provider reference

Travelport Hotel v11 Create Reservation documents `Traveler`, `Telephone`, the 22-character combined `Given`/`Surname` limit, Booking.com email requirements, `CatalogOfferingIdentifier`, and payment indicators:

- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm
