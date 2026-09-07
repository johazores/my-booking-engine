# Supplier Reservation Submission Authority

A prepared supplier reservation is not permission to sell forever. Travelport offer, Rules, and Availability evidence can change after preparation, so the external-write path must repeat reservation authority immediately before a create claim and eventual provider write.

## Durable authority binding

`reviewAndClaimHospitalitySupplierReservationSubmission` is the server-side pre-create gate for the current Travelport Stays path. It accepts organization ID, actor ID, the durable supplier reservation operation ID, and the primary traveler whose identity/contact evidence was bound when the operation was prepared. Browser or caller input cannot replace property, offer, stay, occupancy, money, offer fingerprint, Rules fingerprint, durable traveler fingerprint, integration identity, or credential version.

Before provider I/O the service requires `availability:read`, `pricing:read`, and `booking:manage`, then reads the reservation operation with the authenticated organization scope. It rejects any provider other than the currently implemented Travelport Stays authority workflow and verifies the active integration is the exact integration and credential version bound to the prepared operation and still advertises `reservation`.

The fresh authority request is reconstructed only from the persisted operation. A `READY` response is accepted only when its property, offer, offer fingerprint, Rules fingerprint, currency, total, complete booking terms, and revalidation requirements still match the prepared commercial evidence.

The operation does not persist the selected-offer authority fingerprint as a separate mutable field. Instead request fingerprint v2 cryptographically binds the originally reviewed authority fingerprint together with the offer, Rules, payload, stay, occupancy, and exact-money evidence. The fresh authority fingerprint is inserted into that same normalized selection and the digest must reproduce the durable `requestFingerprint` exactly. If it does not, submission fails closed and the offer/terms must be reviewed again.

Travelport also returns an Availability `CatalogOffering` identifier that is the exact current sell reference for a later Create Reservation request. That provider reference is intentionally treated differently from the stable authority fingerprint: it is ephemeral cached provider authority, is not added to request fingerprint v2, and is not persisted, audited, or logged by SF. A fresh review may therefore produce the same stable authority fingerprint while returning a different current `providerSubmissionReference`.

Only the create submission gate may carry that ephemeral reference forward. The general read-only `reviewHospitalitySupplierReservationAuthority` response strips `providerSubmissionReference`, while `reviewAndClaimHospitalitySupplierReservationSubmission` validates that the reference is present, bounded, and single-line. Missing or unsafe provider submission authority fails closed before an external write can be attempted.

After fresh authority and traveler re-binding succeed, the gate maps the provider submission reference, authorized traveler, and normalized payment authority into ephemeral Travelport v11 non-secret request material. That provider-specific mapping must succeed before the serializable create claim can move the operation to `SUBMITTING`. The claim primitive then repeats tenant authorization and active integration/credential/capability checks under its operation lock.

## Fresh payment and guarantee authority

A fresh offer and sell reference are not sufficient to construct a safe Create Reservation payment object. The submission gate derives a normalized, non-secret `paymentAuthority` from the same freshly revalidated Rules evidence before the create claim is allowed.

Only one decisive create guarantee type is currently accepted: `PREPAY_REQUIRED`, `DEPOSIT_REQUIRED`, or `GUARANTEE_REQUIRED`. Missing or multiple decisive types fail closed. The payment boundary also rejects contradictory guarantee evidence: prepay cannot simultaneously be marked not required, deposit cannot simultaneously be marked not required or unsupported, and a required guarantee cannot simultaneously be marked not required or unaccepted.

Payment authority also requires at least one bounded accepted payment-card code from fresh Rules evidence. Empty card evidence, duplicate codes, unsafe codes, or oversized card-code collections fail closed. This is commercial compatibility evidence only; it does not mean SF has a PCI-safe way to collect or transmit the corresponding card. Travelport documents `AcceptedCreditCard` as an array of card codes, but the provider-neutral authority keeps the normalized provider code opaque and bounded rather than teaching the core about Travelport code syntax.

Prepay uses the exact accepted reservation total and is classified for collection at booking. Guarantee uses the exact accepted total and is classified for collection at the property. Deposit requires exactly one deposit rule and that rule must carry one explicit same-currency deposit amount. A missing, zero, over-total, cross-currency, additional, or otherwise ambiguous deposit rule fails closed instead of allowing SF to choose one of several supplier instructions.

The derived payment authority carries only the bounded accepted payment-card codes already normalized from Rules plus the decisive commercial payment kind, timing, currency, and amount. It does not contain card data, cardholder data, PAN, CVV/security code, billing data, provider credentials, or a form-of-payment token. It is not persisted, audited, or logged by this gate.

