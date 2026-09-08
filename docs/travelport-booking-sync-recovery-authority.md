# Travelport Booking.com Sync recovery authority

## Purpose

Travelport documents a Booking.com failure mode where the supplier sell succeeds but Travelport does not finish PNR processing. Retrying Create Reservation in that state can duplicate the supplier sell. SF therefore retains bounded durable provider evidence and implements a server-only Sync recovery-write path that can complete the Travelport aggregator segment without re-selling the Booking.com reservation.

The Sync path remains deliberately unreachable from product routes/actions while Travelport does not advertise `reservation`. Live non-production verification is still required before activation.

## Provider evidence required

SF records Booking.com Sync recovery authority only from the documented supplier-confirmed/no-PNR warning path and only when all of the following are true:

- the returned hospitality product exactly matches the durable Travelport property, stay dates, single-room quantity, and guest count;
- there is exactly one confirmed supplier locator with `sourceContext=Supplier` and `locatorType=Confirmation Number`;
- the supplier locator source is exactly `BO`, which Travelport identifies as Booking.com;
- the matching offer has one bounded `Identifier.authority`; and
- there is no confirmed Travelport PNR Locator, meaning no receipt simultaneously has `sourceContext=Travelport` and `locatorType=PNR Locator` with confirmed status.

A Travelport-context locator of another type is not a PNR and cannot be normalized as `providerReservationReference`.

The separate `13034` error remains ambiguous but does **not** create this recovery authority. SF does not infer from that error alone that Booking.com definitely sold or definitely did not sell the room.

## Durable representation

The Travelport adapter converts only the non-secret offer authority and verified Booking.com supplier source into a versioned opaque value such as `travelport-stays-sync-v1:BKNG:BO`. Provider-neutral core logic stores it as `providerRecoveryReference` and does not parse Travelport-specific fields.

The supplier confirmation remains in `supplierConfirmationReference`. Recovery evidence is bounded, single-line, tenant-scoped, and database-constrained to compatible in-flight/ambiguous operation states.

Traveler identity/contact, PAN, CVV, cardholder/billing data, payment data, credentials, tokens, provider request bodies, and provider response bodies are not stored in the recovery reference or audit metadata.

## Crash-safe staging

The Create coordinator stages supplier confirmation plus provider recovery reference only after the current Create attempt has a durable `providerRequestStartedAt` marker and before final Create settlement. The staging transaction requires `booking:manage`, exact organization/resource scope, the current `CREATE` attempt, and the provider marker.

If the process crashes after recovery evidence is staged but before final settlement, stale-attempt recovery moves the marked Create attempt to `AMBIGUOUS` without discarding the evidence needed for Sync. The operation still cannot re-enter ordinary Create.

Incomplete or conflicting recovery evidence fails closed. SF does not partially reconstruct a Sync request from unrelated response data.

## Recovery-write claim

`claimHospitalitySupplierReservationRecoveryWrite` is the provider-neutral persistence authority for an external recovery write. It requires:

- server-side `booking:manage`;
- exact tenant-owned operation and integration;
- active integration with matching provider, credential version, and `reservation` capability;
- locator-less `AMBIGUOUS` state;
- verified supplier confirmation and provider recovery reference;
- the exact durable `reservationPayloadFingerprint`; and
- no prior uncertain marked `RECOVERY_WRITE` that would make replay unsafe.

The Travelport coordinator derives the reservation-payload fingerprint from the normalized caller-supplied primary traveler, so changed traveler/contact data cannot be substituted into recovery of an earlier reservation request.

A recovery write uses `SUBMITTING` operation state with distinct attempt kind `RECOVERY_WRITE`. This keeps it mutually exclusive with another Create or known-locator reconciliation while retaining provider-neutral semantics.

A prior recovery write can be claimed again only when it definitively failed before any provider marker and the operation is explicitly retryable. Once a Sync provider marker exists, uncertainty is never automatic replay authority.

## Travelport Sync request

`TravelportStaysReservationSyncExecutor` uses the fixed v11 `POST book/reservations/` endpoint. Request construction is limited to:

