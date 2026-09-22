# Supplier Reservation Reconciliation Authority

## Purpose

Known-locator reservation reconciliation is a provider-truth read that can settle a durable ambiguous supplier reservation. The coordinator already starts from a tenant-scoped durable `RECONCILE` claim, but its JavaScript inputs and provider-owned response objects are still runtime objects rather than trustworthy immutable authority.

SF materializes the reconciliation boundary before those values can be reused across authorization, durable attempt state, provider I/O, confirmation checks, observation, and settlement.

## Coordinator input authority

`reconcileHospitalitySupplierReservationWithProvider` copies the organization ID, actor user ID, reservation ID, and injected recovery-provider reference into one frozen allowlisted snapshot before the durable claim. Each top-level field is read exactly once. Throwing accessors, arrays, and revoked proxies fail through one fixed non-retryable `INVALID_REQUEST` boundary instead of allowing caller-controlled exception text or time-of-check/time-of-use identity changes.

The snapshot does not replace server authorization. `claimHospitalitySupplierReservationReconciliation` remains the tenant/security boundary and continues to prove `booking:manage`, organization ownership, active integration state, credential version, the `reservation` capability, and the durable reconciliation attempt before provider I/O.

## Provider capability authority

After the durable claim proves a known provider reservation reference, SF snapshots only the recovery provider fields that can affect reconciliation: provider code, the optional supplier-confirmation requirement, the optional authoritative exact-locator negative-evidence capability, and the `retrieveReservation` method. The method is retained with its original receiver so class-based adapters keep their private state, while later property mutation cannot swap the provider identity, retrieval implementation, confirmation requirement, or negative-evidence authority after those values have been reviewed.

`supportsAuthoritativeNotFound` defaults to `false`. A provider-neutral `NOT_FOUND` can remove the known locator and return the operation to `PREPARED` only when the snapshotted adapter explicitly declares this capability. Without that declaration, a normalized `NOT_FOUND` is treated as `INVALID_RESPONSE`, the operation remains `AMBIGUOUS`, and the durable provider/supplier identity is preserved. This prevents a buggy or future adapter from turning an unsupported negative response into authority for another supplier Create.

Travelport Stays declares `supportsAuthoritativeNotFound = true` only for its narrow provider-specific negative-evidence classifier. Travelport documents Stays error `SourceCode=13061`, HTTP/error `StatusCode=400`, category `VALIDATION`, and the canonical newer-version message `RESERVATION WAS NOT FOUND IN SUPPLIER SYSTEM`. SF accepts `NOT_FOUND` only when the Retrieve response is a structurally valid newer-version `ErrorResponse / Result / ErrorDetail` carrying that exact code/status/category/message contract. `SourceID` must still be a bounded safe value, but it may legitimately be `API` or a supplier chain code and is not used as reservation-identity authority. Generic HTTP `404`, the older title-cased message, mismatched safe messages such as the `13060` offer-not-found message, older error shapes without a source code, mixed or malformed error collections, unrelated Travelport errors, and contradictory response families remain non-authoritative and preserve ambiguity.

This exact-locator authority does not resolve locator-less Create uncertainty or the separate `13034` Sync-required scenario. Those activation gates remain closed.

Provider code is also required to be a trim-stable, control-free machine token of at most 64 characters before it can be compared with the durable provider identity. Optional provider capability flags must be booleans when present. If the capability object is malformed, its provider code or flags are invalid, or its getters cannot be read safely, the already-created reconciliation attempt is settled as `UNKNOWN / INVALID_REQUEST`. SF does not leave a durable attempt stranded because a provider capability getter failed between claim and provider I/O.

## Provider result authority

A successful recovery adapter call is immediately reduced to a frozen allowlisted result snapshot. The result status must be exactly `FOUND` or `NOT_FOUND`; the provider reservation reference must be a trim-stable, control-free machine token of at most 512 characters; and the provider correlation ID must be either null or the same bounded token shape.

`FOUND` supplier confirmation is also either null or a bounded exact token. `NOT_FOUND` does not gain supplier-confirmation authority. The materializer still reads an unexpected non-null supplier confirmation once and preserves it only as bounded contradictory evidence so the existing durable-confirmation continuity check can reject the negative lookup. Extra provider metadata is discarded.

Every result field that can influence settlement is therefore both read once and semantically bounded before identity, confirmation, observation, or persistence logic runs. Unknown statuses, padded/control-character references, oversized references, malformed nullable fields, throwing getters, and revoked proxies all become the same sanitized `INVALID_RESPONSE`; the provider observation is completed as failed and the durable reconciliation attempt is settled `UNKNOWN`.

The existing reconciliation rules remain fail closed: the durable locator must match exactly, required supplier confirmation remains adapter-declared, `NOT_FOUND` requires explicit authoritative-negative capability, and generic HTTP/provider failure behavior is not reinterpreted by this materialization layer.

## Similar-issue review

The immediate reconciliation flow was reviewed from durable claim through provider call and final settlement. The same runtime-authority concern exists at four connected boundaries in this workflow: top-level coordinator identity, provider capability properties, provider result evidence, and the commercial authority of negative evidence. All four are stabilized, while the coordinator independently refuses to convert an undeclared negative result into retry authority.

The Travelport recovery adapter was also swept for transport-status shortcuts. HTTP status alone never authorizes a second Create: only the exact documented `13061` Stays error contract can emit provider-neutral `NOT_FOUND`. The classifier intentionally requires the canonical newer-version message in addition to source code, status, category, and envelope shape so contradictory or mixed provider evidence fails closed. Travelport Create, reviewed Create, and Booking.com Sync keep their separate provider-specific write classifiers and authority boundaries.

## Activation and privacy boundary

Travelport `reservation` remains deliberately disabled. This hardening does not provide a PCI-safe FormOfPayment/guarantee source, live non-production end-to-end reservation verification, or authoritative live `13034` / locator-less retry semantics.

No provider payload, credential, token, traveler PII, or payment-card data is added to reconciliation persistence, observations, logs, audit metadata, or request fingerprints by this boundary.

Related documentation:

- `docs/supplier-provider-observability.md`
- `docs/supplier-reservation-correlation.md`
- `docs/travelport-stays-integration.md`
- `docs/travelport-stays-reservation-operation-input-authority.md`
- `docs/travelport-stays-reservation-expectation-authority.md`
- Travelport Stays API Error Messaging: `https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/HotelAPIErrors.htm`
