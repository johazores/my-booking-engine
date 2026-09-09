# GDS and external supplier integration

## Status

Travelport TripServices Stays is SF's first external hospitality supplier boundary. The repository contains tenant-owned encrypted configuration, connection testing, bounded SearchComplete discovery, exact-money pricing/revalidation, normalized v11 Rules, a SearchComplete-to-Availability selected-offer authority bridge, durable supplier reservation operations/attempts, known-locator Hotel Retrieve recovery, server-only Create Reservation, explicit commercial review, the one-time reviewed second Create, and Booking.com Sync recovery.

Server-only single-room Create Reservation and Booking.com Sync write executors/coordinators are also implemented behind the disabled `reservation` capability; no customer/staff reserve action is exposed.

The implemented Travelport contract was reviewed against current public Travelport documentation on 2026-09-08.

## Provider and tenant boundary

Provider-specific behavior remains under `src/server/suppliers/` and `src/server/integrations/`. Product/server callers use provider-neutral property, offer, terms, reservation-authority, durable-operation, and recovery contracts.

Operational supplier work requires server-side tenant authorization before credentials are loaded. Reservation writes additionally require `booking:manage`, exact organization ownership, an active Travelport integration, the same provider/credential version captured by the durable operation, and the `reservation` capability. The shared provider-request marker repeats that active-integration/provider/credential/capability check immediately before new provider I/O is marked.

Travelport currently advertises only `availability`, `hotel-search`, and `pricing`. `reservation` remains intentionally unadvertised, so the implemented supplier-write infrastructure is not product-reachable.

## Search, pricing, Rules, and selected-offer authority

SearchComplete discovery is bounded across supported continuation pages. Provider pagination and booking identifiers remain adapter-owned while product callers receive opaque SF references.

Pricing uses exact integer minor-unit money and no-cache revalidation. Offers have deterministic fingerprints and no trusted timeless TTL. Rules normalization captures payment/guarantee/cancellation/qualification evidence and a deterministic terms fingerprint; stale or mismatched commercial evidence fails closed.

The read-only selected-offer authority bridge remaps the exact selected SearchComplete rate through bounded v11 Availability for the same property, stay, occupancy, and rate evidence. It accepts exactly one matching Availability result and returns a deterministic provider-neutral authority fingerprint while the ephemeral provider submission identifier stays adapter-owned. Initial and reviewed Create repeat this authority chain immediately before supplier writes.

## Initial Create and reviewed second Create

The server-only initial Create coordinator repeats fresh offer, Rules, Availability, traveler, integration, and payment authority; claims the durable `CREATE` attempt; acquires one ephemeral payment card from the separate `TravelportStaysReservationPaymentCardSource`; and invokes the fixed Travelport v11 Create executor only after the provider-request marker succeeds.

The initial Create never sends `acceptPriceChangeInd` or `acceptGuaranteeChangeInd`. Documented price/guarantee no-sell outcomes enter `REVIEW_REQUIRED` and cannot use ordinary retry.

An authorized acceptance decision is persisted only after fresh commercial/traveler/integration/payment authority matches the exact reviewed attempt. The reviewed second-Create infrastructure is implemented server-side. Request construction, sensitive-card validation, accepted-query selection, and OAuth complete before a serializable provider-boundary transaction archives immutable acceptance history, binds exactly one next `CREATE` attempt, clears the active acceptance slot, and writes `providerRequestStartedAt`. Only after that commit can the external POST start, carrying only the explicitly accepted change flag or flags.

Normal retry cannot enter or reuse the reviewed-acceptance path. A later provider price/guarantee change begins a new review cycle while prior acceptance remains immutable history.

## Form-of-payment boundary

Travelport Create can require PAN/security-code data. SF's ordinary online-payment surfaces do not accept raw card data. Initial and reviewed Create therefore depend on a separate server-only `TravelportStaysReservationPaymentCardSource` capability whose context contains only tenant/reservation/integration/attempt identity and fixed purpose.

The interface is not a concrete PCI-safe implementation. A concrete reviewed PCI-safe FormOfPayment/guarantee source appropriate for the provisioned Travelport commercial account is still required before activation. PAN/CVV, cardholder/billing data, credentials, and tokens must stay out of Prisma, logs, audits, analytics, queues, request fingerprints, and ordinary browser/API payloads.

