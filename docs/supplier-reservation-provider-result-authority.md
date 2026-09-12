# Supplier reservation provider-result authority

## Purpose

Fresh supplier revalidation is commercial write authority. Initial Create, explicit commercial-review acceptance, and accepted-review consumption all depend on provider results returned after asynchronous SearchComplete, Rules, and Availability work. Those results must not remain caller/provider-owned mutable JavaScript objects while SF compares them, derives payment authority, persists acceptance evidence, or claims a durable external sell.

`hospitality-supplier-reservation-provider-result-authority.ts` adds a provider-neutral one-read materialization boundary for the exact commercial evidence those write paths consume.

## Allowlisted snapshots

The boundary copies only the fields required to prove the current reservation selection:

- provider result status;
- supplier property and offer references;
- offer fingerprint and exact currency/total;
- Rules supplier references, terms fingerprint, completeness/revalidation flags, payment timing, guarantee types, deposit money, accepted card codes, and exact currency/total;
- Availability authority fingerprint, ephemeral provider submission reference, observation time, and revalidation flag.

Arrays and nested money objects are copied and frozen. Extra provider properties are not copied. Raw provider payloads, request/response bodies, credentials, tokens, traveler/customer data, supplier confirmations, locators, PAN/CVV, cardholder data, and other sensitive fields are outside this authority object.

Throwing accessors, revoked proxies, unsupported runtime statuses, malformed nested objects, oversized commercial arrays, and type-invalid commercial fields fail through a fixed `INVALID_RESPONSE` provider error. Caller-controlled exception text is not rethrown.

## Commercial consistency

The materializer is intentionally not the only semantic check. The write services still compare each frozen snapshot with durable tenant-owned reservation evidence.

Commercial-review acceptance now rejects a fresh `OFFER_CHANGED` result instead of treating an unrelated offer mutation as an acceptable price/guarantee decision. A fresh price change is accepted only when it exactly matches the pending price-change dimension; unchanged price remains required when price acceptance was not requested.

Accepted-review consumption is stricter: the fresh offer revalidation must be `UNCHANGED` against the already accepted offer fingerprint and total before a one-time reviewed second Create can continue.

Both acceptance and consumption also require Rules and final Availability booking terms to repeat the exact supplier property/offer identity, exact currency/total, and `revalidationRequired=true`. This mirrors the initial Create authority check and prevents inconsistent nested Rules evidence from becoming payment or durable acceptance authority.

## Tenant and authorization boundary

Provider-result materialization does not replace authorization. The existing services still require server-side availability/pricing/booking permissions, exact organization-scoped reservation reads, active Travelport integration identity and credential version, the disabled-by-default `reservation` capability, traveler fingerprint continuity, durable review-attempt authority, and serializable/advisory-lock protection for accepted evidence and provider-request consumption.

The new boundary only guarantees that all checks after a provider call see the same frozen commercial result.

## Activation boundary

Travelport `reservation` remains deliberately disabled. This runtime hardening does not satisfy the remaining production gates: a concrete reviewed PCI-safe FormOfPayment/guarantee source, provisioned live non-production end-to-end validation, and authoritative live `13034` / locator-less correlation and retry semantics.

Local/manual validation is used for this repository. GitHub Actions are not used.
