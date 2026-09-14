# Travelport Stays terminal request identity

## Purpose

The OAuth credential-containment fetch is the final SF-owned boundary before Travelport network I/O. Validating a parsed URL is not enough if the terminal Fetch implementation still receives the caller-owned `Request` or `URL` object, because object-level request metadata can outlive the reviewed terminal projection. The final network target therefore uses only the exact URL string that SF parsed and validated.

The same boundary also treats the Stays bearer token as explicit authority. A correct Travelport host, supported Hotel operation, and access group do not authorize an arbitrary `Authorization` scheme or an unbounded credential value.

## Terminal target authority

After parsing and validating the configured Travelport environment, HTTPS origin, operation, method, and query shape, SF calls the injected terminal Fetch implementation with `url.href` rather than the original caller object.

This applies to both:

- the exact configured OAuth `POST /oauth/token` exchange; and
- every implemented Stays operation allowed by the terminal route matrix.

The fresh terminal `RequestInit` remains authoritative for method, body, abort signal, contained headers, no-store behavior, ambient-credential omission, manual redirects, no referrer, no keepalive, and empty integrity metadata. Passing the validated URL string closes the remaining caller-owned request-object identity channel at the network edge.

## Bearer authority

Before Stays network I/O, the terminal boundary now independently requires:

- an `Authorization` header;
- the exact `Bearer ` scheme spelling used by the Travelport adapters;
- a non-empty token with no whitespace; and
- at most 16,384 token characters, matching the already bounded Travelport OAuth access-token contract.

The configured `XAUTH_TRAVELPORT_ACCESSGROUP` must still match exactly. Long-lived username/password/client credentials are still consumed as internal identity-binding evidence and removed before the Stays request is forwarded.

This is defense in depth. The outer Travelport trace transport continues to own the complete request/body/header/correlation/response contract, while the terminal boundary independently prevents a future wrapper-composition mistake from turning another authorization scheme or oversized credential into Stays network authority.

## Similar-issue sweep

The production Travelport composition uses the same credential-containment fetch for SearchComplete/pricing, Rules, Availability, initial and reviewed Create, Booking.com Sync, known-locator Retrieve, and the authenticated connection-test OAuth exchange. Fixing terminal target identity and bearer shape at this shared network edge therefore covers every currently implemented Travelport request path without duplicating policy inside individual adapters.

No provider capability is widened. `reservation` remains deliberately unadvertised.

## Validation

Focused behavior coverage verifies that missing, non-Bearer, whitespace-bearing, and oversized Stays authorization values fail before network I/O, while a token at the documented SF bound remains accepted. Separate coverage invokes the terminal boundary with caller-owned `URL` and `Request` objects and verifies that the injected network Fetch receives only the validated URL string plus the fresh safe `RequestInit`.

A dependency-free source contract pins the bearer bound, the pre-I/O bearer assertion, both `url.href` terminal calls, and this documentation boundary.
