import { base44 } from '@/api/base44Client';

/**
 * Record a stock movement: creates a StockLedger entry and updates StockBalance.
 * In production, this should run inside a backend function with DB transactions.
 */
export async function recordStockMovement({
  item_type, item_id, item_code, item_name,
  batch_id = '', batch_number = '',
  warehouse_id = '', warehouse_name = '',
  inventory_status = '',
  quantity_in = 0, quantity_out = 0, unit,
  unit_cost = 0,
  transaction_type, transaction_number,
  reference_type = '', reference_id = '',
  notes = '',
}) {
  // Create ledger entry
  await base44.entities.StockLedger.create({
    transaction_date: new Date().toISOString(),
    transaction_number,
    transaction_type,
    item_type,
    inventory_status,
    item_id,
    item_code: item_code || '',
    item_name,
    batch_id,
    batch_number,
    warehouse_id,
    warehouse_name,
    quantity_in,
    quantity_out,
    balance_quantity: 0,
    unit: unit || '',
    unit_cost: Number(unit_cost) || 0,
    reference_type,
    reference_id,
    notes,
  });

  // Update or create stock balance.
  // Unique balance key = item_id + batch_id + warehouse_id + inventory_status.
  // inventory_status separates BULK / READY_FOR_LABELING / UNEXCISED / READY_FOR_SALE
  // so a product changing stage never collapses into one balance row (prevents
  // double stock and net-0 "status changes"). Materials keep status '' to match
  // existing purchase-created balances (backward compatible).
  const filter = { item_id };
  if (batch_id) filter.batch_id = batch_id;
  if (warehouse_id) filter.warehouse_id = warehouse_id;
  if (inventory_status) filter.inventory_status = inventory_status;

  const balances = await base44.entities.StockBalance.filter(filter);
  if (balances.length > 0) {
    const bal = balances[0];
    const newQty = bal.quantity + quantity_in - quantity_out;
    if (newQty < 0) {
      throw new Error(`Stok tidak mencukupi untuk ${item_name}. Stok: ${bal.quantity}, dibutuhkan: ${quantity_out}`);
    }
    await base44.entities.StockBalance.update(bal.id, {
      quantity: newQty,
      available_quantity: newQty - (bal.reserved_quantity || 0),
    });
  } else {
    const qty = quantity_in - quantity_out;
    if (qty < 0) {
      throw new Error(`Stok tidak mencukupi untuk ${item_name}. Stok: 0, dibutuhkan: ${quantity_out}`);
    }
    await base44.entities.StockBalance.create({
      item_type,
      item_id,
      inventory_status,
      item_name,
      item_code: item_code || '',
      batch_id,
      batch_number,
      warehouse_id,
      warehouse_name,
      quantity: qty,
      reserved_quantity: 0,
      available_quantity: qty,
      unit: unit || '',
    });
  }
}

export async function getStockBalance(item_id, item_type = 'material') {
  const balances = await base44.entities.StockBalance.filter({ item_id, item_type });
  return balances.reduce((sum, b) => sum + (b.available_quantity || 0), 0);
}

export async function getAllStockBalances(item_type) {
  const filter = {};
  if (item_type) filter.item_type = item_type;
  return base44.entities.StockBalance.filter(filter);
}

export async function createAuditLog({ module, action, entity_type = '', entity_id = '', reference_number = '', data_before, data_after, reason = '' }) {
  try {
    const user = await base44.auth.me().catch(() => null);
    return base44.entities.AuditLog.create({
      action_time: new Date().toISOString(),
      user_name: user?.full_name || user?.email || 'System',
      module,
      action,
      entity_type,
      entity_id,
      reference_number,
      data_before: data_before ? JSON.stringify(data_before) : '',
      data_after: data_after ? JSON.stringify(data_after) : '',
      reason,
    });
  } catch {
    return null;
  }
}