This classification is intentionally narrower than general Rules completeness. Travelport can return other guarantee values such as `GuaranteesNotRequired`, `Profile`, or `GuaranteesAccepted`; SF does not infer Create Reservation payment behavior for those values without a verified provider contract. A future provider adapter may expand normalized payment authority only from documented and live-validated semantics.

Travelport documents the Create Reservation `Payment` object differently for the three decisive cases: prepay uses the full total with deposit behavior, deposit uses the deposit amount with deposit behavior, and guarantee uses the full total with guarantee behavior. The Travelport request-material mapper converts the normalized authority into exact `Amount`, `depositInd`, and `guaranteeInd` fields without changing the selected guarantee type.

## Travelport traveler and request-material mapping

The provider-neutral traveler fingerprint permits names up to the product's 80-character guest-name limit so other suppliers are not forced to inherit Travelport constraints. At submission, the Travelport mapper applies the provider contract before the create claim.

Travelport+ documents a 22-character combined limit for traveler `Given` plus `Surname` and says longer values are truncated in the response. SF treats that truncation as unsafe identity mutation: an over-limit canonical name fails closed before the write claim and is never silently shortened. The mapper also translates the authorized telephone into `countryAccessCode`, `areaCityCode`, and `phoneNumber`, includes the authorized email, and carries only the freshly revalidated `CatalogOfferingIdentifier`.

The resulting `createRequestMaterial` deliberately has no `FormOfPayment`, `PaymentCard`, PAN, CVV/security code, cardholder, billing-card data, access token, or integration credential. It is server-only ephemeral request composition material and must not be persisted, audited, or logged.

## Provider-write boundary

Travelport `reservation` remains disabled and SF exposes no staff or customer reserve action. The implemented server-only create coordinator consumes this fresh-authority gate, rechecks the exact integration and credential version after the claim, supplies the request material and payment authority to the Travelport executor, records the durable provider-request marker immediately before the commercial POST, and settles the normalized provider outcome through the supplier reservation ledger.

The coordinator does not make sensitive form-of-payment collection safe. Its payment-card argument is an unreachable server-side adapter input until SF has a reviewed PCI-safe source/handling boundary for the provisioned Travelport account. Raw card data must not be introduced into normal SF application persistence, logs, audits, queues, analytics, or browser-controlled booking infrastructure merely to make the coordinator reachable.

Failures before `providerRequestStartedAt` are settled immediately as retry-safe `FAILED` attempts; a retry still repeats this full authority gate. After the marker, unexpected uncertainty is `AMBIGUOUS` and cannot become a blind create retry. The existing outcome mapper owns confirmed, price/guarantee review, and ambiguous/Sync-required settlement semantics.

The remaining write blockers are the reviewed PCI-safe form-of-payment/guarantee source, explicit authorized price/guarantee-change acceptance behavior, authoritative negative and locator-less ambiguity recovery including Booking.com Sync, and provisioned non-production validation. See `docs/travelport-reservation-create-coordinator.md`.

## Failure behavior

Legacy reservation operations without request fingerprint v2 fail before a fresh provider review is trusted. Non-`READY`, incomplete, malformed, mismatched, differently fingerprinted, missing provider submission authority, unsupported/ambiguous payment authority, contradictory guarantee evidence, missing accepted payment-card evidence, ambiguous deposit evidence, or Travelport-incompatible traveler/request mapping fails closed; it never claims an external write. Integration rotation or capability changes also block the gate and require review against the current configuration.

No provider locator, provider submission reference, payment authority, credentials, traveler data, payment details, raw request/response payload, or secret material is added to audit/log persistence by this gate.

## Provider reference

Travelport Stays v11 Availability documents `CatalogOffering.id` / `Identifier.value` as the cached offering identifier used by subsequent hotel workflows, including Create Reservation. SF therefore keeps the exact identifier from the one Availability offering that matched the durable selected offer, but only in memory for the immediate submission boundary.

Travelport's Rules response documents `AcceptedCreditCard` as accepted-card evidence and its Create Reservation documentation defines the Payment behavior for prepay, deposit, and guarantee-required rates. Create also documents the combined 22-character `Given`/`Surname` limit and states that `acceptPriceChangeInd` and `acceptGuaranteeChangeInd` must not be sent on the initial request.

- Availability API reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Availability.htm
- Rules reference payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_RulesRefPayload.htm
- Create Reservation reference payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm
- Create Reservation full payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationFullPayload.htm
