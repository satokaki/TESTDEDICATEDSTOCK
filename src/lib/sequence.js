import { base44 } from '@/api/base44Client';

/**
 * Generate a unique document code using the DocumentSequence entity.
 * Mirrors the backend sequence/transaction logic client-side.
 * In production, this should be a backend function with row locking.
 */
export async function generateDocumentCode(sequenceKey, prefix, year, formatFn) {
  const existing = await base44.entities.DocumentSequence.filter({ sequence_key: sequenceKey });
  let seq;
  let nextNumber;
  if (existing.length > 0) {
    seq = existing[0];
    nextNumber = seq.last_number + 1;
    await base44.entities.DocumentSequence.update(seq.id, { last_number: nextNumber });
  } else {
    nextNumber = 1;
    await base44.entities.DocumentSequence.create({
      sequence_key: sequenceKey,
      prefix,
      year,
      last_number: nextNumber,
    });
  }
  return formatFn(nextNumber);
}

export function padNumber(num, digits = 5) {
  return String(num).padStart(digits, '0');
}

export async function generateCustomerCode() {
  const year = new Date().getFullYear();
  return generateDocumentCode(
    `CUSTOMER-${year}`,
    'CUS',
    year,
    (n) => `CUS-${year}-${padNumber(n)}`
  );
}

export async function generateProductCode(categoryCode) {
  const catSuffix = (categoryCode || 'XX').substring(0, 3).toUpperCase();
  return generateDocumentCode(
    `PRODUCT-${catSuffix}`,
    'BRG',
    new Date().getFullYear(),
    (n) => `BRG-${catSuffix}-${padNumber(n)}`
  );
}

export async function generateInvoiceNumber() {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  return generateDocumentCode(
    `INVOICE-${ym}`,
    'INV',
    now.getFullYear(),
    (n) => `INV-${ym}-${padNumber(n)}`
  );
}

export async function generatePaymentNumber() {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  return generateDocumentCode(
    `PAYMENT-${ym}`,
    'PAY',
    now.getFullYear(),
    (n) => `PAY-${ym}-${padNumber(n)}`
  );
}

export async function generateProductionNumber() {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  return generateDocumentCode(
    `PRODUCTION-${ym}`,
    'PRD',
    now.getFullYear(),
    (n) => `PRD-${ym}-${padNumber(n)}`
  );
}

export async function generateBatchNumber(brandCode) {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const code = (brandCode || 'GEN').substring(0, 3).toUpperCase();
  return generateDocumentCode(
    `BATCH-${code}-${ymd}`,
    'BATCH',
    now.getFullYear(),
    (n) => `BATCH-${code}-${ymd}-${String(n).padStart(3, '0')}`
  );
}

export async function generatePurchaseNumber() {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  return generateDocumentCode(
    `PURCHASE-${ym}`,
    'PO',
    now.getFullYear(),
    (n) => `PO-${ym}-${padNumber(n)}`
  );
}

export async function generatePayableNumber() {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  return generateDocumentCode(
    `PAYABLE-${ym}`,
    'AP',
    now.getFullYear(),
    (n) => `AP-${ym}-${padNumber(n)}`
  );
}

export async function generateOrderNumber(prefix, entityName) {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  return generateDocumentCode(
    `${entityName}-${ym}`,
    prefix,
    now.getFullYear(),
    (n) => `${prefix}-${ym}-${padNumber(n)}`
  );
}