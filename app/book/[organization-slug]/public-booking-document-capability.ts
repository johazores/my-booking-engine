'use client';

import { useSyncExternalStore } from 'react';

const DOCUMENT_CAPABILITY_PREFIX = 'sf-public-booking-document-capability:';
const LEGACY_RECEIPT_PREFIX = 'sf-public-booking-receipt:';
const RECOVERY_PREFIX = 'sf-public-booking-recovery:';
const DOCUMENT_CAPABILITY_CHANGE = 'sf-public-booking-document-capability-change';

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
  const key = documentCapabilityKey(organizationSlug);
  if (window.sessionStorage.getItem(key) === bookingCapability) return;
  window.sessionStorage.setItem(key, bookingCapability);
  window.dispatchEvent(new Event(DOCUMENT_CAPABILITY_CHANGE));
}

export function readPublicBookingDocumentCapability(organizationSlug: string) {
  const stored = window.sessionStorage.getItem(documentCapabilityKey(organizationSlug));
  if (stored) return stored;

  const legacyReceipt = window.sessionStorage.getItem(`${LEGACY_RECEIPT_PREFIX}${organizationSlug}`);
  if (legacyReceipt) {
    return legacyReceipt;
  }

  const recovery = recoveryCapability(organizationSlug);
  if (recovery) {
    return recovery;
  }

  return null;
}

function subscribeToDocumentCapability(onChange: () => void) {
  window.addEventListener(DOCUMENT_CAPABILITY_CHANGE, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(DOCUMENT_CAPABILITY_CHANGE, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** Reactively follows the active same-tab booking, never a previous booking's document authority. */
export function usePublicBookingDocumentCapability(organizationSlug: string) {
  return useSyncExternalStore(
    subscribeToDocumentCapability,
    () => readPublicBookingDocumentCapability(organizationSlug),
    () => null,
  );
}
