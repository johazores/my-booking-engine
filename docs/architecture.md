# Architecture

## Product direction

This repository is the foundation of a production booking SaaS. The long-term architecture must support tenant isolation, white-label configuration, internal inventory, provider integrations, booking lifecycle management, payments, and auditability without making the core domain depend on one supplier.

## Current implemented foundation

The first production-oriented slice establishes a normalized flight-search boundary:

```text
UI / API
  ↓
search-flights application service
  ↓
flight-search provider contract
  ↓
RapidAPI / Skyscanner adapter
```

The page and API no longer need to know the supplier response format. Supplier-specific request construction, authentication headers, timeout behavior, failure classification, and response normalization live in the adapter.

## Current limitations

The repository does not yet have a database, tenant model, authentication, authorization, internal inventory, payments, or a persisted booking lifecycle. These are intentionally documented as incomplete rather than represented by placeholder screens.

## Next architectural dependency

The next highest-value foundation is the database and tenant model. It should introduce organization-owned data and server-enforced tenant scope before tenant management or booking records are added.
