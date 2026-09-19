import Link from 'next/link';

import { readAuthSessionState } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import {
  readRentalBookingEffectiveSettlement,
  RentalBookingEffectiveSettlementUnavailableError,
} from '@/server/bookings/rental-booking-effective-settlement-service.ts';
import {
  readRentalOriginalPaymentLedgerAuthority,
  RentalPaymentUnavailableError,
} from '@/server/payments/rental-payment-service.ts';
import type { RentalPaymentSettlement } from '@/server/payments/rental-payment-domain.ts';
import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

type RentalPaymentTransactionView = Readonly<{
  id: string;
  kind: string;
  status: string;
  providerCode: string;
  providerReference: string;
  sourceProviderReference: string | null;
  currency: string;
  amountMinor: bigint;
  createdAt: Date;
}>;

export async function RentalBookingPaymentPanel({
  bookingId,
  bookingStatus,
  bookingCurrency,
  settlement,
  transactions,
  canManage,
}: Readonly<{
  bookingId: string;
  bookingStatus: string;
  bookingCurrency: string;
  settlement: RentalPaymentSettlement;
  transactions: readonly RentalPaymentTransactionView[];
  canManage: boolean;
}>) {
  let ledgerAuthority: Awaited<ReturnType<typeof readRentalOriginalPaymentLedgerAuthority>> | null = null;
  let effectiveSettlementData: Awaited<ReturnType<typeof readRentalBookingEffectiveSettlement>> | null = null;
  const authState = await readAuthSessionState();
  if (authState.session) {
    const activeContext = await readActiveOrganizationContext(authState.session.user.id);
    if (activeContext.organization) {
      try {
        ledgerAuthority = await readRentalOriginalPaymentLedgerAuthority({
          organizationId: activeContext.organization.id,
          actorUserId: authState.session.user.id,
          bookingId,
        });
      } catch (error) {
        if (
          !(error instanceof RentalPaymentUnavailableError)
          && !(error instanceof OrganizationPermissionDeniedError)
        ) throw error;
      }

      if (ledgerAuthority?.amendment?.status === 'APPLIED') {
        try {
          effectiveSettlementData = await readRentalBookingEffectiveSettlement({
            organizationId: activeContext.organization.id,
            actorUserId: authState.session.user.id,
            bookingId,
          });
        } catch (error) {
          if (
            !(error instanceof RentalBookingEffectiveSettlementUnavailableError)
            && !(error instanceof OrganizationPermissionDeniedError)
          ) throw error;
        }
      }
    }
  }

  const appliedAmendmentId = ledgerAuthority?.amendment?.status === 'APPLIED'
    ? ledgerAuthority.amendment.id
    : null;
  const effectiveSettlement = appliedAmendmentId
    && effectiveSettlementData?.appliedAmendment?.id === appliedAmendmentId
    && (
      effectiveSettlementData.settlement.reconciled === false
      || effectiveSettlementData.settlement.appliedAmendment?.id === appliedAmendmentId
    )
      ? effectiveSettlementData.settlement
      : null;
  const originalLedgerWritable = ledgerAuthority?.writable === true;
  const confirmed = bookingStatus === 'CONFIRMED';
  const canRecordPayment = confirmed && originalLedgerWritable && settlement.reconciled && settlement.outstandingMinor > 0n && canManage;
  const canRefund = confirmed && originalLedgerWritable && settlement.reconciled && settlement.netSettledMinor > 0n && canManage;
  const outstandingAmount = settlement.reconciled ? settlement.outstandingMinor : 0n;
  const refundableAmount = settlement.reconciled ? settlement.netSettledMinor : 0n;
  const nextRefundableSourceAmount = settlement.reconciled ? settlement.nextRefundableSourceMinor : 0n;
  const settlementStatus = appliedAmendmentId
    ? effectiveSettlement?.reconciled === true
      ? effectiveSettlement.fullyRefunded
        ? 'REFUNDED'
        : effectiveSettlement.fullyFunded
          ? 'PAID'
          : 'PARTIALLY REFUNDED'
      : 'RECONCILIATION REQUIRED'
    : settlement.reconciled
      ? settlement.paymentState
      : 'RECONCILIATION REQUIRED';

  return <section className="sf-inventory-card" aria-labelledby="rental-payment-title">
    <div className="sf-inventory-card__heading">
      <div><p className="sf-eyebrow">Payment settlement</p><h2 id="rental-payment-title">{appliedAmendmentId ? 'Rental effective settlement' : 'Rental payment history'}</h2></div>
      <span>{settlementStatus}</span>
    </div>

    {appliedAmendmentId ? effectiveSettlement?.reconciled === true ? <ul className="sf-inventory-list">
      <li><div className="sf-inventory-list__primary"><div><strong>Effective accepted total</strong><span>{moneyMinorToMajorString(effectiveSettlement.effectiveAcceptedTotalMinor, effectiveSettlement.currency)} {effectiveSettlement.currency}</span><span>Current effective net {moneyMinorToMajorString(effectiveSettlement.currentNetSettledMinor, effectiveSettlement.currency)} · refund remaining before cancellation {moneyMinorToMajorString(effectiveSettlement.cancellationRefundRemainingMinor, effectiveSettlement.currency)}</span></div></div></li>
      <li><div className="sf-inventory-list__primary"><div><strong>Applied commercial amendment</strong><span>{effectiveSettlement.appliedAmendment?.direction === 'ADDITIONAL_CHARGE' ? 'Increase' : 'Decrease'} {moneyMinorToMajorString(effectiveSettlement.appliedAmendment?.deltaMinor ?? 0n, effectiveSettlement.currency)} {effectiveSettlement.currency} · amendment <code>{appliedAmendmentId}</code></span></div></div></li>
      <li><div className="sf-inventory-list__primary"><div><strong>Original booking-time money</strong><span>Accepted total {moneyMinorToMajorString(effectiveSettlement.originalBookingTotalMinor, effectiveSettlement.currency)} · original ledger net {moneyMinorToMajorString(effectiveSettlement.originalBookingNetSettledMinor, effectiveSettlement.currency)} · retained as historical source evidence</span></div></div></li>
    </ul> : <p className="sf-alert sf-alert--error" role="alert">{effectiveSettlement?.reconciled === false
      ? effectiveSettlement.reason
      : 'Effective rental settlement could not be verified from protected retained evidence. The original booking-price ledger is not current financial authority after an applied amendment.'}</p> : !settlement.reconciled ? <p className="sf-alert sf-alert--error" role="alert">{settlement.reason}</p> : <ul className="sf-inventory-list">
      <li><div className="sf-inventory-list__primary"><div><strong>Original booking-price ledger</strong><span>Net settled {moneyMinorToMajorString(settlement.netSettledMinor, bookingCurrency)} · outstanding {moneyMinorToMajorString(settlement.outstandingMinor, bookingCurrency)} · gross {moneyMinorToMajorString(settlement.grossSettledMinor, bookingCurrency)} · refunded {moneyMinorToMajorString(settlement.refundedMinor, bookingCurrency)}</span></div></div></li>
    </ul>}

    {ledgerAuthority?.writable === false ? <div className="sf-alert sf-alert--error" role="alert">
      <strong>Original booking-price writes are frozen.</strong> {ledgerAuthority.reason}
      {ledgerAuthority.amendment ? <span> <Link href={`/inventory/rentals/bookings/${encodeURIComponent(bookingId)}/commercial-amendments/${encodeURIComponent(ledgerAuthority.amendment.id)}`}>{ledgerAuthority.amendment.status === 'APPLIED' ? 'Open effective settlement' : 'Open commercial amendment'}</Link>.</span> : null}
    </div> : null}
    {!ledgerAuthority && canManage ? <p className="sf-field-hint">Original booking-price write authority could not be verified, so no payment or refund action is exposed. Refresh after confirming tenant and payment access.</p> : null}

    {appliedAmendmentId ? <p className="sf-field-hint"><strong>Original booking-price transaction history.</strong> These rows remain immutable source evidence. Commercial adjustment and post-apply refund evidence are retained in the effective-settlement workspace linked above.</p> : null}
    {transactions.length > 0 ? <ul className="sf-inventory-list">
      {transactions.map((transaction) => <li key={transaction.id}><div className="sf-inventory-list__primary"><div><strong>{transaction.kind.replaceAll('_', ' ').toLowerCase()} · {transaction.status.toLowerCase()}</strong><span>{transaction.currency} {moneyMinorToMajorString(transaction.amountMinor, transaction.currency)} · {transaction.providerCode} · <code>{transaction.providerReference}</code></span>{transaction.sourceProviderReference ? <span>Refund source <code>{transaction.sourceProviderReference}</code></span> : null}<span><time dateTime={transaction.createdAt.toISOString()}>{transaction.createdAt.toISOString()}</time></span></div></div></li>)}
    </ul> : <p className="sf-field-hint">No payment transaction has been recorded for this rental booking.</p>}

    {canRecordPayment ? <form className="sf-inventory-form" method="post" action={`/api/inventory/rentals/bookings/${encodeURIComponent(bookingId)}/payments/manual`}>
      <label className="sf-field"><span>Payment amount ({bookingCurrency})</span><input name="amount" type="text" inputMode="decimal" pattern="[0-9]+(?:\.[0-9]+)?" defaultValue={moneyMinorToMajorString(outstandingAmount, bookingCurrency)} required autoComplete="off" aria-describedby="rental-payment-amount-hint" /></label>
      <p id="rental-payment-amount-hint" className="sf-field-hint">Enter a positive amount up to the current outstanding balance of {moneyMinorToMajorString(outstandingAmount, bookingCurrency)} {bookingCurrency}. Multiple real manual/offline receipts may settle the booking over time.</p>
      <label className="sf-field"><span>Offline payment reference</span><input name="reference" type="text" maxLength={120} required autoComplete="off" aria-describedby="rental-payment-reference-hint" /></label>
      <p id="rental-payment-reference-hint" className="sf-field-hint">Record only a real external receipt, bank, cash, or accounting reference. Each reference is retained as a separate payment source.</p>
      <button className="sf-button" type="submit">Record payment</button>
    </form> : null}

    {canRefund ? <form className="sf-inventory-form" method="post" action={`/api/inventory/rentals/bookings/${encodeURIComponent(bookingId)}/payments/refunds`}>
      <label className="sf-field"><span>Refund amount ({bookingCurrency})</span><input name="amount" type="text" inputMode="decimal" pattern="[0-9]+(?:\.[0-9]+)?" defaultValue={moneyMinorToMajorString(nextRefundableSourceAmount, bookingCurrency)} required autoComplete="off" aria-describedby="rental-refund-amount-hint" /></label>
      <p id="rental-refund-amount-hint" className="sf-field-hint">Enter a positive amount up to {moneyMinorToMajorString(nextRefundableSourceAmount, bookingCurrency)} {bookingCurrency} for the next server-selected payment source. Total refundable booking balance is {moneyMinorToMajorString(refundableAmount, bookingCurrency)} {bookingCurrency}.</p>
      <label className="sf-field"><span>Offline refund reference</span><input name="reference" type="text" maxLength={120} required autoComplete="off" aria-describedby="rental-refund-reference-hint" /></label>
      <p id="rental-refund-reference-hint" className="sf-field-hint">Record only a real external refund reference. Partial refunds remain settled and continue blocking cancellation until all booking-price money is refunded.</p>
      <button className="sf-button sf-button--secondary" type="submit">Record refund</button>
    </form> : null}

    <p><Link className="sf-button sf-button--secondary" href={`/inventory/rentals/bookings/${encodeURIComponent(bookingId)}/security-bond`}>Security bond</Link></p>
    {!canManage ? <p className="sf-field-hint">Your organization role can view rental payment evidence but cannot record payments or refunds.</p> : null}
    <p className="sf-field-hint">Before a commercial amendment is prepared, booking-price settlement supports multiple staff-recorded manual/offline payment sources up to the immutable booking total plus source-attributed partial or full manual refunds. A prepared or applied commercial amendment freezes this original ledger; its workspace owns adjustment money and post-apply effective refunds. Security bonds remain separate. Online checkout, card authorization/capture, mixed-provider settlement, chargebacks, automatic deposit rules, and customer self-service are not enabled.</p>
  </section>;
}
