# Travelport Booking.com Sync recovery authority

## Purpose

Travelport documents a Booking.com failure mode where the supplier sell succeeds but Travelport does not finish PNR processing. Retrying Create Reservation in that state can duplicate the hotel sell. SF therefore retains durable provider evidence and has a server-only Sync recovery-write path that can construct the missing Travelport aggregator segment without re-selling the Booking.com reservation.

The Sync path remains deliberately unreachable from product routes/actions and does not advertise the `reservation` capability. Live Travelport non-production validation is still required before activation.

## Provider evidence required

SF records Booking.com Sync recovery authority only from the documented supplier-confirmed/no-PNR warning response and only when all of the following are true:

- the returned hospitality product exactly matches the durable Travelport property, stay dates, single-room quantity, and guest count;
- there is exactly one confirmed supplier `Confirmation Number`;
- there is no confirmed Travelport/aggregator locator in the same response;
- the supplier locator source is exactly `BO`, which Travelport documents as Booking.com; and
- the matching offer has one bounded `Identifier.authority`, the value Travelport requires the Sync request to carry from the Availability offer.

The separate `13034` timeout error remains ambiguous but does **not** create this recovery authority. Travelport documents that `13034` can mean either no Booking.com sell or a completed Booking.com sell, and the error response alone does not provide enough proof to construct a safe Sync request.

## Durable representation

The Travelport adapter converts only the non-secret offer authority and verified Booking.com supplier source into a versioned opaque value such as `travelport-stays-sync-v1:BKNG:BO`. The provider-neutral ledger stores it as `providerRecoveryReference`; core booking logic does not parse Travelport fields.

The supplier confirmation remains in the existing `supplierConfirmationReference`. The recovery reference is bounded to 1024 characters, single-line, tenant-scoped, and database-constrained to exist only while the operation is `SUBMITTING` or `AMBIGUOUS`, with a supplier confirmation present.

No traveler name/email/telephone, PAN, CVV, cardholder data, payment data, credentials, token, provider request body, or response body is stored in this recovery reference or audit metadata.

## Crash-safe staging

The create coordinator stages the supplier confirmation and provider recovery reference only after the durable provider-request marker has been written and before final create settlement. The staging transaction requires `booking:manage`, organization/resource scope, the current `CREATE` attempt, and a non-null provider-request marker.

If the process crashes after recovery evidence is staged but before final settlement, stale-attempt recovery moves the marked create attempt to `AMBIGUOUS` without losing the evidence needed by Sync. The operation still cannot re-enter Create Reservation.

If staging fails or evidence is incomplete, SF does not invent or partially reconstruct Sync authority. The write remains fail-closed and ambiguous.

## Recovery-write claim

`claimHospitalitySupplierReservationRecoveryWrite` is provider-neutral persistence authority for an external recovery write. It requires `booking:manage`, tenant-scopes the operation and integration, and only accepts a locator-less `AMBIGUOUS` operation with both the verified supplier confirmation and provider recovery reference.

The caller must also present the exact durable `reservationPayloadFingerprint`. The Travelport coordinator derives that fingerprint from the normalized caller-supplied traveler, so changed traveler/contact data cannot be used to recover an old reservation.

A recovery write uses the existing `SUBMITTING` operation state but a distinct `RECOVERY_WRITE` attempt kind. This intentionally keeps the operation mutually exclusive with another create or known-locator reconciliation while preserving the provider-neutral meaning of `SUBMITTING` as an external supplier write in progress.

A prior `RECOVERY_WRITE` can be claimed again only when its attempt definitively failed before `providerRequestStartedAt` was recorded and the operation is explicitly marked retryable. Once a provider-request marker exists, an uncertain Sync is never automatically repeated.

## Travelport Sync request

`TravelportStaysReservationSyncExecutor` uses the fixed v11 `POST book/reservations/` endpoint. The request is constructed only from:

