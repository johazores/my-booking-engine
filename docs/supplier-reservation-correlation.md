# Supplier reservation request correlation

## Purpose

External supplier reservation work needs a durable outbound correlation identity before provider I/O starts. A timeout, process crash, or disconnected response must not erase the identifier that can help SF, operators, and provider support identify the exact attempt.

Correlation is operational evidence. It does not prove that a supplier write succeeded, does not make an ambiguous write retryable, and does not replace provider-truth reconciliation.

## Durable attempt identity

Each `HospitalitySupplierReservationAttempt` is tenant-owned and persisted before its provider boundary. The attempt UUID is the canonical outbound request-correlation authority for the current provider operation.

Current attempt kinds are:

- `CREATE` for the initial supplier sell and each explicitly accepted reviewed second sell;
- `RECONCILE` for known-locator provider-truth retrieval; and
- `RECOVERY_WRITE` for provider-specific external recovery such as Travelport Booking.com Sync.

Initial Create, Sync, and known-locator reconciliation use the already-persisted attempt UUID directly. The reviewed second Create reserves a UUID while the accepted decision is still unconsumed; its immediate pre-POST transaction atomically creates the exact `CREATE` attempt with that UUID, archives the single-use acceptance, and writes `providerRequestStartedAt`. If deterministic work, payment-source acquisition, or OAuth fails first, that reserved correlation never becomes a durable provider attempt and no external POST occurs.

## Provider-request boundary

A durable claim alone is not evidence that transport began. `providerRequestStartedAt` is written immediately before provider I/O under the tenant/operation advisory lock.

Before a new marker is written SF rechecks:

- server-side `booking:manage`;
- organization-owned operation and exact current attempt;
- valid state/kind/sequence;
- the exact operation integration is still `ACTIVE`;
- provider code is unchanged;
- credential version is unchanged; and
- `reservation` capability is still present.

This means a claim cannot cross the provider boundary using an integration that was disabled, rotated, or had reservation authority removed while request preparation/OAuth was in progress. Once the marker exists, later configuration changes cannot be used as evidence that the earlier request was never sent.

## Travelport mapping

Travelport Stays maps the durable SF correlation into provider transport headers:

- v11 requests use `TraceId: <attempt UUID>`;
- v12 requests use `TVP-Trace-Id: <correlation UUID>`; and
- applicable requests use `E2ETrackingID: sf-<correlation UUID>`.

For the implemented reservation write/recovery paths, the v11 correlation UUID is the current durable attempt identity described above. The shared Travelport trace wrapper derives the version-specific trace header from the SF E2E identifier so the two outbound support identifiers cannot silently disagree.

Correlation values are UUIDs only. They never contain traveler/customer identity, supplier locators, commercial terms, payment data, credentials, tokens, or provider payloads.

## Known-locator reconciliation

`HospitalitySupplierReservationRecoveryProvider.retrieveReservation` receives both the known provider reservation reference and the durable current attempt UUID as `requestCorrelationId`.

The coordinator marks the attempt immediately before provider retrieval. `FOUND` must return the exact queried locator; `NOT_FOUND` is accepted only when the provider adapter has authoritative exact-locator negative semantics; all other cases remain unknown/ambiguous.

A new reconciliation receives a new durable attempt UUID while prior attempt history remains append-only.

## Create and recovery writes

Travelport initial Create passes its claimed `CREATE` attempt UUID to the executor. The executor finishes deterministic validation, sensitive request composition, query selection, and OAuth before the provider-request callback marks that same attempt and the POST can begin.

The reviewed second Create uses a separately authorized acceptance path. The accepted decision is consumed into exactly one marked `CREATE` attempt using the preselected request-correlation UUID immediately before the POST. Normal retry cannot create a replacement sell after that acceptance has been consumed.

Booking.com Sync uses its claimed `RECOVERY_WRITE` attempt UUID for both the durable marker and Travelport request correlation. A marked or ambiguous recovery write cannot be blindly replayed.

## Response correlation is separate evidence

Travelport response correlation remains operational evidence and never replaces supplier reservation authority. For the implemented production v11 reservation paths, however, it is no longer merely optional metadata: current Travelport Stays documentation says a caller-supplied trace is returned in both the response header and payload, so SF requires both echoed values to exactly match the durable attempt UUID before Create, Booking.com Sync, or known-locator Retrieve response evidence reaches its commercial classifier/parser.

A missing, malformed, or mismatched response trace therefore fails closed. For Create and Sync, which may already have crossed an external write boundary, the existing post-marker semantics keep the result ambiguous rather than granting retry authority. For known-locator Retrieve, invalid trace evidence is an invalid provider response and cannot establish `FOUND` or `NOT_FOUND`.

Even an exact trace match proves only which outbound transaction produced the response. It does not prove that a supplier sell occurred, does not replace a Travelport PNR or supplier confirmation, and does not make locator-less ambiguity retryable.

On a timeout with no response correlation, SF still has the attempt UUID and can derive the exact outbound Travelport tracking values. No additional PII or secret field is needed in the database.

## Failure and retry semantics

Durable correlation never changes commercial safety:

- provider timeout/unknown response remains `AMBIGUOUS` after the marker;
- a known locator still requires provider truth;
- locator-less ambiguity cannot become retryable merely because a tracking ID exists;
- Booking.com Sync requires its distinct verified recovery authority;
- reviewed price/guarantee acceptance is single-use and distinct from retry authority; and
- `13034` remains insufficient by itself to prove whether the supplier sold the room.

Authoritative live locator-less correlation/recovery semantics are still a provider activation gate.

## Validation

Dependency-free/source contracts verify durable correlation and marker ordering across Create, reviewed Create, Sync, and reconciliation. The provider-request marker contract also verifies the live tenant integration/provider/credential/capability recheck occurs before a new marker is written.

Travelport reservation response-trace coverage additionally verifies exact response header/payload echo binding, malformed or mismatched response rejection, non-reservation pass-through, and production integration wiring through the reservation-only correlation wrapper.

Guarded PostgreSQL scenarios cover durable attempts, tenant isolation, provider markers, stale recovery, and reservation-write replay rules when an explicitly disposable database is available. Live Travelport validation remains required before `reservation` is advertised.

## Current Travelport references

- Common Stays API headers: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/CommonHotelAPIHeaders.htm
- Stays trace and transaction IDs: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/HotelTraceTransactionIDs.htm
- Stays endpoints: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/HotelEndpoints.htm
