# Travelport Stays OAuth credential containment

## Purpose

Travelport long-lived account credentials are authority for obtaining an OAuth access token. They are not downstream Stays API request headers. SF therefore keeps the credential exchange and the Stays API transport as separate secret boundaries.

This contract is based on the current Travelport JSON APIs documentation reviewed on 2026-09-14:

- Authentication: `https://support.travelport.com/webhelp/JSONAPIs/Airv11/Content/GeneralProject/Oauth.htm`
- JSON API migration guide: `https://support.travelport.com/webhelp/JSONAPIs/Airv11/Content/Air11/MigrationGuide/MigrationGuideJSON.htm`
- Stays FAQ: `https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/StaysFAQ.htm`
- Flights endpoints: `https://support.travelport.com/webhelp/JSONAPIs/Airv11/Content/Air11/General/AirEndpointsList11.htm`

The authentication contract uses the Travelport username, password, client ID, and client secret to obtain an OAuth token. Subsequent Stays calls use `Authorization: Bearer <token>` and `XAUTH_TRAVELPORT_ACCESSGROUP`; the migration guidance explicitly says not to send username/password on each API authorization request.

Travelport also publishes Flights APIs on the same environment API hosts under `/11/air/`. A Travelport hostname is therefore not sufficient Stays destination authority by itself. SF must bind Stays bearer/access-group authority to the Hotel product namespace as well as the configured environment host.

## SF boundary

`createTravelportStaysOAuthCredentialContainmentFetch` is the last SF-owned request boundary before the actual Travelport network transport used by the integration loader.

The current provider builders still carry `username`, `password`, `client_id`, and `client_secret` as an internal identity-binding handoff to the shared trace transport. The trace transport verifies those values against the normalized integration credentials. The containment boundary then consumes that internal evidence and removes all four headers before Stays network I/O.

This is intentional defense in depth during the adapter transition: exact configured values can prove that the request was assembled for the active credential set, but those long-lived values are never part of the request delivered to the Stays host. The containment layer itself also accepts a cleaner Stays header shape without the four internal headers; the current production trace composition still expects the internal identity-binding set, so removing it from builders requires a coordinated trace/builder migration rather than an isolated caller change.

For a Stays target, the containment boundary:

- requires the exact configured `XAUTH_TRAVELPORT_ACCESSGROUP` value;
- permits either none of the four long-lived OAuth credential headers or all four together;
- when all four are present, requires exact equality with the active normalized integration credentials;
- rejects partial or mismatched long-lived credential evidence before network I/O;
- removes `username`, `password`, `client_id`, and `client_secret` from the forwarded Stays request;
- independently requires the secure configured HTTPS API origin, rejecting plaintext HTTP, non-default ports, URL userinfo, and fragments before network I/O;
- independently restricts Stays authority to `/11/hotel/` or `/12/hotel/`, so the same Travelport API host cannot receive SF Stays bearer/access-group authority on `/11/air/` or another product namespace; and
- clones request headers instead of mutating the caller-owned header object.

The same terminal boundary now owns the OAuth destination as well. An OAuth exchange is accepted only as `POST https://<configured-auth-host>/oauth/token` with no query, fragment, alternate port, URL userinfo, or Stays bearer/access-group authority. The body must remain the exact five-field `URLSearchParams` password grant for the active normalized username, password, client ID, and client secret. Mismatched, partial, duplicated, extra, or alternate-grant credential material fails before network I/O.

Foreign hosts and malformed targets fail closed for this Travelport-specific transport even when a future caller omits Stays headers. This prevents the terminal wrapper from becoming a generic network escape hatch around the environment-bound Travelport transport.

## Production composition

Both `testTravelportStaysIntegrationConnection` and `loadTravelportStaysIntegration` construct the containment fetch from the same normalized tenant integration credentials and environment used by the shared Travelport trace transport.

For normal product traffic the order is:

1. provider-specific request builder;
2. reservation trace/response authority where applicable;
3. environment-bound Travelport trace transport, including target, header, body, correlation, redirect, and response-size checks;
4. reservation status-only response wrapper where applicable (request pass-through, response minimization on the return path);
5. OAuth credential containment; and
6. the actual server Fetch implementation.

Because the containment layer is inside the shared trace transport, the trace transport remains the exact operation/method/query/body policy while the terminal layer independently reasserts the secret-bearing destination. Stays credentials are limited to the configured Hotel namespace, and OAuth credentials are limited to the configured authentication host and exact token path. A future composition mistake therefore cannot silently widen credential authority to another Travelport product or arbitrary host.

The integration remains tenant-scoped through the existing integration loader and credential-version cache key. This change does not alter provider capability advertisement, reservation authorization, payment/PAN handling, or durable supplier-write semantics.

## Similar-issue sweep

The current Travelport request builders for SearchComplete/pricing, Rules, Availability, Create/reviewed Create, Booking.com Sync, and known-locator Retrieve were reviewed for the same credential-target pattern. They all enter the canonical `loadTravelportStaysIntegration` transport composed above, so the one terminal containment boundary covers the entire implemented Stays surface consistently instead of relying on independent destination checks in each adapter.

The authenticated connection test uses the same containment boundary for its OAuth exchange. OAuth username/password/client credentials therefore receive the same terminal environment/target binding as downstream Stays bearer/access-group authority.

The shared Travelport API hostname also serves Flights under `/11/air/`. Same-origin non-Hotel paths are now explicitly rejected by the terminal Stays boundary; the outer trace transport continues to enforce the narrower exact Stays endpoint/method/query shapes.

## Validation

Focused behavior coverage verifies that:

- all four long-lived OAuth credential headers are absent at terminal Stays network I/O;
- bearer authorization and access-group authority remain present only on the configured Stays Hotel namespace;
- caller-owned headers are not mutated;
- the containment layer can accept a clean Stays header shape directly;
- partial or mismatched long-lived credential headers fail before network I/O;
- foreign, malformed, plaintext, alternate-port, userinfo, and fragment Stays targets fail before network I/O;
- same-host `/11/air/` and other non-Hotel targets cannot receive Stays authority;
- production and pre-production apply the same Hotel namespace rule;
- OAuth credentials can reach only the exact configured secure `/oauth/token` endpoint with `POST`;
- OAuth form authority must exactly match the active normalized credential set; and
- Stays-only bearer/access-group authority is rejected on the OAuth endpoint.

A dependency-free source contract also pins the production integration composition, Hotel namespace restriction, exact OAuth terminal target, active-credential body validation, and documentation boundary.

## Capability boundary

This security correction does not enable Travelport `reservation`. Reservation remains deliberately unadvertised until the existing PCI-safe FormOfPayment/guarantee source, live non-production end-to-end validation, and authoritative `13034` / locator-less recovery semantics are complete.
