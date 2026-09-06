# Supplier reservation request correlation

## Purpose

External supplier reservation work needs a durable outbound correlation identity before provider I/O starts. A timeout, process crash, or disconnected response must not erase the only identifier that can help operators and provider support identify the exact request that SF sent.

This boundary is provider-neutral at the orchestration layer and provider-specific only inside each adapter. It strengthens operational evidence; it does not make an uncertain reservation safe to retry and it does not replace provider-truth reconciliation.

## Durable correlation authority

Each `HospitalitySupplierReservationAttempt` is persisted before the reconciliation coordinator calls a provider. The current attempt UUID is therefore the request correlation authority for that provider call.

`HospitalitySupplierReservationRecoveryProvider.retrieveReservation` receives both the known provider reservation reference and `requestCorrelationId`. The reconciliation coordinator always sets `requestCorrelationId` to the already-persisted current attempt ID. A new reconciliation attempt receives a new durable UUID, while the previous attempt remains append-only history.

This ordering matters: authorization, tenant scope, integration ownership, credential version, reservation capability, operation state, and the attempt row are established before any provider request can leave SF.

## Travelport mapping

For Travelport Stays known-locator Hotel Retrieve, the adapter maps the durable attempt UUID to provider headers rather than generating a transient random value inside the adapter:

- `TraceId` is the raw attempt UUID.
- `E2ETrackingID` is `sf-<attempt UUID>`.

Travelport documents `E2ETrackingID` as an optional caller-defined value used to track requests in Travelport logs and support cases. Travelport also documents a caller-defined v11 `TraceId` for request/workflow tracking. The recovery adapter sends the documented common JSON content header as well as the existing authentication/access-group headers.

The adapter validates the correlation identifier before requesting an OAuth token or making the Hotel Retrieve call. It does not log or audit request headers, credentials, tokens, provider locators, traveler data, payment data, or provider response bodies.

## Operational provider-request logging

Known-locator reconciliation now emits one privacy-safe `supplier.reservation-recovery.provider-request.completed` JSON record around actual provider I/O. The log uses the same persisted attempt UUID as `requestCorrelationId`, plus only the already-authorized organization UUID, bounded provider code, fixed `reservation.retrieve` operation, elapsed time, normalized provider result or failure code, and outcome/level.

The observation is created only after the durable reconciliation claim and provider-code/known-locator checks. Therefore a provider-code mismatch or missing locator cannot create a misleading provider-request completion event because no provider request occurred. A successful provider response is logged before durable settlement as provider transport/result evidence only; the supplier operation ledger and audit history remain the authority for whether reconciliation was durably settled. Durable settlement is outside the provider-I/O catch boundary, so persistence failures are not recast as provider failures.

Provider locators, supplier confirmations, provider response correlation IDs, integration identifiers, request/offer fingerprints, credentials, tokens, headers, URLs, request/response payloads, traveler/customer data, and payment/guarantee material are excluded from the record. See `docs/supplier-provider-observability.md` for the complete safe-field and failure contract.

## Response correlation is separate evidence

Travelport response `traceId` evidence remains normalized into the existing bounded provider-correlation field when a response is received. It is not used as a substitute for the outbound request identity.

On a timeout where no response correlation arrives, operators can still derive the exact outbound Travelport tracking values from the persisted supplier reservation attempt ID. No additional secret or PII field is required in the database.

## Failure and retry semantics

Durable correlation does not change reservation safety:

- a provider timeout or unknown response remains `AMBIGUOUS`;
- a known locator still requires exact-locator provider truth before retry safety can change;
- locator-less ambiguity still cannot be automatically resolved by the current Hotel Retrieve contract;
- an attempt UUID is support/reconciliation evidence, not proof that a reservation exists or does not exist;
- SF never performs a blind create retry merely because a durable tracking ID exists.

The future Travelport create executor must allocate/persist its create attempt before crossing the provider boundary and reuse that attempt's durable correlation identity for the corresponding outbound request. A separate live-validated provider lookup/correlation mechanism is still required before SF can claim automatic locator-less recovery.

## Validation

Dependency-free source contracts verify that the provider-neutral recovery request contains the correlation field, the coordinator supplies the persisted attempt ID, the Travelport adapter no longer creates a transient random tracking ID for recovery, and the adapter maps the durable ID into `TraceId` and `E2ETrackingID` before provider I/O.

Travelport adapter tests verify exact header values and fail-closed input validation. The guarded PostgreSQL reconciliation scenario records the correlation seen by a provider stub and verifies it equals the persisted reconciliation attempt ID; successive reconciliation attempts must use different durable attempt IDs. `scripts/supplier-reservation-provider-observability.test.mjs` verifies the operational completion record uses the same attempt UUID, contains only reviewed safe fields, emits once, and fails closed on malformed provider result statuses. The database scenario still runs only through the explicitly disposable PostgreSQL harness.

Live Travelport validation remains required before any reservation create capability is enabled.

## Current Travelport references

- Common Stays API headers: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/CommonHotelAPIHeaders.htm
- Stays trace and transaction IDs: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/HotelTraceTransactionIDs.htm
- Stays endpoints: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/HotelEndpoints.htm
