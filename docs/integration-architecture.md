# Integration Architecture

## Principle

External providers sit behind small capability-based contracts. Core application code should use normalized models and must not depend directly on RapidAPI, Amadeus, Sabre, Travelport, payment processors, or other suppliers.

## Flight search

The current provider contract exposes only the capability that is actually implemented: `flight-search`.

The RapidAPI adapter is responsible for:

- Reading provider credentials from server environment variables.
- Building the provider-specific request.
- Applying a request timeout.
- Classifying authentication, rate-limit, timeout, upstream, and invalid-response failures.
- Normalizing supplier itineraries into the internal `FlightOffer` model.

Provider credentials are never returned to clients or included in application errors.

## Credential storage

The current provider is configured at the server level because tenant integration storage does not exist yet. When tenant integrations are implemented, encrypted tenant credentials should move into database-managed integration records while the application/provider contract remains unchanged.

The master encryption key must remain outside the database record and outside source control.
