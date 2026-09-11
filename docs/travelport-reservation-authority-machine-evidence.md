# Travelport reservation authority machine evidence

## Purpose

SF's disabled Travelport reservation path performs a fresh SearchComplete request and a v11 Availability request immediately before supplier reservation authority can become `READY`. That path is deliberately separate from ordinary property/offer display because it establishes the exact commercial evidence that initial Create and reviewed Create must revalidate before a sell.

Provider identifiers used by this boundary are machine evidence, not presentation text. Successful provider responses also carry structural authority: malformed JSON, missing result envelopes, or contradictory pagination metadata must not reach the compatibility parser and become sell evidence indirectly.

## Hardened adapter boundary

`travelport-stays-reservation-authority-provider.ts` is the public reservation-authority adapter. The prior implementation is preserved behind `travelport-stays-reservation-authority-provider-core.ts`, matching the compatibility pattern already used by the public SearchComplete and Rules adapters.

All production imports continue through the public adapter. Before the compatibility core receives a request, the adapter requires the selected property and offer references to pass the canonical base64url authority checks already used by pricing and Rules. The reservation-authority cache identity is also exact, bounded, and rejects the full ASCII control range.

The wrapped provider transport inspects successful Travelport hotel responses before the compatibility core can normalize them. Successful reservation-authority responses must parse as JSON and expose the required provider envelopes before any machine evidence can be accepted. The guard also applies the compatibility path's collection ceilings before traversing SearchComplete and Availability arrays, so malformed oversized provider payloads fail closed without an unbounded authority-validation sweep.

## SearchComplete authority

The fresh SearchComplete request is an exact-property lookup for the already selected property. The compatibility core already requires exactly one returned property before it can select the reviewed rate. The outer authority guard now independently binds that expectation to the successful provider envelope before compatibility parsing:

- `pagination.page` must be `1`;
- `pagination.pageSize` must be `1`;
- `pagination.totalPages` must be `1`;
- `pagination.totalItems` must be `1`;
- `paginationToken` must be absent; and
- `hotelsResponse.propertyItems` must contain exactly one property.

This is consistent with Travelport's current SearchComplete response contract and documented one-property SearchComplete example, where page 1 reports one returned/total property and no continuation token. SF does not reinterpret a multi-page, empty, or continuation-bearing response as authority for the exact selected property.

The fresh SearchComplete response is also checked at the machine fields that can influence reservation authority:

- property chain and property codes;
- rate-key value and authority;
- booking code;
- rate code, rate-plan ID, and rate category;
- canonical uppercase three-letter price currency; and
- total-price amount when Travelport returns it as a string.

String machine values must already be non-empty, bounded, free of leading/trailing whitespace, and free of ASCII controls `U+0000` through `U+001F` and `U+007F`. Money strings follow the same exact-text rule before the existing exact-money parser sees them. Numeric money remains subject to the existing finite/exact-money validation in the compatibility core.

## Availability authority

A successful v11 Availability authority response must expose a record root containing `CatalogOfferingsHospitalityResponse.CatalogOfferings`. Missing or malformed envelopes fail closed before the existing pagination and selected-offer parser can interpret the body.

The Availability response is then checked before any offer can become the provider submission reference used by Create. The guard covers:

- the Availability pagination identifier;
- each catalog-offering `id` and `Identifier.value`/authority;
- rate-code/rate-ID/rate-category evidence;
- product booking code;
- property chain/property codes; and
- stay start/end dates.

The stay dates must already be canonical valid local dates. Pagination and catalog-offering identifiers are exact bounded machine tokens. A value such as `" offer-123 "`, `"THR\t"`, or a control-bearing property code is an invalid provider response rather than a value SF trims into sell authority.

This matters because `Identifier.value` can become the ephemeral provider submission reference. The reference remains excluded from the stable authority fingerprint, but its exact spelling must still be trustworthy for the immediate provider write.

## Scope and compatibility

Human-readable hotel descriptions and other presentation text are outside this contract. Non-success provider responses continue through the existing provider-neutral failure classification, and unrelated/non-authority traffic is not reinterpreted by this response guard.

Tenant authorization is unchanged. The provider-neutral reservation-authority service still verifies organization scope and `availability:read`, `pricing:read`, and `booking:manage` before Travelport credentials are loaded. This provider-specific adapter only hardens Travelport evidence after those server-side ownership and permission gates.

No persistence schema change is required. Durable supplier reservation references already have the separate exact machine-token database and service boundary; this change closes the upstream pre-write authority gap before those durable writes are possible.

## Validation

Focused executable coverage checks canonical SearchComplete/Availability responses, required successful-response JSON/envelopes, exact single-property SearchComplete pagination authority, bounded collection limits, padded and control-bearing booking/rate/property identifiers, non-canonical currency and money strings, Availability pagination/sell references, stay dates, cache identity, non-success responses, and unrelated non-authority traffic.

A dependency-free source contract pins the successful-response JSON/envelope guards, exact one-property SearchComplete page authority, Availability envelope requirement, and the documentation/activation boundary. The similar-issue sweep confirms the active SearchComplete adapter already has its independent successful-response envelope guard; Create, Sync, and known-locator recovery parse failures feed strict outcome/recovery classifiers rather than silently authorizing a reservation.

Full repository validation still requires the repository-supported Node 24.20+ / TypeScript 6 dependency environment. Live behavior still requires provisioned Travelport non-production credentials.

## Activation boundary

Travelport `reservation` remains deliberately unadvertised. This hardening does not satisfy the remaining Phase 15 activation gates:

1. provision and review a concrete PCI-safe FormOfPayment/guarantee source for the provisioned Travelport account;
2. complete live non-production SearchComplete → Rules → Availability → initial Create → reviewed Create → Sync/recovery verification; and
3. establish authoritative live `13034` and locator-less recovery/correlation semantics.

Related contracts:

- `docs/travelport-stays-reference-authority.md`
- `docs/travelport-reservation-property-reference-authority.md`
- `docs/travelport-stays-pagination-metadata-authority.md`
- `docs/travelport-stays-integration.md`
- `docs/supplier-reservation-machine-token-authority.md`
