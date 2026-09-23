# Tenant access collection pagination

SF treats organization access and membership directories as potentially large tenant-owned collections. Authenticated account and dashboard surfaces must not materialize an unbounded organization or membership list merely because most tenants are currently small.

## Organization access list

`listOrganizationsForUserPage` is the account-facing organization collection boundary. It reuses `activeOrganizationMembershipScope`, so only active organizations backed by an active membership and active user principal are eligible. The reader normalizes page input server-side, caps page size at 50, counts the scoped result, and reads only the requested deterministic `name` + `id` page.

The legacy complete `listOrganizationsForUser` repository function remains for existing isolation coverage and narrow internal callers, but it now has a hard 1,000-row complete-read ceiling and fails closed above that limit. New product surfaces should use the paginated reader.

## Organization membership directory

`listMembershipsForOrganizationPage` repeats the central `activeTenantOwnedCollectionScope` on both the count and page query. This preserves active actor, active membership, organization ownership, and tenant isolation at the database query boundary. Page size is capped at 50 and rows use deterministic `createdAt` + `id` ordering.

The account workspace renders 20 members per page while preserving role/status controls on each visible row. Pagination links are ordinary server-rendered links with accessible navigation labels and retain the other tenant-access collection page when moving between organization or member pages.

The legacy complete `listMembershipsForOrganization` repository function is retained for the PostgreSQL tenant-isolation harness, but it now fails closed above 1,000 rows instead of becoming an unbounded production precedent.

## Dashboard aggregates

The dashboard does not need member identities to render team counts. `readOrganizationMembershipStats` therefore issues tenant-scoped counts for total and active memberships instead of loading every membership and filtering in application memory. Actors without `membership:read` still receive no membership aggregate.

## Safety rules

- Pagination normalization is server-side; invalid, negative, fractional, and oversized page inputs cannot create arbitrary database work.
- Organization access remains user-scoped through `activeOrganizationMembershipScope`.
- Membership pages and counts remain tenant/actor scoped through `activeTenantOwnedCollectionScope`.
- Page-size ceilings are repository rules, not UI-only conventions.
- Stable secondary ID ordering prevents ambiguous page order when names or timestamps are equal.
- Mutation authorization is unchanged; paging never grants membership or role-management capability.

This work advances the platform-wide rule to continue enforcing pagination on future large collections. It does not mark that ongoing invariant complete for all future code.
