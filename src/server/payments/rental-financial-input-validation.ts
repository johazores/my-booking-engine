import { PricingValidationError } from '../pricing/money.ts';
import { TenantIdentifierValidationError } from '../tenancy/tenant-scope.ts';
import { PaymentInputValidationError } from './payment-provider.ts';

/** Only application-owned input errors may become customer validation redirects. */
export function isRentalFinancialInputValidationError(error: unknown): boolean {
  return error instanceof PaymentInputValidationError
    || error instanceof PricingValidationError
    || error instanceof TenantIdentifierValidationError;
}