- retained Availability offer `Identifier.authority`;
- `passiveOfferInd=true`;
- the verified Booking.com supplier Confirmation Number with source `BO` and `sourceContext=Supplier`; and
- the complete already-authorized primary traveler identity/contact authority.

Create and Sync share the provider-specific traveler mapper so canonical first/last name, telephone components, email, and Travelport's combined-name limit remain consistent with the durable reservation-payload fingerprint.

Sync accepts no form-of-payment, PAN, CVV, cardholder, billing data, arbitrary endpoint, credential, or token input.

OAuth and deterministic request construction complete before the durable provider-request marker. The attempt UUID is the provider correlation authority. The shared marker transaction rechecks the exact tenant integration is still active, on the same provider/credential version, and still advertises `reservation` immediately before marking external I/O authority.

## Response and settlement authority

Travelport documents that Sync returns the reservation response shape used by Create Reservation. SF reuses the hardened Create classifier for property/stay/occupancy and locator evidence, then applies Sync-specific settlement requirements.

Sync is confirmed only when the response proves all of the following:

- exactly one confirmed Travelport receipt locator with `sourceContext=Travelport` and `locatorType=PNR Locator`;
- the exact durable property, dates, room quantity, and guest count;
- the same original Booking.com supplier confirmation; and
- a structurally valid successful response.

A Travelport-context locator of another type cannot satisfy the PNR requirement. It is ignored for provider reservation authority rather than being mistaken for a duplicate PNR.

Changed/missing supplier confirmation, mismatched reservation identity, missing/duplicate PNR Locator, malformed response, provider error, non-success response, or transport uncertainty after the marker remains `AMBIGUOUS / INVALID_RESPONSE`.

Successful Sync clears `providerRecoveryReference` and moves the operation to `CONFIRMED` with the verified Travelport PNR Locator. Ambiguous Sync retains supplier/recovery evidence for provider-supported or manual resolution but is not retryable after the marker.

A deterministic pre-provider failure returns to `AMBIGUOUS` with recovery evidence retained and may be retried only because durable state proves no Sync request was sent.

## Crash recovery

The shared supplier attempt lease recognizes `RECOVERY_WRITE` as a valid `SUBMITTING` attempt.

- Stale recovery write without `providerRequestStartedAt`: return to `AMBIGUOUS`, complete the attempt as `FAILED`, preserve recovery evidence, and allow retry only under the explicit pre-provider policy.
- Stale recovery write with a marker: return to `AMBIGUOUS`, complete the attempt as `AMBIGUOUS`, preserve recovery evidence, and deny automatic replay.

This never turns uncertain provider I/O into permission for another external recovery write.

## Privacy and observability

The Sync coordinator and executor accept no payment-card data. Traveler identity/contact is ephemeral request material and is not added to supplier operation state, attempt history, recovery reference, audit metadata, or structured provider observations.

Structured Sync observation is allowlisted to SF-owned correlation/tenant/result/timing fields. Supplier confirmations, recovery references, traveler identity/contact, provider locators, credentials, tokens, request bodies, and response bodies are excluded.

## Relationship to commercial review

Price/guarantee `REVIEW_REQUIRED` handling is a different state machine. The tenant-authorized acceptance boundary and one-time reviewed second-Create consumption path are implemented server-side. They never grant Booking.com Sync authority and Sync never consumes commercial-review acceptance.

Likewise, Booking.com Sync recovery authority does not permit another Create Reservation attempt.

## Activation boundary

Travelport `reservation` remains disabled. Before activation SF still requires:

1. a concrete reviewed PCI-safe FormOfPayment/guarantee source for initial and reviewed Create appropriate to the provisioned account;
2. live non-production SearchComplete → Rules → Availability → initial Create → reviewed second Create → Sync/recovery verification, including exact PNR/supplier receipt shapes;
3. authoritative live `13034`, locator-less negative/correlation, and retry/recovery semantics; and
4. complete product/API orchestration only after the provider capability is deliberately enabled.

No current route, button, customer action, or staff action can call Sync.

## References

- Travelport Sync Reservation API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Sync.htm
- Travelport Create Reservation Reference Payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm
- Travelport Retrieve Hotel Reservation: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Retrieve.htm
- Travelport Stays APIs Guide: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/Guides/HotelAPIsGuide.htm
