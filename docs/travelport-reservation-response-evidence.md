# Travelport reservation response evidence

## Purpose

SF has provider-specific response boundaries for durable Travelport Stays reservation evidence. Known-locator Hotel Retrieve uses `parseTravelportStaysReservationResponse`; Create Reservation uses the stricter commercial-write classifier in `travelport-stays-reservation-create-outcome.ts`, which also validates the returned property/stay/occupancy identity and write-specific error/warning semantics.

These boundaries do not expose a browser route, staff/customer reserve action, cancellation action, or public supplier-write API. Travelport `reservation` remains disabled until the outstanding payment, live-provider, explicit-change-acceptance, and Sync execution gates are complete.

## Normalized Retrieve evidence

`parseTravelportStaysReservationResponse` accepts an untrusted Travelport response body and returns only the single Travelport aggregator locator, at most one supplier confirmation reference for the current single-room contract, and a bounded correlation/trace identifier. Traveler data, contact details, form-of-payment fields, card data, payment payloads, comments, offer bodies, and raw provider payloads are discarded.

The parser requires exactly one unique Travelport aggregator locator. A supplier confirmation reference is accepted only from a locator with both `sourceContext=Supplier` and `locatorType=Confirmation Number`. Multiple distinct Travelport locators or multiple distinct supplier `Confirmation Number` locators fail closed as `INVALID_RESPONSE`. Locator and correlation strings are bounded and must not contain line breaks.

Travelport can return other supplier-owned locator types with different lifecycle meaning. Booking.com examples include a separate `Pin code`, while a canceled reservation changes the supplier locator to `locatorType=Cancellation Number`. Those values are deliberately excluded from `supplierConfirmationReference`; they are neither treated as ambiguity nor persisted under the wrong semantic field.

## Retrieve versus create semantics

Known-locator Hotel Retrieve supplies `expectedProviderReservationReference`, so the response locator must exactly equal the requested locator. Retrieve does not require the current receipt to be `Confirmed`; a cancelled or otherwise historical provider record is still proof that the locator exists and must never be misclassified as safe-to-retry non-existence.

A cancelled retrieve may therefore return `FOUND` while `supplierConfirmationReference` is null when Travelport exposes only a supplier `Cancellation Number`. The durable Travelport aggregator locator still proves the reservation record exists, but SF does not relabel cancellation evidence as the original supplier confirmation number.

Create Reservation no longer relies on this generic Retrieve parser for success classification. The commercial-write classifier independently requires a successful HTTP result, exactly one durable reservation match for the expected Travelport property/stay/occupancy, exactly one confirmed Travelport locator, bounded structural warning/error evidence, and confirmed supplier receipt state when a supplier confirmation is accepted. Documented price/guarantee changes become explicit review-required outcomes; Booking.com Sync-required conditions and unknown/malformed post-write outcomes remain ambiguous rather than becoming successful or retry-safe.

## Durable ledger evidence

The supplier reservation ledger persists an optional supplier confirmation reference as tenant-scoped, bounded lifecycle/recovery evidence. A confirmed create or successful `FOUND` reconciliation can store it, and an ambiguous supplier confirmation can also be retained when the provider-specific create classifier has verified it against the durable property/stay/occupancy request but no Travelport PNR was established. The value follows the same 512-character single-line operational-reference contract as the provider locator and is not written to audit payloads or structured logs.

Normally supplier confirmation exists while the operation is `AMBIGUOUS`, `RECONCILING`, or `CONFIRMED`. There is one intentionally narrow transient exception: after a marked commercial Create response proves complete Booking.com Sync recovery authority, SF may stage the supplier confirmation while the operation is still `SUBMITTING`, but only when a bounded `providerRecoveryReference` is stored in the same transaction. Database constraints prevent a standalone `SUBMITTING` supplier confirmation. This staging exists solely so a process crash before final settlement cannot discard the evidence required to recover the already-sold supplier reservation.

The presence of supplier confirmation or provider recovery authority does not prove a Travelport PNR exists, does not promote an ambiguous write to confirmed, and does not authorize another Create Reservation attempt. This distinction is required for Travelport's documented Booking.com sell-confirmed/PNR-processing-failed scenario, where the supplier booking can exist before Travelport has a locator.

An ambiguous create may retain a known Travelport aggregator locator, a verified supplier confirmation, both, or neither depending on the provider evidence actually returned. A known Travelport locator is the authority used by the existing Hotel Retrieve reconciliation path. Locator-less ambiguity remains `AMBIGUOUS` and cannot enter automatic Hotel Retrieve reconciliation merely because a supplier confirmation exists.

