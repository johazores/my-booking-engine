# Hospitality partial-refund evidence integrity

The persisted hospitality payment status `PARTIALLY_REFUNDED` must represent a real successful refund, not merely a net payment below the booking total.

`deriveBookingPaymentStatusFromSettlementTransactions` first reconciles the complete successful settlement ledger and checks for received money. When the derived net state would be `PARTIALLY_REFUNDED`, it additionally requires positive successful source-attributed refund evidence. Partial captures or offline payments without refunds fail closed rather than being misclassified as a completed refund.

The lower-level `deriveBookingPaymentStatusFromNetSettlement` remains an arithmetic helper. It does not claim that a payment/refund lifecycle occurred without ledger evidence. Normal hospitality refund execution must still independently verify its persisted booking status, settlement source, and refund authority.

Rental payment states are intentionally distinct: `PARTIALLY_PAID` represents genuine partial funding without a refund. The rental-specific settlement domain preserves that state, and rental manual refunds may be recorded against actual received money before full payment. Do not reuse hospitality refund-state derivation to infer rental payment lifecycle state.

Regression coverage: `src/server/payments/payment-refund-evidence-integrity.test.ts`. The repository's full Node 24 and PostgreSQL validation gates remain separate.
