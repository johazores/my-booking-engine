'use client';

const DOCUMENT_CAPABILITY_PREFIX = 'sf-public-booking-document-capability:';
const LEGACY_RECEIPT_PREFIX = 'sf-public-booking-receipt:';
const RECOVERY_PREFIX = 'sf-public-booking-recovery:';

function documentCapabilityKey(organizationSlug: string) {
  return `${DOCUMENT_CAPABILITY_PREFIX}${organizationSlug}`;
}

function recoveryCapability(organizationSlug: string) {
  const recovery = window.sessionStorage.getItem(`${RECOVERY_PREFIX}${organizationSlug}`);
  if (!recovery) return null;
  try {
    const parsed = JSON.parse(recovery) as { bookingCapability?: unknown };
    return typeof parsed.bookingCapability === 'string' && parsed.bookingCapability.length > 0
      ? parsed.bookingCapability
      : null;
  } catch {
    return null;
  }
}

export function storePublicBookingDocumentCapability(organizationSlug: string, bookingCapability: string) {
  if (!bookingCapability) return;
  window.sessionStorage.setItem(documentCapabilityKey(organizationSlug), bookingCapability);
}

export function readPublicBookingDocumentCapability(organizationSlug: string) {
  const stored = window.sessionStorage.getItem(documentCapabilityKey(organizationSlug));
  if (stored) return stored;

  const legacyReceipt = window.sessionStorage.getItem(`${LEGACY_RECEIPT_PREFIX}${organizationSlug}`);
  if (legacyReceipt) {
    storePublicBookingDocumentCapability(organizationSlug, legacyReceipt);
    return legacyReceipt;
  }

  const recovery = recoveryCapability(organizationSlug);
  if (recovery) {
    storePublicBookingDocumentCapability(organizationSlug, recovery);
    return recovery;
  }

  return null;
}
