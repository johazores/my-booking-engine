# Customer collection pagination boundary

The customer directory is a tenant-owned collection and must enforce its limits in the server repository, not only in URL/query parsing.

`listCustomersForOrganization` now normalizes pagination before the count/query pair:

- invalid or non-positive pages become page 1;
- invalid page sizes default to 20;
- page sizes are capped at 50 using the customer-domain limit;
- the tenant/status/search scope is identical for the count and row query;
- out-of-range pages clamp to the final available page;
- ordering remains deterministic for every supported customer sort; and
- the response exposes the normalized `pageSize` together with page totals.

Customer activity is not an unbounded collection: its existing caller-controlled limit remains clamped to 1-100 events and tenant/customer scoped.

This boundary is defense in depth. Route parsing may normalize browser input for UX, but repository callers cannot bypass collection limits by supplying oversized values directly.
