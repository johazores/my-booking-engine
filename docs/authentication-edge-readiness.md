# Authentication edge readiness and manual verification

## Status and boundary

**Deployment gate, not implemented protection.** SF currently enforces PostgreSQL-backed per-email and deployment-wide sign-in/sign-up admission and bounded in-process scrypt capacity. It does **not** have a verified trusted client-source identity or deployed per-source edge throttling. This document defines the evidence required before those controls can be called production-ready. Do not mark Phase 2 complete based on this runbook alone.

These controls belong at the trusted ingress, before Next.js and before request-body parsing or PostgreSQL admission. Do not add application-level source limits using arbitrary `X-Forwarded-For`, `X-Real-IP`, `Forwarded`, or user-supplied request IDs. No provider-specific edge configuration is assumed here.

## Deployment prerequisites

1. Identify the actual public entry point, reverse-proxy/CDN chain, and application origin for **each** environment and hostname. Document which hop terminates TLS, which hop owns the canonical client address, and whether a request can bypass the edge to reach the origin.
2. Restrict origin access to the verified ingress path (network ACL, private connectivity, or an equivalent authenticated origin boundary). A public origin reachable directly makes an edge-only rate limit bypassable.
3. At the first trusted hop, remove inbound client-supplied forwarding/source headers before setting canonical metadata. Every subsequent trusted hop must have an explicit peer allowlist and a documented overwrite/append rule. A request from an untrusted peer must not be allowed to impersonate a trusted proxy.
4. Enforce expected external hostnames and HTTPS at the trusted edge. Validate `Host` and any forwarded host/protocol against the deployed host allowlist rather than deriving trust from the application request URL. Keep the existing application exact-Origin check as defense in depth.
5. Configure per-source admission **at the edge** for `POST /api/auth/sign-in` and `POST /api/auth/sign-up`. Cover IPv4 and IPv6, canonicalize addresses according to the chosen edge's documented semantics, and avoid trusting attacker-controlled address strings. The source budget must apply before malformed forms, unknown identities, or large request bodies reach the application. Use an explicit burst policy, sustained budget, expiry/window policy, and bounded rejection response. Record the chosen values and the rationale from staging load tests, not guessed production thresholds.
6. Preserve existing PostgreSQL per-identity/global budgets as an independent second layer. The app's HTTP 303 plus `Retry-After` is a browser form response, **not** an edge 429. Edge metrics must count actual edge rejections separately from the app's privacy-safe `authRateLimited` completion flag.
7. Keep raw client addresses, submitted identities, credentials, cookies, session tokens, HMAC digests, and request bodies out of ordinary application logs. If the edge requires address-level security telemetry, use restricted access and an explicit retention policy; do not forward it into SF's application completion records.

## Non-production verification

Use a dedicated staging deployment with the **same actual ingress topology** and a disposable database. Perform the checks with test identities only. Configure low temporary staging limits so no high-volume traffic or credential guessing is needed. Restore intended limits after testing. Record the date, ingress configuration revision, observed responses, and reviewer without recording secrets or raw user identifiers.

| Check | Required evidence |
| --- | --- |
| Direct-origin bypass | An external client cannot reach the Next.js origin while bypassing the trusted edge, including by alternate hostname/IP and direct port access |
| Header spoofing | Changing untrusted `X-Forwarded-For`, `X-Real-IP`, `Forwarded`, or request-ID values cannot change the source bucket or bypass the edge budget |
| Trusted hop | Only the documented ingress peer can supply canonical source metadata; malformed, duplicate, and contradictory forwarded headers do not bypass enforcement |
| Address families | Real independent IPv4 and IPv6 clients receive independent source accounting; IPv6 formatting/normalization does not permit cheap evasion |
| Shared deployment | Requests distributed across two application instances still hit the same edge source budget and the same PostgreSQL identity/global budgets |
| Before parsing | Unsupported media type, invalid Origin, malformed form, and oversized body traffic still consumes the edge source budget; none can bypass it by failing application validation |
| Route/method scope | Both credential POST routes are covered, while health checks, normal navigation, and unrelated public booking routes are not accidentally throttled |
| Response behavior | Edge denial has the configured bounded rejection response (normally HTTP 429); app quota denial retains its local HTTP 303, no-store, and database-derived retry feedback |
| Failure behavior | If the edge's counter store, proxy chain, or source resolution fails, the documented fail-closed or tightly bounded fallback policy applies; requests cannot silently bypass protection |
| Privacy/operations | Metrics distinguish edge rejections from application quota rejections, alerts have an owner, and no credential or untrusted source header enters SF logs |
| Host/Origin | Unknown external hosts and untrusted forwarded hosts are rejected at ingress; cross-origin credential mutations remain rejected by the application |

For a **small, controlled** staging probe, compare repeated requests from one real client while changing only spoofable forwarding headers. The source bucket must remain the same. Repeat from a genuinely different network source and across the deployed application replicas. Do not infer source trust from a single successful request or from an application 303 alone. Do not run these probes against production accounts or rely on a simulated CDN in a unit test as evidence of live enforcement.

## Operational handoff and release gate

- Record the edge product/configuration version, approved hostnames, trusted proxy hops, direct-origin restrictions, source-key algorithm, route matchers, thresholds, rejection policy, IPv6 handling, and owner in the private deployment runbook. Do not commit secrets, infrastructure access tokens, or customer IPs.
- Establish safe aggregated monitoring for edge 429s, application `authRateLimited` completions, sign-in success/failure rates, origin 5xx, and crypto-capacity errors. Alert on sustained abuse and on legitimate-user lockouts. Review shared-NAT/corporate/mobile network effects before raising or lowering budgets.
- Recheck the ingress trust chain after CDN, load balancer, DNS, reverse-proxy, or origin network changes.
- **Do not mark authentication abuse controls complete** until this live staging evidence, Node 24 and disposable PostgreSQL validation, production capacity/load tuning, and a real registration email verification/recovery lifecycle are separately complete. A generic duplicate-email error while successful sign-up creates a session is still account-enumerable.

Related implementation: `docs/authentication-abuse-control.md`, `docs/authentication.md`, `docs/security.md`, and `docs/development-guide.md`.
