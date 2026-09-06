# Supplier Reservation Submission Authority

A prepared supplier reservation is not permission to sell forever. Travelport offer, Rules, and Availability evidence can change after preparation, so the external-write path must repeat reservation authority immediately before a create claim and eventual provider write.

## Durable authority binding

`reviewAndClaimHospitalitySupplierReservationSubmission` is the server-side pre-create gate for the current Travelport Stays path. It accepts only organization ID, actor ID, and the durable supplier reservation operation ID. Browser or caller input cannot replace property, offer, stay, occupancy, money, offer fingerprint, Rules fingerprint, reservation payload fingerprint, integration identity, or credential version.

Before provider I/O the service requires `availability:read`, `pricing:read`, and `booking:manage`, then reads the reservation operation with the authenticated organization scope. It rejects any provider other than the currently implemented Travelport Stays authority workflow and verifies the active integration is the exact integration and credential version bound to the prepared operation and still advertises `reservation`.

The fresh authority request is reconstructed only from the persisted operation. A `READY` response is accepted only when its property, offer, offer fingerprint, Rules fingerprint, currency, total, complete booking terms, and revalidation requirements still match the prepared commercial evidence.

The operation does not persist the selected-offer authority fingerprint as a separate mutable field. Instead request fingerprint v2 cryptographically binds the originally reviewed authority fingerprint together with the offer, Rules, payload, stay, occupancy, and exact-money evidence. The fresh authority fingerprint is inserted into that same normalized selection and the digest must reproduce the durable `requestFingerprint` exactly. If it does not, submission fails closed and the offer/terms must be reviewed again.

Travelport also returns an Availability `CatalogOffering` identifier that is the exact current sell reference for a later Create Reservation request. That provider reference is intentionally treated differently from the stable authority fingerprint: it is ephemeral cached provider authority, is not added to request fingerprint v2, and is not persisted, audited, or logged by SF. A fresh review may therefore produce the same stable authority fingerprint while returning a different current `providerSubmissionReference`.

Only the create submission gate may carry that ephemeral reference forward. The general read-only `reviewHospitalitySupplierReservationAuthority` response strips `providerSubmissionReference`, while `reviewAndClaimHospitalitySupplierReservationSubmission` validates that the reference is present, bounded, and single-line, then returns it inside `submissionAuthority` alongside the durable create claim. Missing or unsafe provider submission authority fails closed before an external write can be attempted.

Only after all of those checks pass may the existing serializable create-claim primitive move the operation to `SUBMITTING`. That primitive repeats tenant authorization and active integration/credential/capability checks under its operation lock.

## Fresh payment and guarantee authority

A fresh offer and sell reference are not sufficient to construct a safe Create Reservation payment object. The submission gate now derives a normalized, non-secret `paymentAuthority` from the same freshly revalidated Rules evidence before the create claim is allowed.

Only one decisive create guarantee type is currently accepted: `PREPAY_REQUIRED`, `DEPOSIT_REQUIRED`, or `GUARANTEE_REQUIRED`. Missing or conflicting decisive types fail closed. Prepay uses the exact accepted reservation total and is classified for collection at booking. Guarantee uses the exact accepted total and is classified for collection at the property. Deposit requires exactly one explicit same-currency deposit amount from fresh Rules evidence; a missing, zero, over-total, conflicting, or cross-currency deposit amount fails closed.

The derived payment authority may carry the bounded accepted payment-card codes already normalized from Rules, but it does not contain card data, cardholder data, PAN, CVV/security code, billing data, provider credentials, or a form-of-payment token. It is not persisted, audited, or logged by this gate. It is only non-secret commercial instruction evidence for a future provider adapter.

This classification is intentionally narrower than general Rules completeness. Travelport can return other guarantee values such as `GuaranteesNotRequired`, `Profile`, or `GuaranteesAccepted`; SF does not infer Create Reservation payment behavior for those values without a verified provider contract. A future provider adapter may expand normalized payment authority only from documented and live-validated semantics.

Travelport documents the Create Reservation `Payment` object differently for the three decisive cases: prepay uses the full total with deposit behavior, deposit uses the deposit amount with deposit behavior, and guarantee uses the full total with guarantee behavior. SF keeps those provider-specific indicator names out of the normalized core authority; the eventual Travelport write adapter must map the normalized authority to the provider payload and must not silently change the guarantee type.

## Provider-write boundary

This slice does not enable Travelport `reservation` capability and exposes no staff or customer reserve action. Travelport remains configured with read-side capabilities only.

A future create coordinator must call this fresh-authority gate, consume the returned `providerSubmissionReference` and `paymentAuthority` immediately, then use the existing durable provider-request marker immediately before external I/O and settle every result through the supplier reservation ledger. It must not bypass the gate by calling the low-level create-claim primitive directly, persist the ephemeral Availability reference or payment authority as durable booking authority, or silently repeat stale provider evidence after a failed authority review. A dependency-free source contract checks the current production supplier modules for these invariants.

The real Travelport write is still blocked on a reviewed PCI-safe form-of-payment/guarantee strategy, the create adapter/request mapping, explicit provider price/guarantee-change handling, authoritative negative lookup semantics, locator-less ambiguous-write recovery, and provisioned non-production validation. Raw card data must not be introduced into SF application persistence, logs, or browser-controlled booking infrastructure to satisfy the provider contract.

## Failure behavior

Legacy reservation operations without request fingerprint v2 fail before a fresh provider review is trusted. Non-`READY`, incomplete, malformed, mismatched, differently fingerprinted, missing provider submission authority, or unsupported/ambiguous payment authority fails closed; it never claims an external write. Integration rotation or capability changes also block the gate and require review against the current configuration.

No provider locator, provider submission reference, payment authority, credentials, traveler data, payment details, raw request/response payload, or secret material is added to audit/log persistence by this gate.

## Provider reference

Travelport Stays v11 Availability documents `CatalogOffering.id` / `Identifier.value` as the cached offering identifier used by subsequent hotel workflows, including Create Reservation. SF therefore keeps the exact identifier from the one Availability offering that matched the durable selected offer, but only in memory for the immediate submission boundary.

Travelport's Create Reservation documentation also defines the Payment behavior for prepay, deposit, and guarantee-required rates, and states that `acceptPriceChangeInd` and `acceptGuaranteeChangeInd` must not be sent on the initial create request.

- Availability API reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Availability.htm
- Create Reservation reference payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm
- Create Reservation full payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationFullPayload.htm
