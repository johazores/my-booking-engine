-- Normalize final PostgreSQL object names that were historically authored above
-- PostgreSQL's 63-byte identifier boundary. The legacy names are referenced by
-- their actual stored (truncated) identifiers so this migration works both on a
-- fresh chain and on databases that already applied the earlier migrations.

ALTER INDEX "rental_damage_settlement_transactions_org_provider_reference_ke"
  RENAME TO "rental_damage_settlement_org_provider_ref_key";

ALTER INDEX "rental_late_return_settlement_transactions_org_provider_referen"
  RENAME TO "rental_late_return_settlement_org_provider_ref_key";

ALTER INDEX "rental_late_return_settlement_transactions_org_assessment_kind_"
  RENAME TO "rental_late_return_settlement_org_assessment_kind_key";

ALTER INDEX "rental_booking_effective_refund_transactions_org_idempotency_ke"
  RENAME TO "rental_effective_refund_org_idempotency_key";

ALTER INDEX "rental_booking_effective_refund_transactions_org_provider_refer"
  RENAME TO "rental_effective_refund_org_provider_ref_key";

ALTER INDEX "rental_booking_effective_refund_transactions_booking_created_id"
  RENAME TO "rental_effective_refund_booking_created_idx";

ALTER INDEX "rental_booking_effective_refund_transactions_source_reference_i"
  RENAME TO "rental_effective_refund_source_reference_idx";

ALTER TRIGGER "rental_damage_settlement_transactions_cross_scope_reference_gua"
  ON "rental_damage_settlement_transactions"
  RENAME TO "rental_damage_settlement_cross_scope_reference_guard";

ALTER TRIGGER "rental_late_return_settlement_transactions_cross_scope_referenc"
  ON "rental_late_return_settlement_transactions"
  RENAME TO "rental_late_return_settlement_cross_scope_reference_guard";

ALTER TRIGGER "rental_booking_commercial_amendment_settlement_transactions_cro"
  ON "rental_booking_commercial_amendment_settlement_transactions"
  RENAME TO "rental_amendment_settlement_cross_scope_reference_guard";

ALTER TRIGGER "rental_booking_effective_refund_transactions_cross_scope_refere"
  ON "rental_booking_effective_refund_transactions"
  RENAME TO "rental_effective_refund_cross_scope_reference_guard";

ALTER TRIGGER "rental_late_return_settlement_transactions_register_manual_refe"
  ON "rental_late_return_settlement_transactions"
  RENAME TO "rental_late_return_settlement_register_manual_reference";

ALTER TRIGGER "rental_booking_commercial_amendment_settlement_transactions_reg"
  ON "rental_booking_commercial_amendment_settlement_transactions"
  RENAME TO "rental_amendment_settlement_register_manual_reference";

ALTER TRIGGER "rental_booking_effective_refund_transactions_register_manual_re"
  ON "rental_booking_effective_refund_transactions"
  RENAME TO "rental_effective_refund_register_manual_reference";

ALTER TRIGGER "rental_bookings_prepared_commercial_amendment_cancellation_guar"
  ON "rental_bookings"
  RENAME TO "rental_bookings_prepared_amendment_cancel_guard";
