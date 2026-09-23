# Integration collection pagination

SF treats provider integrations as tenant-owned control-plane records. Product surfaces must not load every integration merely to render known provider cards or a secondary provider directory.

## Featured provider reads

The integrations workspace reads Stripe and Travelport Stays by exact `(organizationId, providerCode)` identity through `readIntegrationByProviderCode`. The service repeats `integration:read` authorization, normalizes the provider code, uses the tenant/provider compound key, and reads only the latest matching connection-test audit event needed for the public health snapshot.

Exact provider reads return only `publicIntegrationRecord`; encrypted credentials never leave the server credential boundary.

## Other provider directory

`listIntegrationsPage` is the collection boundary for provider directories. It:

- repeats `integration:read` authorization before any database access;
- always scopes rows and counts by `organizationId`;
- supports normalized provider-code exclusions so featured provider cards are not duplicated in the secondary list;
- defaults to 20 rows and caps requested page size at 50;
- uses deterministic `providerCode` + `id` ordering;
- clamps out-of-range pages after the scoped count; and
- reads connection health only for the bounded page of integration rows.

The integrations page uses 20-row server pagination for non-featured providers while Stripe and Travelport Stays remain exact reads. The configured count is derived from the paginated non-featured total plus the two exact featured records, so the UI does not need an additional whole-collection read.

## Legacy complete reader

`listIntegrations` remains available for existing persistence/isolation coverage and narrow complete-read callers. It is no longer unbounded: the query requests at most 1,001 rows and fails closed above the 1,000-row complete-read safety limit. New product collection screens should use `listIntegrationsPage` instead.

## Safety rules

- Integration reads remain tenant- and actor-authorized server-side.
- Provider credentials remain encrypted and are never included in public integration records.
- Pagination limits are enforced in the service, not only in UI controls.
- Excluded provider codes are normalized with the same provider-code contract used for writes and exact reads.
- Stable secondary ID ordering prevents ambiguous page boundaries.
- Connection-test health reads are bounded by the selected page size.
- Provider-specific runtime behavior remains behind its existing adapter/runtime boundaries; this pagination change only affects control-plane record retrieval.

This advances the platform-wide pagination requirement for large tenant-owned collections. It does not mark that cross-cutting invariant complete for future collection surfaces.
