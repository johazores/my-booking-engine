# Travelport Stays Request Tracing

SF keeps Travelport request correlation provider-specific and transport-only. It is observability evidence, not reservation authority and not proof that a supplier write succeeded.

## Version-specific trace headers

Travelport Stays documents different caller-defined request-trace headers by API version:

- v11 Stays requests use `TraceId`.
- v12 SearchComplete/SearchComplete Pagination requests use `TVP-Trace-Id`.
- SF also keeps `E2ETrackingID: sf-<correlation UUID>` as its provider-support identifier.

Production Travelport adapters are constructed through `loadTravelportStaysIntegration` with `createTravelportStaysTraceFetch`. The wrapper is bound to the validated integration environment and derives the version-specific trace header from the existing SF `E2ETrackingID`, so the support identifiers cannot silently disagree at the transport boundary.

The shared transport wrapper is also a fail-closed outbound target boundary. A pre-production integration can reach only the pre-production Travelport API/authentication hosts and a production integration can reach only the production hosts. Stays traffic is accepted only over HTTPS on the default HTTPS port, with no URL userinfo or fragment, an SF-owned `E2ETrackingID` containing a valid UUID, and one of the exact implemented Stays operation shapes below:

- `POST /12/hotel/search/searchcomplete` with no query string;
- `GET /12/hotel/search/searchcomplete/{SearchIdentifier}?pageNumber=2..5`;
- `POST /11/hotel/rules/offershospitality/buildfromrequest` with no query string;
- `POST /11/hotel/availability/catalogofferingshospitality` with no query string;
- `GET /11/hotel/availability/catalogofferingshospitality/{AvailabilityIdentifier}?pageNumber=2..5`;
- `POST /11/hotel/book/reservations/build` with no query string for the initial Create or only `true` acceptance flags (`acceptPriceChangeInd` and/or `acceptGuaranteeChangeInd`) for the reviewed second Create;
- `POST /11/hotel/book/reservations/` with no query string for Booking.com Sync; and
- `GET /11/hotel/book/reservations/{AggregatorLocatorCode}` with no query string for known-locator Retrieve.

Unsupported methods, extra query parameters, duplicate review flags, false review flags, non-canonical path/query encodings that cannot be produced by the adapters, unrelated Stays paths, missing/foreign/malformed correlation, and cross-environment targets all fail before transport. Path identifiers and query strings must use the same canonical adapter encoding before they are accepted. This keeps an adapter defect or injected transport caller from turning Travelport credentials into authority for an API operation SF has not implemented and reviewed.

OAuth is the only uncorrelated exception. It is accepted only as `POST` to the configured environment's fixed `/oauth/token` target, on the default HTTPS port, with no URL userinfo, query, fragment, or `E2ETrackingID`. Stays trace headers are removed from that request. Any other host, alternate port, credentialed URL, method, unsupported path, or unexpected OAuth shape fails closed before credentials can leave the process.

The authenticated integration connection test uses the same environment-bound wrapper around its injectable transport, so validation traffic cannot bypass the production target policy.

## Correlation lifetime

Read-only discovery/pricing adapters may use fresh request UUIDs because those calls do not create supplier inventory. Reservation lifecycle work is stronger: Create, reviewed Create, Booking.com Sync, and known-locator Retrieve are correlated to the provider-neutral supplier reservation attempt ledger.

Initial Create, Sync, and reconciliation pass their already-persisted `HospitalitySupplierReservationAttempt.id` as the outbound correlation UUID. Reviewed Create reserves its correlation UUID while accepted authority remains unconsumed and atomically creates the exact marked `CREATE` attempt with that UUID in the immediate pre-POST acceptance-consumption transaction.

The provider-request marker rechecks the exact tenant integration is still active with the same provider, credential version, and reservation capability before a new marked request can begin. This prevents a stale prepared client from crossing the provider boundary after integration disablement or credential rotation.

A durable attempt/correlation is still not proof of provider success. `providerRequestStartedAt`, provider locator/recovery evidence, settlement state, and provider-truth reconciliation remain separate authorities.

## Privacy and security

Trace IDs are opaque UUIDs. They must not contain traveler names, email addresses, payment data, reservation locators, supplier confirmations, credentials, or other business payload data.

