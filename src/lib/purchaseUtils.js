import { base44 } from '@/api/base44Client';
import { recordStockMovement, createAuditLog } from '@/lib/stockUtils';
import { generatePurchaseNumber, generatePayableNumber } from '@/lib/sequence';

export { generatePurchaseNumber, generatePayableNumber };

const toNum = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

/**
 * Validate purchase items before posting.
 * Throws Error with user-friendly message on first violation.
 */
function validatePurchase(purchase, items) {
  if (!purchase) throw new Error('Dokumen pembelian tidak ditemukan');
  if (purchase.purchase_status === 'posted') throw new Error('Pembelian sudah diposting, tidak dapat diposting ulang');
  if (purchase.purchase_status === 'cancelled') throw new Error('Pembelian telah dibatalkan');
  if (!purchase.supplier_id) throw new Error('Supplier wajib diisi sebelum posting');
  if (!purchase.warehouse_id) throw new Error('Gudang tujuan wajib diisi sebelum posting');
  if (!items || items.length === 0) throw new Error('Minimal satu item wajib ada sebelum posting');
  for (const it of items) {
    const qty = toNum(it.quantity);
    if (qty === null || Number.isNaN(qty)) throw new Error(`Quantity item "${it.item_name}" tidak valid`);
    if (qty <= 0) throw new Error(`Quantity item "${it.item_name}" harus lebih dari nol`);
    const price = toNum(it.unit_price);
    if (price === null || Number.isNaN(price)) throw new Error(`Harga item "${it.item_name}" tidak valid`);
    if (price < 0) throw new Error(`Harga item "${it.item_name}" tidak boleh negatif`);
    const cf = toNum(it.conversion_factor) ?? 1;
    if (cf <= 0) throw new Error(`Faktor konversi item "${it.item_name}" harus lebih dari nol`);
  }
}

/**
 * Post a purchase: validate -> create stock ledger (purchase_receipt) -> update stock balance
 * -> create supplier payable if tempo -> update status -> audit log.
 * On any step failure throws (best-effort; real rollback is backend's job in production).
 */
export async function postPurchase(purchaseId) {
  const purchase = await base44.entities.Purchase.get(purchaseId);
  const items = await base44.entities.PurchaseItem.filter({ purchase_id: purchaseId });
  validatePurchase(purchase, items);

  const user = await base44.auth.me().catch(() => null);
  const userName = user?.full_name || user?.email || 'System';

  // 1. Stock movements for every item (satuan dasar)
  for (const it of items) {
    const qty = Number(it.quantity);
    const cf = Number(it.conversion_factor) || 1;
    const baseQty = Number(it.base_quantity) || qty * cf;
    await recordStockMovement({
      item_type: it.item_type === 'material' ? 'material' : 'product',
      item_id: it.item_id,
      item_code: it.item_code || '',
      item_name: it.item_name,
      batch_id: it.lot_number || it.batch_supplier || '',
      batch_number: it.batch_supplier || it.lot_number || '',
      warehouse_id: it.warehouse_id || purchase.warehouse_id || '',
      warehouse_name: it.warehouse_name || purchase.warehouse_name || '',
      quantity_in: baseQty,
      unit: it.base_unit || it.unit || 'unit',
      transaction_type: 'purchase_receipt',
      transaction_number: purchase.purchase_number,
      reference_type: 'purchase',
      reference_id: purchase.id,
      notes: `Penerimaan pembelian ${purchase.purchase_number}`,
    });
    // Update last purchase price for materials
    if (it.item_type === 'material') {
      try { await base44.entities.Material.update(it.item_id, { last_purchase_price: Number(it.unit_price) || 0 }); } catch { /* ignore */ }
    }
  }

  // 2. Supplier payable for tempo
  let payableNumber = '';
  if (purchase.payment_method === 'tempo') {
    payableNumber = await generatePayableNumber();
    await base44.entities.SupplierPayable.create({
      payable_number: payableNumber,
      purchase_id: purchase.id,
      purchase_number: purchase.purchase_number,
      supplier_id: purchase.supplier_id,
      supplier_name: purchase.supplier_name,
      invoice_date: purchase.purchase_date,
      due_date: purchase.due_date,
      total_amount: Number(purchase.total) || 0,
      total_paid: 0,
      remaining_balance: Number(purchase.total) || 0,
      payment_status: 'belum_dibayar',
      notes: purchase.notes || '',
    });
  }

  // 3. Update purchase status
  const paidNow = purchase.payment_method === 'tempo' ? 0 : (Number(purchase.total) || 0);
  const remaining = purchase.payment_method === 'tempo' ? (Number(purchase.total) || 0) : 0;
  const paymentStatus = purchase.payment_method === 'tempo' ? 'belum_dibayar' : 'lunas';
  await base44.entities.Purchase.update(purchase.id, {
    purchase_status: 'posted',
    posted_by: userName,
    posted_at: new Date().toISOString(),
    total_paid: paidNow,
    remaining_payable: remaining,
    payment_status: paymentStatus,
  });

  await createAuditLog({
    module: 'Pembelian', action: 'Posting', entity_type: 'Purchase',
    entity_id: purchase.id, reference_number: purchase.purchase_number,
    data_after: { status: 'posted', items: items.length, payable: payableNumber || null },
  });

  return { posted: true, payableNumber };
}

