# Public payment HTTP boundary

The public hospitality payment endpoints use the shared same-origin JSON policy before capability-owned payment work begins.

Stripe Checkout creation uses an 8 KiB request ceiling. The route rejects an empty booking capability and capabilities longer than 4,096 characters, and normalizes the browser request key with the shared UUID-v4 public-booking validator before invoking the Checkout service. Return URLs remain server-derived.

The public payment receipt route uses the same 8 KiB and 4,096-character capability limits. It now emits the same bounded request-correlation response metadata used by reviewed production routes, using operation `public-payment.receipt.read`. The completion record carries no tenant, booking, capability, provider, request-key, URL, or payment selector.

Unexpected Checkout failures are not classified as client validation by matching arbitrary error-message text. Typed request-key failures return `invalid-request`; other unexpected failures use the generic internal-error boundary. Provider-specific behavior remains behind the payment integration and adapter layers.

Dependency-free source contracts cover the Checkout ingress and error boundary. Full typecheck, lint, Prisma, build, and database validation remain subject to the repository Node 24 toolchain and an explicitly disposable PostgreSQL target where required. GitHub Actions are not used.