- the retained Availability offer `Identifier.authority`;
- `passiveOfferInd=true`;
- the verified Booking.com supplier confirmation with source `BO` and `sourceContext=Supplier`; and
- the complete already-authorized primary traveler identity/contact authority: `PersonName`, `Telephone`, and `Email`.

Travelport's current Sync reference describes Sync as a scaled-down retry and its example shows email only, but the same reference marks `Traveler`, `PersonName`, and `Telephone` as required objects and separately states that Booking.com requires traveler email. SF therefore fails closed to the normative required-field contract instead of depending on the abbreviated example.

Create and Sync share the same provider-specific traveler mapper. This keeps canonical first/last name, telephone components, and email identical across both write paths and enforces Travelport's documented 22-character combined `Given` + `Surname` limit before provider I/O. SF does not allow Travelport to silently truncate the traveler identity that is bound into the durable reservation payload fingerprint.

Sync still accepts no form-of-payment, PAN, CVV, cardholder, billing, credential, token, or arbitrary endpoint input.

OAuth and deterministic request construction complete before the durable provider-request marker. The attempt UUID is the provider correlation authority. Only after the marker succeeds may the Sync POST begin.

## Response and settlement authority

Travelport documents that Sync returns the same reservation response structure as Create Reservation. SF reuses the hardened Create response classifier for property/stay/occupancy and locator evidence, then applies stricter Sync settlement rules.

Sync is confirmed only when the response proves all of the following:

- exactly one expected Travelport reservation locator;
- the exact durable property, dates, room quantity, and guest count;
- the same original Booking.com supplier confirmation; and
- a structurally valid successful response.

A changed/missing supplier confirmation, mismatched reservation identity, malformed response, provider error, non-success response, or transport uncertainty after the marker remains `AMBIGUOUS / INVALID_RESPONSE`.

Successful Sync clears `providerRecoveryReference` and moves the operation to `CONFIRMED`. Ambiguous Sync retains the supplier confirmation and recovery reference as evidence but is not retryable. A deterministic pre-provider failure returns to `AMBIGUOUS` with the recovery evidence retained and may be retried only because the provider-request marker proves no Sync request was sent.

## Crash recovery

The shared supplier attempt lease recognizes `RECOVERY_WRITE` as a valid `SUBMITTING` attempt.

- If a stale recovery-write attempt has no provider-request marker, it returns to `AMBIGUOUS`, completes as `FAILED`, and is marked retryable.
- If the marker exists, it returns to `AMBIGUOUS`, completes as `AMBIGUOUS`, and is not retryable.

This preserves the original supplier confirmation/recovery authority without ever turning uncertain provider I/O into permission for another external recovery write.

## Privacy and observability

The Sync coordinator and executor do not accept payment-card data. Traveler identity/contact remains ephemeral server-side request material and is not added to the supplier operation ledger, attempt history, recovery reference, audit metadata, or structured provider observations.

Structured Sync observation is allowlisted to the SF attempt correlation UUID, organization UUID, fixed provider/operation, normalized result, duration, level, and timestamp. Supplier confirmations, recovery references, traveler identity/contact, provider locators, credentials, tokens, request bodies, and response bodies are excluded.

## Activation boundary

The server-only executor/coordinator exists, but Travelport `reservation` remains disabled. Before activation SF still requires:

1. provisioned Travelport non-production validation of SearchComplete → Rules → Availability → Create → Sync behavior and exact response receipts;
2. a reviewed PCI-safe form-of-payment/guarantee source for the Create path;
3. explicit authorized price/guarantee-change acceptance;
4. authoritative validation of `13034`, locator-less negative/correlation behavior, and retry semantics; and
5. complete product/API orchestration only after the provider capability is actually enabled.

No current route, button, customer action, or staff action can call Sync.

## References

- Travelport Sync Reservation API Reference: `POST book/reservations/`; `passiveOfferInd=true`; offer identifier authority from Availability; required traveler `PersonName`/`Telephone`, Booking.com traveler email, supplier confirmation locator, and Booking.com supplier source `BO`.
- Travelport TripServices Stays APIs Guide: Booking.com aggregator sell failure and Sync handling.
