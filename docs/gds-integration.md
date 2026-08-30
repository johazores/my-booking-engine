# GDS Integration

## Status

No GDS is connected yet. SF does not present a mock GDS integration as production functionality.

## Target providers

The architecture should be capable of supporting providers such as Amadeus, Sabre, Travelport, and future travel suppliers through adapters.

## Research rule

Before implementing a provider, verify its current authentication model, environment requirements, search/pricing workflow, booking/ticketing lifecycle, modification/cancellation support, rate limits, idempotency expectations, webhooks/callbacks, and certification/commercial requirements from current provider documentation.

## Normalization

The first provider implementation should define only the contract required by the current real workflow. The abstraction should then be refined based on actual differences discovered while implementing additional providers.

Do not build a massive plugin framework before the first real provider exists.