The wrapper never logs headers or request bodies and forces `redirect: 'manual'` for both OAuth and Stays requests regardless of caller or `Request` redirect policy. Individual credential-bearing Travelport helpers may also specify manual redirects as defense in depth, but the shared environment-bound transport is the final redirect-suppression authority. This prevents Travelport bearer tokens, account headers, OAuth credentials, and reservation credentials from being automatically replayed to a redirect target.

The same shared boundary owns transport metadata for OAuth and every implemented Stays operation. It forces `cache: 'no-store'`, `credentials: 'omit'`, an empty referrer with `referrerPolicy: 'no-referrer'`, `keepalive: false`, and empty subresource integrity metadata even when an injected caller or `Request` asks for different behavior. The caller's request body and abort signal still flow through, but cache/session/referrer/background-lifetime/integrity policy cannot become an alternate authority around the reviewed Travelport request. This keeps SearchComplete, Rules, Availability, Create/reviewed Create, Sync, Retrieve, and token traffic on one explicit server-owned transport path.

The wrapper does not spread arbitrary caller `RequestInit` metadata into the credentialed fetch. It projects only the already-validated `method`, `body`, and caller abort `signal`, then adds the server-owned headers and transport policy above. Runtime/framework extensions and alternate transport knobs such as Node/Undici `dispatcher` or agent/proxy fields, framework `next` fetch metadata, and browser-only mode/window/priority settings are therefore stripped instead of becoming a hidden routing, caching, or request-behavior authority around the Travelport boundary.

Caller-supplied HTTP routing, framing, proxy/forwarding, ambient session, conditional-cache, and partial-response headers are not part of the Travelport adapter contract. The wrapper rejects values such as `Host`, `Content-Length`, `Content-Encoding`, `Content-Range`, `Cookie`, `Connection`, `Expect`, `Proxy-Authorization`, `Transfer-Encoding`, `Forwarded`, `X-Forwarded-*`, `Origin`, `Referer`, `If-*`, and `Range` before provider I/O. Fetch remains responsible for transport-generated routing/framing headers after this validation. This prevents an adapter or injected caller from overriding URL-owned routing, supplying conflicting message framing or representation metadata, leaking unrelated application/browser or proxy credentials, forwarding stale infrastructure metadata alongside Travelport secrets, or weakening the forced no-store contract with conditional/partial representation semantics.

The deny list is only defense in depth; the credentialed transport now also enforces a route-specific header allowlist. OAuth may carry only the adapter-owned `Accept` and form `Content-Type` headers plus version trace headers that are stripped before the token request is sent. Stays may carry only the documented common Travelport credential/content headers used by SF (`Accept`, `Accept-Encoding`, `Cache-Control`, `Content-Type`, `Authorization`, `XAUTH_TRAVELPORT_ACCESSGROUP`, `E2ETrackingID`, `username`, `password`, `client_id`, and `client_secret`), the two version trace headers that SF rewrites from `E2ETrackingID`, and the SearchComplete-specific `TVP-Cache-Control`. Any other caller header, including unrelated internal API keys, application session/correlation headers, browser `Sec-*` metadata, CDN forwarding metadata, or unreviewed provider extensions, fails before credentialed provider I/O.

Known header channels are validated rather than merely named. JSON/media and cache headers must use the exact values produced by the adapters, bearer authorization must remain a single bounded `Bearer` credential, and Travelport credential headers use the same length ceilings as server-side credential normalization. The production integration loader also binds the wrapper to the normalized static credential set: the adapter-owned common authentication/content headers must be present, OAuth form credentials and Stays `username`, `password`, `client_id`, `client_secret`, and `XAUTH_TRAVELPORT_ACCESSGROUP` must exactly match the configured integration before provider I/O. This prevents an injected caller from turning the shared transport into authority for a different Travelport identity or access group. `TVP-Cache-Control` is accepted only as `no-cache` on the unpaginated v12 SearchComplete `POST` that owns that provider extension. OAuth still rejects Stays-only credential headers such as `Authorization`, `XAUTH_TRAVELPORT_ACCESSGROUP`, `username`, `password`, `client_id`, and `client_secret`; OAuth credentials remain in the reviewed form body rather than being duplicated into an unrelated header channel.

