# Travelport Stays transport constructor authority

## Scope

The credential-containment and tracing/target-policy transports are long-lived closures. They previously reread caller-owned credential objects for later OAuth and Stays requests. Mutation or accessor side effects after construction could change the identity being checked without rebuilding the provider. Reservation-write preflight also read the top-level credential source twice.

## Implemented behavior

Both transport constructors now snapshot the environment, transport function, and only the five declared Travelport credential fields into frozen, allowlisted objects. A missing credential object remains allowed only for the tracing wrapper's existing uncredentialed test/adapter mode; credential containment still requires a bound identity. Invalid containers, non-string credential fields, hostile getters, revoked proxies, and invalid fetch capabilities fail closed with a fixed `INVALID_REQUEST` before provider I/O.

OAuth form fields and Stays headers are checked against the captured constructor identity. The pre-provider reservation-write transport preflight reads caller credentials once, materializes all six fields including environment, and validates the exact request without network I/O. The real commercial POST remains independently validated after the durable provider-request marker.

Regression tests cover one-read getters, credential mutation, original versus changed OAuth form authority in both transport layers, hostile inputs, and the preflight source read. Full Node 24/Prisma/PostgreSQL validation remains subject to the repository's external environment gates.

This change does not enable Travelport reservation capability, add a payment-card source, or resolve live non-production provider and locator-less recovery requirements.

The connected terminal operational logger also pins its tenant/integration/credential-version/environment attribution at construction. It retains its existing safe UUID/version fallbacks and fail-open log-sink behavior. This is diagnostic context only, never tenant authorization or supplier-write authority.
