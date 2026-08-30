# My Booking Engine

My Booking Engine is being rebuilt as a production booking platform foundation rather than a prototype.

## Current implemented slice

The current flight-search flow now uses a provider contract and application service instead of calling the supplier directly from the page. Provider responses are normalized before reaching the UI, validation is centralized, and supplier failures return safe application errors.

Multitenancy, authentication, persistent inventory, payments, and booking lifecycle management are not implemented yet and must not be treated as complete.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Add a valid RapidAPI key to `RAPID_API_KEY`.
3. Install dependencies with `yarn`.
4. Run `yarn dev`.

Never commit local environment files or credentials.

## Documentation

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/integration-architecture.md`](docs/integration-architecture.md)
- [`docs/product-roadmap.md`](docs/product-roadmap.md)
