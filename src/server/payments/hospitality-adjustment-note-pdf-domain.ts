const PDF_PAGE_WIDTH = 595;
const PDF_PAGE_HEIGHT = 842;
const PDF_MARGIN = 48;
const PDF_BOTTOM_MARGIN = 58;
const PDF_LINE_HEIGHT = 15;
const PDF_BODY_FONT_SIZE = 9;
const PDF_SMALL_FONT_SIZE = 8;
const PDF_TITLE_FONT_SIZE = 22;
const PDF_MAX_TEXT_LENGTH = 500;

const WINDOWS_1252_SPECIAL = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f],
]);

export class HospitalityAdjustmentNotePdfValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityAdjustmentNotePdfValidationError';
  }
}

type PdfParty = Readonly<{
  legalName: string;
  email?: string | null;
  contactEmail?: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
}>;

export type HospitalityAdjustmentNotePdfDocument = Readonly<{
  documentTitle: 'Adjustment note';
  documentNumber: string;
  issuedAt: string;
  currency: string;
  sourceTaxInvoiceNumber: string;
  sourceTaxInvoiceIssuedAt: string;
  seller: PdfParty;
  buyer: PdfParty;
  supplierAbn: string;
  adjustmentType: 'Decreasing adjustment' | 'Increasing adjustment';
  adjustmentReason: 'Booking cancellation' | 'Commercial booking amendment';
  priceBeforeAdjustmentMinor: string;
  priceAfterAdjustmentMinor: string;
  decreaseSubtotalMinor: string;
  decreaseGstMinor: string;
  decreaseTotalMinor: string;
  increaseSubtotalMinor?: string;
  increaseGstMinor?: string;
  increaseTotalMinor?: string;
}>;

type PdfLine = Readonly<{ text: string; x: number; y: number; size: number; bold?: boolean }>;

type AdjustmentEffect = Readonly<{
  directionLabel: 'Decrease' | 'Increase';
  subtotalMinor: string;
  gstMinor: string;
  totalMinor: string;
}>;

function encodeWindows1252(value: string, label = 'PDF text') {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    if (codePoint >= 0x20 && codePoint <= 0x7e) {
      bytes.push(codePoint);
      continue;
    }
    if ((codePoint >= 0xa0 && codePoint <= 0xff) || codePoint === 0x09) {
      bytes.push(codePoint);
      continue;
    }
    const mapped = WINDOWS_1252_SPECIAL.get(codePoint);
    if (mapped !== undefined) {
      bytes.push(mapped);
      continue;
    }
    throw new HospitalityAdjustmentNotePdfValidationError(
      `${label} contains characters that cannot be represented losslessly in the current deterministic PDF font contract.`,
    );
  }
  return Buffer.from(bytes);
}

function assertText(value: unknown, label: string, maxLength = PDF_MAX_TEXT_LENGTH) {
  if (typeof value !== 'string') throw new HospitalityAdjustmentNotePdfValidationError(`${label} must be a string.`);
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > maxLength) {
    throw new HospitalityAdjustmentNotePdfValidationError(`${label} must be between 1 and ${maxLength} characters.`);
  }
  encodeWindows1252(normalized, label);
  return normalized;
}

function optionalText(value: unknown, label: string, maxLength = PDF_MAX_TEXT_LENGTH) {
  if (value === null || value === undefined || value === '') return null;
  return assertText(value, label, maxLength);
}

function nonNegativeMinor(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new HospitalityAdjustmentNotePdfValidationError(`${label} must be a non-negative integer minor-unit string.`);
  }
  return BigInt(value);
}

function optionalMinor(value: unknown, label: string) {
  if (value === undefined) return 0n;
  return nonNegativeMinor(value, label);
}

function pdfHexText(value: string) {
  return `<${encodeWindows1252(value).toString('hex').toUpperCase()}>`;
}

function formatAudMinor(value: string) {
  const minor = nonNegativeMinor(value, 'AUD amount');
  const whole = minor / 100n;
  const fraction = minor % 100n;
  return `AUD ${whole.toString()}.${fraction.toString().padStart(2, '0')}`;
}

function parseDate(value: string, label: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HospitalityAdjustmentNotePdfValidationError(`${label} must be a valid date.`);
  return date;
}

