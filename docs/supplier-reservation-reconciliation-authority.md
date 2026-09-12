# Supplier Reservation Reconciliation Authority

## Purpose

Known-locator reservation reconciliation is a provider-truth read that can settle a durable ambiguous supplier reservation. The coordinator already starts from a tenant-scoped durable `RECONCILE` claim, but its JavaScript inputs and provider-owned response objects are still runtime objects rather than trustworthy immutable authority.

SF now materializes the reconciliation boundary before those values can be reused across authorization, durable attempt state, provider I/O, confirmation checks, observation, and settlement.

## Coordinator input authority

`reconcileHospitalitySupplierReservationWithProvider` copies the organization ID, actor user ID, reservation ID, and injected recovery-provider reference into one frozen allowlisted snapshot before the durable claim. Each top-level field is read exactly once. Throwing accessors, arrays, and revoked proxies fail through one fixed non-retryable `INVALID_REQUEST` boundary instead of allowing caller-controlled exception text or time-of-check/time-of-use identity changes.

The snapshot does not replace server authorization. `claimHospitalitySupplierReservationReconciliation` remains the tenant/security boundary and continues to prove `booking:manage`, organization ownership, active integration state, credential version, the `reservation` capability, and the durable reconciliation attempt before provider I/O.

## Provider capability authority

After the durable claim proves a known provider reservation reference, SF snapshots only the recovery provider fields that can affect reconciliation: provider code, the optional supplier-confirmation requirement, and the `retrieveReservation` method. The method is retained with its original receiver so class-based adapters keep their private state, while later property mutation cannot swap the provider identity, retrieval implementation, or confirmation requirement after those values have been reviewed.

If the capability object is malformed or its getters cannot be read safely, the already-created reconciliation attempt is settled as `UNKNOWN / INVALID_REQUEST`. SF does not leave a durable attempt stranded because a provider capability getter failed between claim and provider I/O.

## Provider result authority

A successful recovery adapter call is immediately reduced to a frozen allowlisted result snapshot containing only status, provider reservation reference, optional supplier confirmation reference, and provider correlation ID. Extra provider metadata is discarded. Each authoritative field is read once before identity, confirmation, and settlement logic runs.

Malformed, throwing, or revoked provider result objects are treated as `INVALID_RESPONSE`; the provider observation is completed as failed and the durable reconciliation attempt is settled `UNKNOWN`. A provider-owned object therefore cannot pass the locator check with one value and later mutate status, confirmation, or correlation evidence during settlement.

The existing semantic rules are unchanged: the durable locator must match, correlation and supplier confirmation values are normalized through the provider-neutral bounds, required supplier confirmation remains adapter-declared, and generic HTTP/provider failure behavior is not reinterpreted by this materialization layer.

## Similar-issue review

The immediate reconciliation flow was reviewed from durable claim through provider call and final settlement. The same mutable-runtime risk existed at three connected boundaries in this one workflow: top-level coordinator identity, provider capability properties, and provider result evidence. All three are now stabilized together so the fix does not protect only the first read.

Travelport Create, reviewed Create, Booking.com Sync, and the Travelport recovery adapter already have separate operation/constructor/request authority layers. This change does not merge provider-specific commercial behavior into the provider-neutral reconciliation service.

## Activation and privacy boundary

Travelport `reservation` remains deliberately disabled. This hardening does not provide a PCI-safe FormOfPayment/guarantee source, live non-production end-to-end reservation verification, or authoritative live `13034` / locator-less retry semantics.

No provider payload, credential, token, traveler PII, or payment-card data is added to reconciliation persistence, observations, logs, audit metadata, or request fingerprints by this boundary.

Related documentation:

- `docs/supplier-provider-observability.md`
- `docs/travelport-stays-integration.md`
- `docs/travelport-stays-reservation-operation-input-authority.md`
- `docs/travelport-stays-reservation-expectation-authority.md`
