# Travelport Stays create-outcome classification

## Purpose

A supplier reservation POST is a commercial write. Once SF crosses that provider boundary, an HTTP or payload failure is not automatically evidence that no hotel was sold. The Travelport create-outcome classifier therefore converts only documented provider evidence into safe decisions and otherwise fails closed to an ambiguous reservation outcome.

This module does not collect card data, enable the `reservation` capability, or expose a booking action. It is the provider-specific post-write decision boundary consumed by the server-only Travelport create coordinator.

## Documented decisions

Travelport Stays source codes `13016`, `13017`, and `13018` mean the guarantee requirement changed during sell. Source code `13020` means the price changed during sell. Travelport documents that these cases stop the initial booking before a reservation is created and require a second reservation request only if the applicable change is explicitly accepted. SF classifies these responses as `REVIEW_REQUIRED`, including a combined price-and-guarantee review when both documented change codes are returned. It never sends `acceptGuaranteeChangeInd` or `acceptPriceChangeInd` automatically.

Source code `13034` is materially different. Travelport documents the same error for a Booking.com supplier-confirmation problem where the final sell state cannot be proven from the error alone. SF therefore keeps `13034` at `AMBIGUOUS / TRAVELPORT_SYNC_REQUIRED`; it never invents a supplier confirmation or retry authority from that error response.

Travelport also documents a Booking.com failure mode in which the supplier sell succeeded but Travelport failed to finish PNR processing. In that exact warning path, SF retains Sync authority only when the returned hospitality segment exactly matches the durable property, stay, room count, and guest count, there is one supplier confirmation, there is no Travelport locator, the supplier source is `BO`, and the matching offer has a bounded identifier authority. The reservation remains ambiguous until Sync returns the verified Travelport locator.

## Definitive no-sell validation failures

Travelport's current Stays error contract distinguishes unsuccessful `Result/Error` responses and, in the newer error format, includes `SourceCode` plus `category`. SF now uses that evidence narrowly to avoid turning every provider-side validation rejection into permanent ambiguity.

A provider error becomes a durable `FAILED` result only when all of the following are true:

- the error envelope is structurally valid and bounded;
- every returned error has `category=VALIDATION`;
- every returned source code is in SF's reviewed Stays no-sell validation allowlist; and
- there is exactly one unique source code in the response.

The normalized durable code is `TRAVELPORT_VALIDATION_<SourceCode>`. Provider message text is ignored and never persisted or logged.

The allowlist is intentionally conservative and covers request/offer/traveler/payment/date/property/card/occupancy validation cases whose documented semantics reject the sell rather than leave supplier state unknown. Unknown codes, mixed codes, missing categories, `UNKNOWN`/`RETRY` categories, malformed structures, and unsupported combinations remain `AMBIGUOUS / INVALID_RESPONSE`.

Automatic retry on the existing operation is narrower than the no-sell allowlist. It is limited to reviewed failures that can be corrected entirely in the server-only ephemeral form-of-payment input without changing the durable reservation or traveler authority:

- payment card code, expiry, holder name, number, CVV, and card type: `1537`-`1542`;
- payment-card billing address street/city/country/postal/state validation: `1543`-`1547` plus supplier-required billing address code `13050`;
- form-of-payment telephone required/invalid validation: `13054` and `13083`; and
- supplier card-type rejection `13078`.

Travelport documents these as `VALIDATION` failures. A corrected ephemeral form of payment may therefore repeat the complete fresh-authority gate, but only after the classifier receives a structurally valid single-code `VALIDATION` response proving the previous sell was rejected. The retry does not reuse old offer/Rules/Availability authority.

Traveler identity and contact validation remain different because the traveler is bound into the durable `reservationPayloadFingerprint`. Codes such as `1533`, `1534`, `1549`, and `1550` are not promoted to payment-correction retry authority. Changing those inputs requires a newly reviewed reservation request rather than mutating the existing operation. All other definitive validation failures are likewise non-retryable for the existing operation unless a future reviewed policy proves a safe correction boundary.

This does not weaken the commercial-write safety rule: retryability is granted only from explicit provider no-sell validation evidence, never from transport failure, generic HTTP status, provider free text, unknown categories, or uncertain supplier responses.

## Structural response authority

Provider response structure is part of the proof required to call a commercial write successful. The classifier distinguishes absence of an `ErrorResponse` from a malformed error envelope. Once an error envelope is present it cannot be masked by confirmation-looking response data.

Documented price/guarantee source codes retain review semantics. `13034` retains the stronger Sync-required ambiguity semantics. Reviewed definitive validation errors can become `FAILED`. Everything else fails closed to ambiguity.