## Travelport PNR-locator authority

Stays reservation responses contain several locator families. SF treats a durable provider reservation reference as valid only when the receipt locator has both `sourceContext=Travelport` and `locatorType=PNR Locator`.

A Travelport-context locator of another type cannot confirm Create, Sync, or known-locator recovery. It is ignored for provider-reservation authority and does not create false duplicate-PNR ambiguity when one valid Travelport PNR Locator is present.

Supplier confirmation remains a separate semantic field and is accepted only from `sourceContext=Supplier` plus `locatorType=Confirmation Number`. Supplier PIN, cancellation-number, agency IATA, and other locator families are not relabeled.

Relevant PNR and supplier-confirmation receipt cardinality is evaluated before commercial confirmation authority. A malformed relevant locator, an unconfirmed relevant receipt, or a duplicate relevant receipt cannot be filtered away beside otherwise valid evidence.

## Booking.com Sync and locator-less ambiguity

For the documented Booking.com supplier-confirmed/no-PNR warning path, SF can stage Sync authority only when the response proves the exact durable stay, one confirmed Booking.com supplier Confirmation Number, source `BO`, matching offer authority, and no Travelport PNR Locator receipt at all. A pending, cancelled, rejected, or malformed relevant PNR receipt is contradictory evidence rather than proof of locator-less state.

Booking.com Sync uses its own `RECOVERY_WRITE` attempt/provider marker and sends no form-of-payment. It confirms only when the exact stay, original supplier confirmation, and exactly one confirmed Travelport PNR Locator receipt return without conflicting relevant receipt evidence.

The separate `13034` error does not invent supplier confirmation or Sync authority. Locator-less uncertainty remains `AMBIGUOUS` until verified provider semantics establish a safe recovery action.

## Known-locator recovery and negative evidence

Known-locator recovery uses Travelport Hotel `GET book/reservations/{AggregatorLocatorCode}` and requires exactly one valid Travelport PNR Locator receipt matching the durable locator plus the expected property/stay/room/guest identity. Repeated identical PNR receipts and malformed relevant PNR evidence fail closed rather than being silently collapsed.

Travelport's public Retrieve reference does not establish generic HTTP 404 as authoritative proof that the exact reservation does not exist. Generic HTTP 404 is therefore not authoritative negative evidence in SF; it normalizes to unknown/invalid response and cannot authorize another Create.

Provider-neutral `NOT_FOUND` remains available only for an adapter with independently verified authoritative exact-locator negative semantics.

## Transport security, privacy, and validation

Travelport OAuth/Stays endpoints are fixed constants selected from validated integration environment. Credential-bearing requests use `redirect: 'manual'`; unexpected redirects fail rather than replaying credentials to another origin.

Provider observations and durable operation state exclude raw request/response bodies, traveler PII, payment-card data, credentials, tokens, provider free text, and secrets.

Checked-in tests cover discovery/pagination, auth-before-credentials, pricing/revalidation, Rules, Availability authority, idempotency/state/privacy, provider-request ordering, Create/Sync outcomes, review acceptance/consumption, PNR-locator identity, known-locator recovery, relevant receipt cardinality/status/malformed evidence, generic-404 fail-closed behavior, redirect suppression, and disabled product reservation capability.

Live activation remains blocked on:

1. a concrete reviewed PCI-safe FormOfPayment/guarantee source;
2. live non-production SearchComplete → Rules → Availability → initial Create → reviewed second Create → Sync/recovery validation;
3. authoritative live `13034`, negative-lookup, locator-less correlation, and retry/recovery semantics; and
4. product/API orchestration only after `reservation` is deliberately enabled.

Full repository validation additionally requires the supported Node 24/TypeScript/Prisma toolchain and an explicitly disposable PostgreSQL target.

See `docs/travelport-stays-integration.md`, `docs/supplier-reservation-operations.md`, `docs/supplier-reservation-review-acceptance.md`, and `docs/travelport-reservation-response-evidence.md`.

## References

- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Availability.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_RulesFullPayload.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Retrieve.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Sync.htm