function dateAu(value: string, label: string) {
  const date = parseDate(value, label);
  const day = date.getUTCDate().toString().padStart(2, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

function addressLines(party: PdfParty) {
  const locality = [party.city, party.region, party.postalCode].filter(Boolean).join(' ');
  return [party.addressLine1, party.addressLine2, locality || null, party.countryCode].filter((line): line is string => Boolean(line));
}

function wrapText(value: string, maxCharacters: number) {
  if (value.length <= maxCharacters) return [value];
  const words = value.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (word.length > maxCharacters) {
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let index = 0; index < word.length; index += maxCharacters) {
        lines.push(word.slice(index, index + maxCharacters));
      }
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharacters) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function validateDocument(document: HospitalityAdjustmentNotePdfDocument): Readonly<{
  documentNumber: string;
  effect: AdjustmentEffect;
}> {
  if (!document || typeof document !== 'object') throw new HospitalityAdjustmentNotePdfValidationError('Adjustment note document is required.');
  if (document.documentTitle !== 'Adjustment note') throw new HospitalityAdjustmentNotePdfValidationError('Only Australian adjustment notes can be rendered.');
  const documentNumber = assertText(document.documentNumber, 'documentNumber', 64);
  if (!/^AU-ADJ-[0-9]{8,}$/.test(documentNumber)) throw new HospitalityAdjustmentNotePdfValidationError('documentNumber is invalid.');
  if (!/^AU-TAX-[0-9]{8,}$/.test(document.sourceTaxInvoiceNumber)) throw new HospitalityAdjustmentNotePdfValidationError('sourceTaxInvoiceNumber is invalid.');
  if (document.currency !== 'AUD') throw new HospitalityAdjustmentNotePdfValidationError('Deterministic adjustment-note PDF currently supports AUD only.');
  if (!/^\d{11}$/.test(document.supplierAbn)) throw new HospitalityAdjustmentNotePdfValidationError('supplierAbn is invalid.');
  if (document.adjustmentType !== 'Decreasing adjustment' && document.adjustmentType !== 'Increasing adjustment') {
    throw new HospitalityAdjustmentNotePdfValidationError('adjustmentType is invalid.');
  }
  if (document.adjustmentReason !== 'Booking cancellation' && document.adjustmentReason !== 'Commercial booking amendment') {
    throw new HospitalityAdjustmentNotePdfValidationError('adjustmentReason is invalid.');
  }
  if (document.adjustmentType === 'Increasing adjustment' && document.adjustmentReason === 'Booking cancellation') {
    throw new HospitalityAdjustmentNotePdfValidationError('Booking cancellation cannot be rendered as an increasing adjustment.');
  }

  assertText(document.seller.legalName, 'seller legalName', 200);
  assertText(document.buyer.legalName, 'buyer legalName', 200);
  optionalText(document.seller.contactEmail, 'seller contactEmail', 320);
  optionalText(document.buyer.email, 'buyer email', 320);
  for (const [label, party] of [['seller', document.seller], ['buyer', document.buyer]] as const) {
    optionalText(party.addressLine1, `${label} addressLine1`, 200);
    optionalText(party.addressLine2, `${label} addressLine2`, 200);
    optionalText(party.city, `${label} city`, 120);
    optionalText(party.region, `${label} region`, 120);
    optionalText(party.postalCode, `${label} postalCode`, 32);
    optionalText(party.countryCode, `${label} countryCode`, 2);
  }

  const issuedAt = parseDate(document.issuedAt, 'issuedAt');
  const sourceIssuedAt = parseDate(document.sourceTaxInvoiceIssuedAt, 'sourceTaxInvoiceIssuedAt');
  if (sourceIssuedAt.getTime() > issuedAt.getTime()) {
    throw new HospitalityAdjustmentNotePdfValidationError('Source tax invoice cannot be issued after its adjustment note.');
  }

  const decreaseSubtotal = nonNegativeMinor(document.decreaseSubtotalMinor, 'decreaseSubtotalMinor');
  const decreaseGst = nonNegativeMinor(document.decreaseGstMinor, 'decreaseGstMinor');
  const decreaseTotal = nonNegativeMinor(document.decreaseTotalMinor, 'decreaseTotalMinor');
  const increaseSubtotal = optionalMinor(document.increaseSubtotalMinor, 'increaseSubtotalMinor');
  const increaseGst = optionalMinor(document.increaseGstMinor, 'increaseGstMinor');
  const increaseTotal = optionalMinor(document.increaseTotalMinor, 'increaseTotalMinor');
  const priceBefore = nonNegativeMinor(document.priceBeforeAdjustmentMinor, 'priceBeforeAdjustmentMinor');
  const priceAfter = nonNegativeMinor(document.priceAfterAdjustmentMinor, 'priceAfterAdjustmentMinor');

  if (document.adjustmentType === 'Decreasing adjustment') {
    if (decreaseTotal <= 0n || decreaseSubtotal + decreaseGst !== decreaseTotal) {
      throw new HospitalityAdjustmentNotePdfValidationError('Adjustment-note decrease totals do not reconcile.');
    }
    if (increaseSubtotal !== 0n || increaseGst !== 0n || increaseTotal !== 0n) {
      throw new HospitalityAdjustmentNotePdfValidationError('Decreasing adjustment cannot contain an increasing effect.');
    }
    if (document.adjustmentReason === 'Booking cancellation') {
      if (priceBefore !== decreaseTotal || priceAfter !== 0n) {
        throw new HospitalityAdjustmentNotePdfValidationError('Cancellation adjustment price effect is inconsistent.');
      }
    } else if (priceBefore <= priceAfter || priceBefore - priceAfter !== decreaseTotal) {
      throw new HospitalityAdjustmentNotePdfValidationError('Commercial-amendment decreasing price effect is inconsistent.');
    }
    return Object.freeze({
      documentNumber,
      effect: Object.freeze({
        directionLabel: 'Decrease' as const,
        subtotalMinor: document.decreaseSubtotalMinor,
        gstMinor: document.decreaseGstMinor,
        totalMinor: document.decreaseTotalMinor,
      }),
    });
  }

  if (increaseTotal <= 0n || increaseSubtotal + increaseGst !== increaseTotal) {
    throw new HospitalityAdjustmentNotePdfValidationError('Adjustment-note increase totals do not reconcile.');
  }
  if (decreaseSubtotal !== 0n || decreaseGst !== 0n || decreaseTotal !== 0n) {
    throw new HospitalityAdjustmentNotePdfValidationError('Increasing adjustment cannot contain a decreasing effect.');
  }
  if (priceAfter <= priceBefore || priceAfter - priceBefore !== increaseTotal) {
    throw new HospitalityAdjustmentNotePdfValidationError('Commercial-amendment increasing price effect is inconsistent.');
  }
  return Object.freeze({
    documentNumber,
    effect: Object.freeze({
      directionLabel: 'Increase' as const,
      subtotalMinor: document.increaseSubtotalMinor ?? '0',
      gstMinor: document.increaseGstMinor ?? '0',
      totalMinor: document.increaseTotalMinor ?? '0',
    }),
  });
}

function textInstruction(line: PdfLine) {
  const font = line.bold ? 'F2' : 'F1';
  return `BT /${font} ${line.size} Tf ${line.x} ${line.y} Td ${pdfHexText(line.text)} Tj ET\n`;
}

function pageHeader(documentNumber: string, page: number): PdfLine[] {
  return [
    { text: 'Adjustment note', x: PDF_MARGIN, y: 790, size: PDF_TITLE_FONT_SIZE, bold: true },
    { text: documentNumber, x: 380, y: 794, size: 10, bold: true },
    { text: `Page ${page}`, x: 485, y: 778, size: PDF_SMALL_FONT_SIZE },
  ];
}

function createPageComposer(documentNumber: string) {
  const pages: PdfLine[][] = [];
  let current = pageHeader(documentNumber, 1);
  let y = 752;

  function nextPage() {
    pages.push(current);
    current = pageHeader(documentNumber, pages.length + 1);
    y = 752;
  }

  function ensure(lines = 1) {
    if (y - (lines * PDF_LINE_HEIGHT) < PDF_BOTTOM_MARGIN) nextPage();
  }

  function add(text: string, options: { x?: number; size?: number; bold?: boolean; gapAfter?: number } = {}) {
    ensure();
    current.push({ text, x: options.x ?? PDF_MARGIN, y, size: options.size ?? PDF_BODY_FONT_SIZE, bold: options.bold });
    y -= PDF_LINE_HEIGHT + (options.gapAfter ?? 0);
  }

  function addWrapped(text: string, maxCharacters: number, options: { x?: number; size?: number; bold?: boolean; gapAfter?: number } = {}) {
    const lines = wrapText(text, maxCharacters);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line) continue;
      add(line, { ...options, gapAfter: index === lines.length - 1 ? options.gapAfter : 0 });
    }
  }

  function finish() {
    pages.push(current);
    return pages;
  }

  return { add, addWrapped, finish };
}