Reservation warning evidence is also bounded. Malformed or oversized warning collections, conflicting `Warning`/`Warnings` shapes, and warning records without a bounded message cannot be silently ignored before confirmation. Bounded non-Sync warnings do not erase otherwise complete confirmation evidence, but malformed warning structure prevents promotion to `CONFIRMED`.

The durable reservation expectation is validated before it can match provider data. The current create classifier recognizes only the supported single-room, one-to-nine-guest contract with canonical local dates and bounded Travelport chain/property identifiers. Sync recovery authority is extracted from the same unique matching offer rather than unrelated response data.

## Durable recovery staging

The Travelport classifier does not write the database. The create coordinator stages complete Sync recovery evidence through `recordHospitalitySupplierReservationProviderRecoveryEvidence` only after the durable provider-request marker exists and before final create settlement.

That staging transaction independently requires server-side `booking:manage`, tenant/resource scope, the current `CREATE` attempt, and a non-null provider-request marker. It atomically stores the supplier confirmation plus the opaque provider recovery reference while the operation is still `SUBMITTING`. If the process crashes before final settlement, stale-attempt recovery moves the marked attempt to ambiguity without losing the staged recovery evidence, so another Create Reservation attempt stays blocked.

The opaque recovery reference contains only Travelport-owned non-secret authority needed by the provider adapter. Core supplier booking logic does not parse it, and audit metadata records only that recovery evidence was staged, never the confirmation or recovery value itself.

## Durable review-required state

Price and guarantee change responses are now persisted as a dedicated `REVIEW_REQUIRED` operation and attempt state rather than being collapsed into generic `FAILED`. The transition is allowed only for the three fixed normalized review reasons and only when the current tenant-scoped `CREATE` attempt has a durable `providerRequestStartedAt` marker. The transition clears provider/supplier recovery locators, keeps retryability `NULL`, and emits a bounded `supplier.reservation-review-required` audit event.

`assertHospitalitySupplierReservationCanSubmit` rejects `REVIEW_REQUIRED`. This is intentional: normal retry logic, including the safe ephemeral payment-correction retry path, cannot turn a commercial review into a second sell. A future acceptance path must separately re-review current offer, Rules, Availability, traveler, and payment authority; bind the exact accepted commercial change to a durable actor decision; and only then add the applicable Travelport acceptance query parameter for that one provider write.

## Durable ledger normalization

`travelportStaysCreateOutcomeToSubmissionOutcome` remains the provider-specific bridge for confirmed, ambiguous, and ordinary failed outcomes. Price/guarantee review outcomes are deliberately rejected by that generic mapper and are routed by the Create coordinator into the dedicated review settlement path.

The dedicated review state is not retry authority. Travelport states that a price or guarantee difference stops the initial sell and that a second request may proceed only after explicit acceptance. SF does not yet implement that acceptance workflow, and neither `acceptPriceChangeInd` nor `acceptGuaranteeChangeInd` is sent by the initial create executor.

## Privacy and observability

The classifier returns only normalized decision state, bounded locator/correlation evidence, fixed SF failure/review codes, and the small non-secret Sync recovery reference when the Booking.com recovery preconditions are proven. It does not return or log provider error messages, traveler data, form-of-payment data, PAN/CVV, credentials, request bodies, or response bodies.

The create provider observation records only `confirmed`, `failed`, `review-required`, or `ambiguous` plus safe tenant/attempt correlation and duration. It does not emit the Travelport source code or any raw provider payload.

Supplier confirmation evidence by itself never means the Travelport reservation is fully confirmed. The provider PNR locator remains required for the normal lifecycle. Booking.com Sync is a separate provider write with its own durable marker, traveler binding, and ambiguity semantics.

## References

- Travelport Stays API Error Messaging: `Result/Error`, error categories, request validation source codes, price/guarantee changes, and `13034`.
- Travelport TripServices Stays APIs Guide: price/guarantee change behavior.
- Travelport Create Reservation Reference Payload API Reference.
- Travelport Sync Reservation API Reference.

## Remaining boundary

The Travelport reservation capability stays disabled. The single-room Create executor/coordinator and Booking.com Sync executor/coordinator exist, but activation still requires a reviewed PCI-safe form-of-payment source/handling strategy, live non-production SearchComplete → Rules → Availability → Create → Sync validation, a separately authorized price/guarantee-change acceptance path that consumes the durable `REVIEW_REQUIRED` state, and live validation of authoritative locator-less negative/correlation semantics.
