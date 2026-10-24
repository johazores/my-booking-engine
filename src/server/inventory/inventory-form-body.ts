/** Inventory form ingress shares the production bounded form reader. */
import { FORM_MAX_FIELDS, FORM_REQUEST_MAX_BYTES, readBoundedFormData } from '../http/bounded-form-body.ts';

export const INVENTORY_FORM_REQUEST_MAX_BYTES = FORM_REQUEST_MAX_BYTES;
export const INVENTORY_FORM_MAX_FIELDS = FORM_MAX_FIELDS;

export function readBoundedInventoryFormData(
  request: Request,
  maxBytes = INVENTORY_FORM_REQUEST_MAX_BYTES,
): Promise<FormData | null> {
  return readBoundedFormData(request, maxBytes);
}