function createContentPages(document: HospitalityAdjustmentNotePdfDocument) {
  const validated = validateDocument(document);
  const composer = createPageComposer(validated.documentNumber);
  composer.add('Australian GST document', { size: PDF_SMALL_FONT_SIZE, gapAfter: 2 });
  composer.add(`Issued ${dateAu(document.issuedAt, 'issuedAt')}`, { gapAfter: 10 });

  composer.add('Seller', { bold: true });
  composer.addWrapped(document.seller.legalName, 82, { bold: true });
  composer.add(`ABN ${document.supplierAbn}`);
  for (const line of addressLines(document.seller)) composer.addWrapped(line, 82);
  if (document.seller.contactEmail) composer.addWrapped(document.seller.contactEmail, 82);
  composer.add('', { size: 1, gapAfter: 4 });

  composer.add('Buyer', { bold: true });
  composer.addWrapped(document.buyer.legalName, 82, { bold: true });
  for (const line of addressLines(document.buyer)) composer.addWrapped(line, 82);
  if (document.buyer.email) composer.addWrapped(document.buyer.email, 82);
  composer.add('', { size: 1, gapAfter: 6 });

  composer.add('Adjustment details', { bold: true });
  composer.add(`Type: ${document.adjustmentType}`);
  composer.add(`Reason: ${document.adjustmentReason}`);
  composer.add(`Original tax invoice: ${document.sourceTaxInvoiceNumber}`);
  composer.add(`Original invoice date: ${dateAu(document.sourceTaxInvoiceIssuedAt, 'sourceTaxInvoiceIssuedAt')}`, { gapAfter: 6 });

  composer.add(`Price before adjustment: ${formatAudMinor(document.priceBeforeAdjustmentMinor)}`);
  composer.add(`Price after adjustment: ${formatAudMinor(document.priceAfterAdjustmentMinor)}`, { gapAfter: 6 });
  composer.add(`${validated.effect.directionLabel} excl. GST: ${formatAudMinor(validated.effect.subtotalMinor)}`, { bold: true });
  composer.add(`GST ${validated.effect.directionLabel.toLowerCase()}: ${formatAudMinor(validated.effect.gstMinor)}`, { bold: true });
  composer.add(`Total ${validated.effect.directionLabel.toLowerCase()} incl. GST: ${formatAudMinor(validated.effect.totalMinor)}`, { bold: true, gapAfter: 8 });
  composer.addWrapped(
    document.adjustmentReason === 'Booking cancellation'
      ? 'This decreasing adjustment records the full cancellation and refund of the taxable sale shown on the original tax invoice. The original tax invoice remains immutable.'
      : document.adjustmentType === 'Increasing adjustment'
        ? 'This increasing adjustment records the applied commercial booking amendment against the taxable sale shown on the original tax invoice. The original tax invoice remains immutable.'
        : 'This decreasing adjustment records the applied commercial booking amendment against the taxable sale shown on the original tax invoice. The original tax invoice remains immutable.',
    82,
    { size: PDF_SMALL_FONT_SIZE },
  );
  return composer.finish();
}

