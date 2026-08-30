import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrandingValidationError,
  brandingFontStack,
  normalizeOrganizationBranding,
} from './branding-domain.ts';

const validInput = {
  logoUrl: 'https://cdn.example.com/logo.svg',
  faviconUrl: 'https://cdn.example.com/favicon.ico',
  primaryColor: '#2563EB',
  secondaryColor: '#0D1626',
  accentColor: '#20C997',
  fontFamily: 'INTER',
  contactEmail: ' HELLO@EXAMPLE.COM ',
  contactPhone: '+63 917 555 0100',
  websiteUrl: 'https://example.com',
  emailFromName: ' Example Reservations ',
  emailReplyTo: 'BOOKINGS@EXAMPLE.COM',
  publicBookingTitle: ' Book with Example ',
  publicBookingDescription: ' Direct booking information. ',
  customDomain: ' BOOK.EXAMPLE.COM. ',
};

test('normalizes tenant branding into canonical persisted values', () => {
  const result = normalizeOrganizationBranding(validInput);
  assert.equal(result.primaryColor, '#2563eb');
  assert.equal(result.secondaryColor, '#0d1626');
  assert.equal(result.accentColor, '#20c997');
  assert.equal(result.contactEmail, 'hello@example.com');
  assert.equal(result.emailReplyTo, 'bookings@example.com');
  assert.equal(result.customDomain, 'book.example.com');
  assert.equal(result.emailFromName, 'Example Reservations');
});

test('allows optional branding fields to be cleared', () => {
  const result = normalizeOrganizationBranding({
    ...validInput,
    logoUrl: '', faviconUrl: '', contactEmail: '', contactPhone: '', websiteUrl: '',
    emailFromName: '', emailReplyTo: '', publicBookingTitle: '', publicBookingDescription: '', customDomain: '',
  });
  assert.equal(result.logoUrl, null);
  assert.equal(result.customDomain, null);
  assert.equal(result.contactEmail, null);
});

test('rejects unsafe URLs, colors, email addresses, and domains', () => {
  assert.throws(() => normalizeOrganizationBranding({ ...validInput, logoUrl: 'javascript:alert(1)' }), BrandingValidationError);
  assert.throws(() => normalizeOrganizationBranding({ ...validInput, primaryColor: 'blue' }), BrandingValidationError);
  assert.throws(() => normalizeOrganizationBranding({ ...validInput, emailReplyTo: 'not-an-email' }), BrandingValidationError);
  assert.throws(() => normalizeOrganizationBranding({ ...validInput, customDomain: 'https://example.com/path' }), BrandingValidationError);
});

test('maps persisted font choices to controlled font stacks', () => {
  assert.match(brandingFontStack('INTER'), /Inter/);
  assert.match(brandingFontStack('SERIF'), /Georgia/);
  assert.match(brandingFontStack('MONO'), /Consolas/);
});