/**
 * Cancel a purchase. Draft -> cancelled (no stock moved).
 * Posted -> cancelled with reversal stock movements (reversal ledger).
 */
export async function cancelPurchase(purchaseId, reason = '') {
  const purchase = await base44.entities.Purchase.get(purchaseId);
  if (!purchase) throw new Error('Dokumen pembelian tidak ditemukan');
  if (purchase.purchase_status === 'cancelled') throw new Error('Pembelian sudah dibatalkan');

  if (purchase.purchase_status === 'posted') {
    // Reversal: remove the stock that was added
    const items = await base44.entities.PurchaseItem.filter({ purchase_id: purchaseId });
    for (const it of items) {
      const qty = Number(it.quantity);
      const cf = Number(it.conversion_factor) || 1;
      const baseQty = Number(it.base_quantity) || qty * cf;
      await recordStockMovement({
        item_type: it.item_type === 'material' ? 'material' : 'product',
        item_id: it.item_id,
        item_code: it.item_code || '',
        item_name: it.item_name,
        batch_id: it.lot_number || it.batch_supplier || '',
        batch_number: it.batch_supplier || it.lot_number || '',
        warehouse_id: it.warehouse_id || purchase.warehouse_id || '',
        warehouse_name: it.warehouse_name || purchase.warehouse_name || '',
        quantity_out: baseQty,
        unit: it.base_unit || it.unit || 'unit',
        transaction_type: 'stock_adjustment',
        transaction_number: purchase.purchase_number,
        reference_type: 'purchase',
        reference_id: purchase.id,
        notes: `Pembatalan pembelian ${purchase.purchase_number} - ${reason || 'reversal'}`,
      });
    }
    // Close payable if exists
    const payables = await base44.entities.SupplierPayable.filter({ purchase_id: purchaseId });
    for (const ap of payables) {
      if (ap.payment_status !== 'lunas') {
        await base44.entities.SupplierPayable.update(ap.id, { payment_status: 'lunas', remaining_balance: 0, notes: (ap.notes || '') + `\nDibatalkan: ${reason}` });
      }
    }
  }

  await base44.entities.Purchase.update(purchase.id, {
    purchase_status: 'cancelled',
    notes: (purchase.notes || '') + `\nDibatalkan: ${reason}`,
  });
  await createAuditLog({
    module: 'Pembelian', action: 'Cancel', entity_type: 'Purchase',
    entity_id: purchase.id, reference_number: purchase.purchase_number, reason,
  });
  return { cancelled: true };
}

/** Snapshot helper: pick item code/name/unit from material or product master */
export function snapshotItem(itemType, master) {
  if (!master) return { item_code: '', item_name: '', base_unit: 'unit', category_name: '' };
  if (itemType === 'material') {
    return { item_code: master.code || '', item_name: master.name || '', base_unit: master.unit || 'gram', category_name: master.category_name || '' };
  }
  return { item_code: master.code || '', item_name: master.name || '', base_unit: master.unit || 'unit', category_name: master.category_name || '' };
}