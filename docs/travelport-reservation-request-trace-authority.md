# Travelport reservation request trace authority

## Purpose

Travelport reservation Create, reviewed Create, Booking.com Sync, and known-locator Retrieve use the durable SF supplier-reservation attempt UUID as their request correlation identity. Current Travelport Stays documentation defines `TraceId` as the custom tracking header for v11 APIs and says a supplied trace is returned in both the response header and payload. SF also sends `E2ETrackingID` for support correlation.

The reservation response boundary already requires the returned v11 trace to equal the durable attempt UUID. The outbound reservation boundary now materializes that same identity before the request is delegated so request and response authority cannot drift if the shared transport is reused or refactored.

## Production rule

Inside the implemented `/11/hotel/book/reservations` namespace, `travelport-stays-reservation-trace-fetch.ts` first validates the existing SF correlation header:

- `E2ETrackingID` must be exactly `sf-<attempt UUID>`;
- the UUID must use the canonical SF UUID grammar already shared by Create, Sync, response tracing, and the restricted Travelport transport; and
- malformed or missing SF correlation fails as `INVALID_REQUEST` before delegated provider I/O.

After that validation, the wrapper clones the effective request headers and materializes the v11 pair:

- `TraceId: <attempt UUID>` is set exactly from the validated SF correlation UUID;
- `E2ETrackingID: sf-<attempt UUID>` remains the support-correlation identity; and
- `TVP-Trace-Id` is deleted because Travelport documents that header for v12 SearchComplete/SearchComplete Pagination, not v11 reservation calls.

Caller-owned `Headers` are not mutated. A missing or stale caller `TraceId`, or a stale v12 trace header, therefore cannot reach the delegated reservation transport. The shared restricted Travelport transport independently derives the same v11 `TraceId` again, removes `TVP-Trace-Id`, validates the target, credentials, request headers/body, and response-size boundary, and performs the network request. The duplicate derivation is intentional defense in depth rather than a second source of correlation truth.

`E2ETrackingID` is optional in Travelport's generic Stays contract, but SF intentionally requires it on these commercial reservation operations because the durable attempt UUID is the internal correlation source of truth. It does not by itself prove that a reservation write succeeded.

## Response relationship

After provider I/O, the existing reservation response-trace authority still requires both the v11 response header `traceId` and payload `traceId` to equal the same attempt UUID before structured reservation evidence can influence Create, Sync, or recovery state. A response carrying the v12-only `TVP-Trace-Id` header fails closed.

This request hardening does not weaken any status-only, media-type, machine-authority, response-family, or bounded replay rules.

## Validation

Focused behavior coverage verifies that reservation requests with an omitted `TraceId`, stale `TraceId`, stale `TVP-Trace-Id`, or both stale versioned headers are delegated only after the exact v11 pair has been materialized. It also verifies malformed SF correlation is rejected before the delegated fetch and that reservation-prefix lookalikes remain untouched.

A dependency-free source contract pins the request-header clone, UUID derivation, v11 `TraceId` materialization, v12 header removal, delegation ordering, and this documentation boundary.

Full repository validation still requires the repository-supported Node 24.20+ / TypeScript 6 toolchain. Live Travelport behavior still requires the provisioned non-production account.

## Activation boundary

This hardening does not advertise or enable Travelport `reservation`. The existing activation gates remain unchanged: a reviewed PCI-safe FormOfPayment/guarantee source, live non-production end-to-end reservation verification, and authoritative live `13034` / locator-less recovery semantics are still required.

## References

- Travelport Stays Trace and Transaction IDs: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/HotelTraceTransactionIDs.htm
- Travelport Common Stays API Headers: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/CommonHotelAPIHeaders.htm
- `docs/travelport-reservation-response-trace-authority.md`
- `docs/supplier-reservation-correlation.md`
- `docs/travelport-stays-request-tracing.md`