function ascii(value: string) {
  return Buffer.from(value, 'ascii');
}

function createPdfObjects(contentPages: readonly PdfLine[][]) {
  const pageObjectNumbers = contentPages.map((_, index) => 5 + (index * 2));
  const contentObjectNumbers = contentPages.map((_, index) => 6 + (index * 2));
  const objects = new Map<number, Buffer>();
  objects.set(1, ascii('<< /Type /Catalog /Pages 2 0 R >>'));
  objects.set(2, ascii(`<< /Type /Pages /Count ${contentPages.length} /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(' ')}] >>`));
  objects.set(3, ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
  objects.set(4, ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'));

  for (let index = 0; index < contentPages.length; index += 1) {
    const pageObject = pageObjectNumbers[index];
    const contentObject = contentObjectNumbers[index];
    const lines = contentPages[index];
    if (!pageObject || !contentObject || !lines) continue;
    const stream = ascii(lines.map(textInstruction).join(''));
    objects.set(pageObject, ascii(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObject} 0 R >>`,
    ));
    objects.set(contentObject, Buffer.concat([ascii(`<< /Length ${stream.length} >>\nstream\n`), stream, ascii('endstream')]));
  }
  return objects;
}

export function createHospitalityAdjustmentNotePdf(document: HospitalityAdjustmentNotePdfDocument) {
  const contentPages = createContentPages(document);
  const objects = createPdfObjects(contentPages);
  const highestObjectNumber = Math.max(...objects.keys());
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')];
  const offsets = new Array<number>(highestObjectNumber + 1).fill(0);
  let offset = chunks[0]?.length ?? 0;

  for (let number = 1; number <= highestObjectNumber; number += 1) {
    const object = objects.get(number);
    if (!object) throw new HospitalityAdjustmentNotePdfValidationError('Internal PDF object graph is incomplete.');
    offsets[number] = offset;
    const chunk = Buffer.concat([ascii(`${number} 0 obj\n`), object, ascii('\nendobj\n')]);
    chunks.push(chunk);
    offset += chunk.length;
  }

  const xrefOffset = offset;
  const xrefLines = ['xref', `0 ${highestObjectNumber + 1}`, '0000000000 65535 f '];
  for (let number = 1; number <= highestObjectNumber; number += 1) {
    xrefLines.push(`${offsets[number]?.toString().padStart(10, '0')} 00000 n `);
  }
  chunks.push(ascii(`${xrefLines.join('\n')}\ntrailer\n<< /Size ${highestObjectNumber + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`));
  return Buffer.concat(chunks);
}