Known-locator reconciliation identity-binds both possible provider-truth outcomes to that durable locator. `FOUND` must return the exact locator before the operation can become `CONFIRMED`. If that Retrieve response omits a supplier confirmation, existing verified supplier-confirmation evidence is preserved rather than erased. `NOT_FOUND` must also identify the exact locator that was queried before SF can clear provider and supplier recovery evidence and return the operation to `PREPARED`. The coordinator verifies provider output before settlement, and the ledger settlement boundary independently requires and rechecks the locator for both outcomes so direct server callers cannot bypass that invariant. Any provider-returned locator mismatch is normalized to `UNKNOWN` / `INVALID_RESPONSE`; a direct mismatched settlement is rejected transactionally. A transient provider failure likewise maps to `UNKNOWN` and preserves existing recovery evidence.

## Booking.com Sync recovery authority

For the documented supplier-confirmed/no-PNR warning path, the Create classifier can now retain the non-secret Travelport authority required for a future Sync attempt. It does so only when the same response proves the exact durable reservation match, exactly one confirmed supplier confirmation, no Travelport locator, Booking.com supplier source `BO`, and a bounded matching-offer `Identifier.authority` from Travelport. The adapter converts only that provider-owned authority into a versioned opaque `providerRecoveryReference`; traveler, payment, credential, request-body, and response-body data are not stored in it.

The separate `13034` timeout remains `AMBIGUOUS / TRAVELPORT_SYNC_REQUIRED` but does not invent a supplier confirmation or Sync authority. Travelport documents that this timeout can represent either no Booking.com sell or a completed Booking.com sell, so the error response alone is insufficient to authorize an automatic Sync or a retry.

The Create coordinator stages complete Sync recovery evidence only after the durable provider-request marker exists and before final settlement. The staging transaction rechecks `booking:manage`, tenant ownership, the current `CREATE` attempt, and the provider-request marker. An exact replay is idempotent; conflicting evidence fails closed. Audit metadata records only that recovery evidence was staged, not the raw supplier confirmation or provider recovery reference.

Sync itself remains unimplemented. A future Sync coordinator must separately re-bind authorized traveler/contact data to the reservation payload fingerprint, create its own durable external-write attempt and provider-request marker, send only the validated Booking.com confirmation/provider authority, and verify the Sync response against the durable property/stay/occupancy plus exactly one Travelport locator before confirmation. It must not re-sell the hotel segment.

The detailed persistence contract is documented in `docs/travelport-booking-sync-recovery-authority.md`.

## Cancellation boundary

The supplier confirmation reference is durable evidence for future lifecycle work, but cancellation is still not implemented or advertised. Any cancellation capability must separately validate Travelport cancellation semantics, authorization, idempotency, external-write recovery, and live non-production behavior.

## Validation

Dependency-free and focused tests cover confirmed response evidence, known-locator matching, supplier locator-type semantics, non-confirmed rejection, locator/reference cardinality, unsafe provider strings, privacy minimization, coordinator exact-locator gating, ledger-level `FOUND`/`NOT_FOUND` identity enforcement, ambiguous supplier-confirmation persistence, Booking.com Sync recovery-reference normalization, complete-versus-incomplete Sync authority classification, post-marker recovery-evidence staging order, tenant/authorization checks, and audit privacy.

A guarded PostgreSQL scenario covers locator-less denial, known-locator `FOUND`, supplier confirmation durability, transient recovery retry, authoritative provider-neutral `NOT_FOUND` clearing, direct mismatched settlement rejection, mismatched provider `FOUND`/`NOT_FOUND` results remaining ambiguous, and cross-tenant provider-I/O suppression when a disposable database target is available. The new Sync recovery-authority migration has source-level contract coverage but still requires execution against an explicitly disposable PostgreSQL target before database validation can be claimed.

Live Create Reservation and Sync validation remain blocked on provisioned Travelport non-production credentials and a reviewed PCI-safe form-of-payment/guarantee strategy. No source-only test is claimed as live-provider evidence.

## References

- Travelport Stays APIs Guide — confirmations, locator codes, price/guarantee changes, and Sync after aggregator sell failure: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/Guides/HotelAPIsGuide.htm
- Travelport Sync Reservation API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Sync.htm
- Travelport Add Hotel Reservation reference payload — Booking.com confirmation number and PIN example: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_AddReservationRefPayload.htm
- Travelport Cancel Hotel Reservation — supplier cancellation-number semantics: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Cancel.htm
- Travelport Create Reservation reference payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm
- Travelport Retrieve Hotel Reservation: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Retrieve.htm