Request bodies have a second fail-closed transport shape without turning the transport into a provider business-schema parser. The OAuth request body must remain the adapter-owned `URLSearchParams` password-grant form with exactly one `grant_type=password`, `username`, `password`, `client_id`, and `client_secret`, using the same field-length and whitespace bounds as Travelport credential normalization and exact `application/x-www-form-urlencoded` media type. Every Stays `POST` request body must remain an in-memory JSON object string with exact `application/json` media type and at most 4 MiB of UTF-8 payload; Bodyless OAuth or Stays `POST` requests and any Stays `GET` request carrying a body fail before provider I/O. An inherited `Request` body arrives as a stream and therefore fails this representation contract unless the caller explicitly supplies a reviewed `init.body`. The wrapper checks shape and size without parsing, copying, hashing, logging, or retaining the JSON payload, which is important because Create can contain ephemeral FormOfPayment data. Provider-specific request schema and commercial authority remain owned by the adapters/coordinators.

The wrapper also fully consumes each Travelport response body before it resolves back to a provider adapter. The adapters already place their request `AbortSignal` around the wrapped fetch call; keeping the wrapper pending through body acquisition means that timeout remains active until the complete provider payload is received instead of ending as soon as response headers arrive. The wrapper does not parse or trust the payload. It reconstructs status, status text, and non-representation headers and returns a single unread replay stream for the existing adapter-specific status and schema validation. Bodyless responses are preserved without manufacturing content.

This buffering boundary intentionally does not use `Response.clone()` or retain provider-owned chunk views. A cloned Fetch response tees the provider body into another unread branch while the first branch is consumed, and retaining an arbitrary `Uint8Array` view can keep a much larger pooled backing buffer alive. SF instead copies received bytes once into fixed 64 KiB replay blocks. Small provider chunks are coalesced into those blocks, which bounds replay-object amplification and retained backing allocation while keeping the same complete-body deadline and byte ceilings.

Fetch implementations may transparently decode a compressed HTTP response body while still exposing wire-level `Content-Encoding` and `Content-Length` headers. Because SF replays the decoded body bytes rather than the original wire representation, the replay removes those two representation headers instead of publishing stale gzip/framing metadata. Status, status text, media type, and other provider metadata remain available to the adapter. Provider decompression behavior itself stays owned by the runtime Fetch implementation.

Because this wrapper intentionally retains a complete response until adapter parsing begins, SF applies transport-owned resource ceilings: 256 KiB for OAuth token responses and 32 MiB for Stays responses. A syntactically valid `Content-Length` above the applicable ceiling is rejected before buffering, while malformed `Content-Length` is invalid provider evidence. The header is only an early guard; the wrapper also counts the actual bytes delivered by the Fetch response stream, so chunked, compressed/decoded, or otherwise differently framed responses cannot bypass the memory boundary. Once the received-byte ceiling is crossed, SF cancels the provider body and fails closed as non-retryable `INVALID_RESPONSE`. These are SF process-safety limits, not Travelport reservation authority or a statement about provider business semantics.

Read/auth adapter timeout wrappers preserve normalized `HospitalitySupplierProviderError` values raised by the shared transport when their caller deadline has not fired. This keeps fail-closed transport target and response violations as their original non-retryable `INVALID_REQUEST` or `INVALID_RESPONSE` authority instead of disguising them as retryable provider outages. A caller-owned deadline remains authoritative as `TIMEOUT`, while unknown low-level transport failures normalize to bounded `PROVIDER_UNAVAILABLE` without leaking implementation-specific error details.

## Capability boundary

This tracing and durable-correlation infrastructure does not enable Travelport `reservation`, `modification`, or `cancellation` capabilities and does not expose a supplier booking action.

The server-only initial Create, explicit price/guarantee review acceptance, one-time reviewed second Create, Booking.com Sync recovery, and known-locator Retrieve boundaries are implemented. Travelport `reservation` remains disabled until SF has a concrete reviewed PCI-safe FormOfPayment/guarantee source for the provisioned account, live non-production end-to-end validation, and authoritative live `13034`/locator-less correlation and retry semantics.
