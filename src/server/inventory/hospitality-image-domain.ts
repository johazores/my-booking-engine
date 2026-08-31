import { HospitalityInventoryValidationError } from './hospitality-domain.ts';

export type HospitalityImageInput = {
  url: string;
  altText: string;
  sortOrder: string;
  isPrimary: string;
};

export function normalizeHospitalityImageInput(input: HospitalityImageInput) {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input.url.trim());
  } catch {
    throw new HospitalityInventoryValidationError('Image URL must be a valid HTTPS URL.');
  }
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password || parsedUrl.href.length > 2048) {
    throw new HospitalityInventoryValidationError('Image URL must be a valid HTTPS URL without embedded credentials.');
  }

  const altText = input.altText.trim().replace(/\s+/g, ' ');
  if (!altText || altText.length > 200) {
    throw new HospitalityInventoryValidationError('Image alt text must be between 1 and 200 characters.');
  }

  const sortOrder = Number.parseInt(input.sortOrder || '0', 10);
  if (!Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) {
    throw new HospitalityInventoryValidationError('Image sort order must be between 0 and 9999.');
  }

  return {
    url: parsedUrl.href,
    altText,
    sortOrder,
    isPrimary: input.isPrimary === 'on' || input.isPrimary === 'true' || input.isPrimary === '1',
  };
}
