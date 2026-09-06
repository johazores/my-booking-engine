# Supplier Reservation Submission Authority

A prepared supplier reservation is not permission to sell forever. Travelport offer, Rules, and Availability evidence can change after preparation, so the external-write path must repeat reservation authority immediately before a create claim and eventual provider write.

## Durable authority binding

`reviewAndClaimHospitalitySupplierReservationSubmission` is the server-side pre-create gate for the current Travelport Stays path. It accepts only organization ID, actor ID, and the durable supplier reservation operation ID. Browser or caller input cannot replace property, offer, stay, occupancy, money, offer fingerprint, Rules fingerprint, reservation payload fingerprint, integration identity, or credential version.

Before provider I/O the service requires `availability:read`, `pricing:read`, and `booking:manage`, then reads the reservation operation with the authenticated organization scope. It rejects any provider other than the currently implemented Travelport Stays authority workflow and verifies the active integration is the exact integration and credential version bound to the prepared operation and still advertises `reservation`.

The fresh authority request is reconstructed only from the persisted operation. A `READY` response is accepted only when its property, offer, offer fingerprint, Rules fingerprint, currency, total, complete booking terms, and revalidation requirements still match the prepared commercial evidence.

The operation does not persist the selected-offer authority fingerprint as a separate mutable field. Instead request fingerprint v2 cryptographically binds the originally reviewed authority fingerprint together with the offer, Rules, payload, stay, occupancy, and exact-money evidence. The fresh authority fingerprint is inserted into that same normalized selection and the digest must reproduce the durable `requestFingerprint` exactly. If it does not, submission fails closed and the offer/terms must be reviewed again.

Only after all of those checks pass may the existing serializable create-claim primitive move the operation to `SUBMITTING`. That primitive repeats tenant authorization and active integration/credential/capability checks under its operation lock.

## Provider-write boundary

This slice does not enable Travelport `reservation` capability and exposes no staff or customer reserve action. Travelport remains configured with read-side capabilities only.

A future create coordinator must call this fresh-authority gate, then use the existing durable provider-request marker immediately before external I/O and settle every result through the supplier reservation ledger. It must not bypass the gate by calling the low-level create-claim primitive directly. A dependency-free source contract checks the current production supplier modules for that invariant.

The real Travelport write is still blocked on a reviewed PCI-safe form-of-payment/guarantee strategy, the create adapter/request mapping, explicit provider price/guarantee-change handling, authoritative negative lookup semantics, locator-less ambiguous-write recovery, and provisioned non-production validation. Raw card data must not be introduced into SF application persistence, logs, or browser-controlled booking infrastructure to satisfy the provider contract.

## Failure behavior

Legacy reservation operations without request fingerprint v2 fail before a fresh provider review is trusted. Non-`READY`, incomplete, malformed, mismatched, or differently fingerprinted authority evidence fails closed; it never claims an external write. Integration rotation or capability changes also block the gate and require review against the current configuration.

No provider locator, credentials, traveler data, payment details, raw request/response payload, or secret material is added to audit/log persistence by this gate.
