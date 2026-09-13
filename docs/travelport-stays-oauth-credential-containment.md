# Travelport Stays OAuth credential containment

## Purpose

Travelport long-lived account credentials are authority for obtaining an OAuth access token. They are not downstream Stays API request headers. SF therefore keeps the credential exchange and the Stays API transport as separate secret boundaries.

This contract is based on the current Travelport JSON APIs documentation reviewed on 2026-09-14:

- Authentication: `https://support.travelport.com/webhelp/JSONAPIs/Airv11/Content/GeneralProject/Oauth.htm`
- JSON API migration guide: `https://support.travelport.com/webhelp/JSONAPIs/Airv11/Content/Air11/MigrationGuide/MigrationGuideJSON.htm`
- Stays FAQ: `https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/StaysFAQ.htm`

The authentication contract uses the Travelport username, password, client ID, and client secret to obtain an OAuth token. Subsequent Stays calls use `Authorization: Bearer <token>` and `XAUTH_TRAVELPORT_ACCESSGROUP`; the migration guidance explicitly says not to send username/password on each API authorization request.

## SF boundary

`createTravelportStaysOAuthCredentialContainmentFetch` is the last SF-owned request boundary before the actual Travelport transport used by the integration loader.

The older provider builders still carry `username`, `password`, `client_id`, and `client_secret` as an internal identity-binding handoff to the shared trace transport. The trace transport verifies those values against the normalized integration credentials. The containment boundary then consumes that internal evidence and removes all four headers before network I/O.

This is intentional defense in depth during the adapter transition: exact configured values can prove that the request was assembled for the active credential set, but those long-lived values are never part of the request delivered to the Stays host. Future builders may omit the four internal headers entirely; the containment boundary accepts that cleaner shape without weakening the downstream bearer/access-group contract.

For a Stays target, the containment boundary:

- requires the exact configured `XAUTH_TRAVELPORT_ACCESSGROUP` value;
- permits either none of the four long-lived OAuth credential headers or all four together;
- when all four are present, requires exact equality with the active normalized integration credentials;
- rejects partial or mismatched long-lived credential evidence before network I/O;
- removes `username`, `password`, `client_id`, and `client_secret` from the forwarded Stays request;
- independently requires the secure configured HTTPS origin, rejecting plaintext HTTP, non-default ports, URL userinfo, and fragments before network I/O; and
- clones request headers instead of mutating the caller-owned header object.

If any long-lived credential, bearer, or access-group authority is attached to a foreign or malformed target, the boundary fails closed rather than forwarding it. This terminal check is intentionally independent of the outer trace transport so a future composition mistake cannot turn the containment wrapper into a credential-leak path. The OAuth token request is unaffected because its credentials remain in the reviewed form body and not in headers.

## Production composition

Both `testTravelportStaysIntegrationConnection` and `loadTravelportStaysIntegration` construct the containment fetch from the same normalized tenant integration credentials and environment used by the shared Travelport trace transport.

For normal product traffic the order is:

1. provider-specific request builder;
2. reservation trace/response authority where applicable;
3. environment-bound Travelport trace transport, including target, header, body, correlation, redirect, and response-size checks;
4. reservation status-only response wrapper where applicable (request pass-through, response minimization on the return path);
5. OAuth credential containment; and
6. the actual server Fetch implementation.

Because the containment layer is inside the shared trace transport, the trace transport can still verify the internal identity-binding values while the network terminal never receives them. The containment layer now also reasserts the secure configured Stays origin immediately before the terminal network call, so the secret boundary remains safe if the composition changes later.

The integration remains tenant-scoped through the existing integration loader and credential-version cache key. This change does not alter provider capability advertisement, reservation authorization, payment/PAN handling, or durable supplier-write semantics.

## Similar-issue sweep

The current Travelport request builders for SearchComplete/pricing, Rules, Availability, Create/reviewed Create, Booking.com Sync, and known-locator Retrieve were reviewed for the same long-lived header pattern. They all enter the canonical `loadTravelportStaysIntegration` transport composed above, so the one terminal containment boundary covers the entire implemented Stays surface consistently instead of relying on six independent header-removal implementations.

The terminal boundary also now treats bearer `Authorization` and `XAUTH_TRAVELPORT_ACCESSGROUP` as Stays authority when deciding whether a foreign or malformed target can pass through. This closes the same credential-leak class for clean future builders that no longer carry the four long-lived internal headers.

The authenticated connection test uses the same containment boundary even though its current operation is OAuth-only, preventing a future health request from accidentally bypassing the policy.

## Validation

Focused behavior coverage verifies that:

- all four long-lived OAuth credential headers are absent at terminal Stays network I/O;
- bearer authorization and access-group authority remain present only on the configured Stays origin;
- caller-owned headers are not mutated;
- clean future builder headers remain accepted;
- partial or mismatched long-lived credentials fail before network I/O;
- long-lived, bearer, or access-group Stays authority cannot be forwarded to a foreign or malformed target;
- plaintext, alternate-port, userinfo, and fragment variants of the configured Stays host fail before network I/O;
- a mismatched access group fails before network I/O; and
- the OAuth token body path remains unchanged.

A dependency-free source contract also pins the production integration composition and the containment layer's independent secure-origin/authority checks.

## Capability boundary

This security correction does not enable Travelport `reservation`. Reservation remains deliberately unadvertised until the existing PCI-safe FormOfPayment/guarantee source, live non-production end-to-end validation, and authoritative `13034` / locator-less recovery semantics are complete.
