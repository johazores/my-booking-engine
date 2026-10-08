# Public payment recovery capability switching

The same-tab public payment recovery panel follows the active booking document capability. When a new booking replaces the active capability, the panel remounts and cannot display payment status, actions, or messages from the prior booking. This is a browser privacy boundary, not server authorization.

A live recovery capability also takes precedence over the legacy receipt fallback when no modern document slot exists. Checkout recovery storage is updated **before** notifying customer document views of the new capability. Otherwise the recovery panel could rehydrate an older booking and revert the active document authority during the new booking transition.

Both the payment-status request and Checkout resume request verify that their original capability is still active before applying a response, redirecting, clearing recovery, or showing an error. In-flight status checks also use a request generation counter, and unmounted panels ignore late results. The initial Checkout response from an older offer also cannot redirect away from a newly active booking. The server continues to independently verify the tenant slug, encrypted capability, public principal, persisted booking ownership, payment state, and provider evidence.

The dependency-free contract test in `scripts/public-booking-recovery-capability-switching-contract.test.mjs` guards the client lifecycle. Full Next.js/TypeScript and live PostgreSQL validation remains required in a Node 24 environment. No GitHub Actions are used.

The originating offer card also keys its payment-stage presentation to the capability returned by its own confirmation. If a different offer confirms a newer booking while an older Checkout request is still pending, the old card shows only a neutral current-reservation pointer rather than its stale payment state or recovery action. Late initial Checkout redirects remain blocked by the active capability check.
