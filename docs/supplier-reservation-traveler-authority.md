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

Names are whitespace-normalized and bounded to the existing 80-character booking-guest limit. Email is bounded to 320 characters and validated before fingerprinting. Telephone components are bounded decimal strings so later provider mapping cannot reinterpret punctuation or formatting differently.

The fingerprint uses a versioned canonical field order and SHA-256. It is identity/retry evidence, not a replacement for the traveler record and not authorization to change traveler details.

## Submission re-binding

`reviewAndClaimHospitalitySupplierReservationSubmission` now requires the primary traveler again. After server-side organization permission checks and the tenant-scoped operation read, it:

1. verifies the operation is still submittable;
2. rejects anything except the currently supported one-room submission shape;
3. canonicalizes the supplied primary traveler;
4. recomputes its payload fingerprint and requires an exact match with the durable `reservationPayloadFingerprint`;
5. only then loads the Travelport integration, repeats fresh provider authority, and may claim the external write.

A changed name, email, or telephone therefore fails before provider I/O and before a create attempt is claimed. The normalized traveler returned by the server-only gate is ephemeral input for the future provider adapter. It must not be logged, copied into audit JSON, or persisted in the supplier operation ledger.

## Travelport mapping boundary

Travelport v11 Create Reservation requires traveler identity and telephone data, and Booking.com requires traveler email. Travelport also applies provider-specific payload constraints, including its own PersonName and telephone field rules.

Those provider-specific rules remain the responsibility of the Travelport adapter. The provider-neutral traveler authority does not construct a Travelport request and does not contain a form of payment.

The current boundary also does not add loyalty identifiers. Rates requiring a loyalty ID at reservation continue to fail closed in the existing create-readiness gate.

## Remaining create blockers

Travelport `reservation` capability remains disabled. Traveler authority removes one dependency from the create coordinator, but a production write still requires:

- a reviewed PCI-safe form-of-payment and guarantee strategy for the provisioned Travelport account;
- the actual Travelport single-room Create Reservation adapter/coordinator;
- provider-specific validation and mapping of the authorized traveler into the v11 payload;
- the existing explicit price/guarantee change decision flow;
- durable provider-request marking, outcome settlement, ambiguity recovery, and Booking.com Sync handling; and
- live non-production verification against provisioned Travelport credentials.

No PAN, CVV/security code, payment-card plaintext, provider access token, or integration credential belongs in this traveler authority.

## Provider reference

Travelport Hotel v11 Create Reservation documents `Traveler` and `Telephone` in the Build request and states that Booking.com requires traveler email:

- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm
