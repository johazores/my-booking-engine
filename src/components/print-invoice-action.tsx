'use client';

export function PrintInvoiceAction() {
  return <button className="sf-button" type="button" onClick={() => window.print()}>Print / save as PDF</button>;
}
