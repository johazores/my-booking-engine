# Travelport Stays JSON request-body authority

## Production boundary

The two credentialed Travelport Stays transports now reject malformed JSON objects before delegating network I/O. Previously, checking only the leading and trailing object braces could allow an invalid body such as `{"broken":}` to pass the no-network supplier-write preflight and reach a provider request after its durable request marker.

Both the shared environment-bound trace transport and the terminal OAuth credential-containment transport retain their existing four-megabyte UTF-8 request limit, exact JSON content-type requirement, and object-envelope check. They additionally use the same pure JSON syntax/object-root guard. The guard rejects ill-formed raw UTF-16 and invalid JSON, never logs the body, and does not retain or return the parsed payload. It accepts valid nested JSON and well-formed non-BMP text. This is syntax validation only: schema, money, offer, traveler, and payment authority remain the responsibility of the existing provider-specific validators.

The no-network preflight composes both credentialed transports and therefore rejects deterministic malformed JSON before the durable supplier-write marker. The actual transport independently revalidates after the marker. A timeout or uncertain failure after a marked request remains ambiguous; this change does not authorize replay or prove a provider sell did not occur.

## Validation and activation

Focused TypeScript regression tests cover malformed object envelopes, trailing garbage, malformed nested arrays, valid nested bodies, both credentialed transports, and the no-network write preflight. Full Node 24 / TypeScript 6 repository tests, disposable PostgreSQL verification, and live Travelport non-production tests remain separate unverified gates in environments without those dependencies.

Travelport `reservation` remains unadvertised pending PCI-reviewed FormOfPayment/guarantee sourcing, live end-to-end supplier validation, and authoritative locator-less/`13034` recovery semantics.
