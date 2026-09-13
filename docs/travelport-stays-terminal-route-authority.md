# Travelport Stays terminal route authority

## Purpose

The final SF-owned Travelport credential-containment fetch is a secret-bearing network boundary, not a generic Hotel API client. Binding bearer/access-group authority only to the correct Travelport environment and `/11/hotel/` or `/12/hotel/` namespace still leaves unrelated Hotel operations reachable if an outer wrapper is accidentally bypassed.

SF therefore independently restricts terminal Stays network I/O to the operation matrix that the production adapters actually implement. The existing environment-bound trace transport remains the primary request-shape policy and continues to validate headers, bodies, tracing, response limits, and the same route family. The terminal check is deliberate defense in depth at the last boundary before Fetch.

## Allowed operation matrix

The terminal containment boundary permits only:

- `POST /12/hotel/search/searchcomplete` for the initial SearchComplete request;
- `GET /12/hotel/search/searchcomplete/{token}?pageNumber=2..5` for SearchComplete continuation;
- `POST /11/hotel/rules/offershospitality/buildfromrequest` for Rules;
- `POST /11/hotel/availability/catalogofferingshospitality` for initial Availability;
- `GET /11/hotel/availability/catalogofferingshospitality/{identifier}?pageNumber=2..5` for Availability continuation;
- `POST /11/hotel/book/reservations/build` for Create/reviewed Create, with no query or only canonical `acceptPriceChangeInd=true` and/or `acceptGuaranteeChangeInd=true` flags;
- `POST /11/hotel/book/reservations/` for the implemented reservation Sync operation; and
- `GET /11/hotel/book/reservations/{locator}` for known-locator Retrieve.

Dynamic token, identifier, and locator paths must contain exactly one canonical encoded segment. Pagination requests must contain exactly one canonical `pageNumber` query with values 2 through 5. Reservation review flags must be unique, must be one of the two reviewed names, and must have the exact value `true`. Non-canonical query encodings fail closed.

All other same-host Hotel routes, wrong methods, nested dynamic paths, collection GET, locator POST/DELETE, unsupported pagination, extra/duplicate queries, false/unknown review flags, and other Hotel APIs fail as `INVALID_REQUEST` before terminal network I/O.

## Security boundary

This restriction means a future composition mistake cannot silently reuse SF's Travelport bearer token and access-group authority for an unrelated Hotel operation merely because the destination host and product namespace are valid. OAuth remains separately pinned to the exact configured `POST /oauth/token` target and active credential body.

The terminal route guard does not replace the outer Travelport trace transport. The outer transport still owns the full request contract, including body shape/size, required headers, exact credentials, trace correlation, redirect policy, and bounded responses. Both layers must agree before a supported Stays request can reach the network.

## Similar-issue sweep

The implemented Travelport Stays surfaces were reviewed together: SearchComplete/pricing, Rules, Availability, initial/reviewed Create, Booking.com Sync, and known-locator Retrieve. The terminal matrix covers each currently reachable operation and deliberately excludes cancellation, arbitrary reservation subresources, Flights, and other Hotel endpoints that SF has not implemented.

Production and pre-production use the same operation grammar; only the configured Travelport hosts differ.

## Validation

Focused behavior coverage verifies every allowed operation family reaches the injected terminal Fetch implementation and representative same-host unsupported operations fail before I/O. Coverage includes method swaps, bad pagination pages, duplicate/extra queries, nested dynamic paths, collection/locator method inversions, invalid review flags, non-canonical query encoding, and an unimplemented Hotel cancellation-like route. The same route authority is exercised against the pre-production host.

A dependency-free source contract pins the endpoint matrix, canonical pagination and review-query rules, the terminal pre-I/O check, and this documentation boundary.

## Capability boundary

This hardening does not advertise or enable Travelport `reservation`. Reservation remains deliberately disabled until the reviewed PCI-safe FormOfPayment/guarantee source, live non-production end-to-end verification, and authoritative live `13034` / locator-less correlation and recovery semantics are complete.
