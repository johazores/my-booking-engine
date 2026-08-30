export type BrandingFont = 'INTER' | 'SYSTEM' | 'SERIF' | 'MONO';

export type OrganizationBrandingInput = {
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamily: string;
  contactEmail: string;
  contactPhone: string;
  websiteUrl: string;
  emailFromName: string;
  emailReplyTo: string;
  publicBookingTitle: string;
  publicBookingDescription: string;
  customDomain: string;
};

export class BrandingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrandingValidationError';
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_PATTERN = /^#[0-9a-f]{6}$/;
const DOMAIN_LABEL_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

function optionalText(value: string, label: string, maxLength: number) {
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new BrandingValidationError(`${label} is too long.`);
  return normalized;
}

function optionalEmail(value: string, label: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.length > 320 || !EMAIL_PATTERN.test(normalized)) {
    throw new BrandingValidationError(`${label} must be a valid email address.`);
  }
  return normalized;
}

function optionalHttpsUrl(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > 2048) throw new BrandingValidationError(`${label} is too long.`);
  try {
    const url = new URL(normalized);
    if (url.protocol !== 'https:' || !url.hostname) throw new Error('invalid protocol');
    return url.toString();
  } catch {
    throw new BrandingValidationError(`${label} must be an absolute HTTPS URL.`);
  }
}

function hexColor(value: string, label: string) {
  const normalized = value.trim().toLowerCase();
  if (!HEX_PATTERN.test(normalized)) throw new BrandingValidationError(`${label} must use #rrggbb format.`);
  return normalized;
}

function brandingFont(value: string): BrandingFont {
  if (value === 'INTER' || value === 'SYSTEM' || value === 'SERIF' || value === 'MONO') return value;
  throw new BrandingValidationError('Choose a supported font family.');
}

function optionalPhone(value: string) {
  const normalized = optionalText(value, 'Contact phone', 40);
  if (!normalized) return null;
  if (!/^[+0-9().\-\s]{5,40}$/.test(normalized)) {
    throw new BrandingValidationError('Contact phone contains unsupported characters.');
  }
  return normalized;
}

function optionalDomain(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\.$/, '');
  if (!normalized) return null;
  if (normalized.length > 253 || normalized.includes('://') || normalized.includes('/') || normalized.includes(':')) {
    throw new BrandingValidationError('Custom domain must be a hostname only.');
  }
  const labels = normalized.split('.');
  if (labels.length < 2 || labels.some((label) => !DOMAIN_LABEL_PATTERN.test(label))) {
    throw new BrandingValidationError('Custom domain must be a valid hostname.');
  }
  return normalized;
}

export function normalizeOrganizationBranding(input: OrganizationBrandingInput) {
  return {
    logoUrl: optionalHttpsUrl(input.logoUrl, 'Logo URL'),
    faviconUrl: optionalHttpsUrl(input.faviconUrl, 'Favicon URL'),
    primaryColor: hexColor(input.primaryColor, 'Primary color'),
    secondaryColor: hexColor(input.secondaryColor, 'Secondary color'),
    accentColor: hexColor(input.accentColor, 'Accent color'),
    fontFamily: brandingFont(input.fontFamily),
    contactEmail: optionalEmail(input.contactEmail, 'Contact email'),
    contactPhone: optionalPhone(input.contactPhone),
    websiteUrl: optionalHttpsUrl(input.websiteUrl, 'Website URL'),
    emailFromName: optionalText(input.emailFromName, 'Email sender name', 160),
    emailReplyTo: optionalEmail(input.emailReplyTo, 'Email reply-to'),
    publicBookingTitle: optionalText(input.publicBookingTitle, 'Public booking title', 160),
    publicBookingDescription: optionalText(input.publicBookingDescription, 'Public booking description', 500),
    customDomain: optionalDomain(input.customDomain),
  };
}

export function brandingFontStack(fontFamily: BrandingFont) {
  if (fontFamily === 'SYSTEM') return 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  if (fontFamily === 'SERIF') return 'Georgia, "Times New Roman", serif';
  if (fontFamily === 'MONO') return '"SFMono-Regular", Consolas, "Liberation Mono", monospace';
  return 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
}
