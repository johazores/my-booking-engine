# Integration Architecture

## Principle

SF owns a normalized internal domain. External services are implementations behind provider contracts.

```text
application
  ↓
domain
  ↓
provider contract
  ↓
adapters
  ├── internal inventory
  ├── GDS / supplier
  ├── payments
  ├── email
  └── SMS
```

No external provider is implemented in the reset foundation.

## Capability model

A provider should advertise only the capabilities it actually supports, for example:

- flight-search
- hotel-search
- availability
- pricing
- reservation
- ticketing
- modification
- cancellation
- refund
- webhooks

The application must not force identical behavior across providers that expose different capabilities.

## Tenant configuration

Future integration records belong to an organization and will store provider type, status, capabilities, non-secret configuration, and encrypted credentials. Stored secrets must never be displayed back in plaintext.

The master encryption key must remain outside the database row containing encrypted credentials and should be replaceable by a managed secret/key service later without changing booking business logic.

## Failure model

Adapters must classify timeouts, authentication errors, rate limits, invalid requests, supplier outages, price changes, availability changes, partial failures, and duplicate callbacks into safe application-level errors.
