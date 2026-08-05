// Shared constants & helpers for Database Management (backup / reset / restore).
// Pure logic + web-standard APIs only (no SDK import). Backend functions pass `base44`
// (service-role) into the helpers. Imported from Deno backend functions.

export const APP_ENVIRONMENT = 'development'; // 'development' | 'staging' | 'production'
export const APP_VERSION = '1.0.0';
export const SCHEMA_VERSION = '2026.08';

// Entities NEVER touched by reset/restore (users/auth/permissions managed by platform).
export const PRESERVED_ENTITIES = ['User', 'UserInvitation', 'DocumentSequence', 'AuditLog', 'DatabaseBackup'];

// Transactional entities — deleted in BOTH reset modes. Order: child first (FK safety).
export const TRANSACTION_ENTITIES = [
  'PaymentAllocation',
  'CustomerPayment',
  'SaleItem',
  'Sale',
  'SupplierPayable',
  'PurchaseItem',
  'Purchase',
  'LabelingMaterial',
  'LabelingOrder',
  'BottlingOutput',
  'BottlingOrder',
  'PremixBatchComponent',
  'PremixBatch',
  'ProductionMaterial',
  'ProductionOrder',
  'ExciseOrder',
  'StockAdjustment',
  'StockLedger',
  'StockBalance',
];

// Master + recipe entities — deleted only in FULL mode. Order: child first.
export const FULL_ONLY_ENTITIES = [
  'RecipeIngredient',
  'Recipe',
  'Material',
  'Product',
  'Brand',
  'Category',
  'Supplier',
  'Customer',
  'Warehouse',
];

// Entities included in a backup snapshot (users/auth excluded — platform-managed).
export const BACKUP_ENTITIES = [
  'Brand', 'Category', 'Supplier', 'Customer', 'Warehouse',
  'Material', 'Product',
  'Recipe', 'RecipeIngredient',
  'ProductionOrder', 'ProductionMaterial',
  'PremixBatch', 'PremixBatchComponent',
  'BottlingOrder', 'BottlingOutput',
  'LabelingOrder', 'LabelingMaterial',
  'ExciseOrder',
  'Purchase', 'PurchaseItem', 'SupplierPayable',
  'Sale', 'SaleItem',
  'CustomerPayment', 'PaymentAllocation',
  'StockLedger', 'StockBalance', 'StockAdjustment',
];

// Restore order: parent first (so FK idMaps exist before children reference them).
export const RESTORE_ORDER = [
  'Brand', 'Category', 'Supplier', 'Customer', 'Warehouse',
  'Material', 'Product',
  'Recipe', 'RecipeIngredient',
  'ProductionOrder', 'ProductionMaterial',
  'PremixBatch', 'PremixBatchComponent',
  'BottlingOrder', 'BottlingOutput',
  'LabelingOrder', 'LabelingMaterial',
  'ExciseOrder',
  'Purchase', 'PurchaseItem', 'SupplierPayable',
  'Sale', 'SaleItem',
  'CustomerPayment', 'PaymentAllocation',
  'StockLedger', 'StockBalance', 'StockAdjustment',
];

// FK remap config: entity -> [{ field, ref }]. ref may be a string or an array
// (try each entity's idMap in order; first hit wins). item_id may be Material or Product.
export const RESTORE_REFS = {
  Product: [{ field: 'brand_id', ref: 'Brand' }, { field: 'category_id', ref: 'Category' }],
  Recipe: [{ field: 'brand_id', ref: 'Brand' }, { field: 'product_id', ref: 'Product' }, { field: 'output_material_id', ref: 'Material' }],
  RecipeIngredient: [{ field: 'recipe_id', ref: 'Recipe' }, { field: 'material_id', ref: 'Material' }],
  ProductionOrder: [{ field: 'recipe_id', ref: 'Recipe' }, { field: 'product_id', ref: 'Product' }, { field: 'brand_id', ref: 'Brand' }, { field: 'output_material_id', ref: 'Material' }, { field: 'output_batch_id', ref: 'PremixBatch' }],
  ProductionMaterial: [{ field: 'production_id', ref: 'ProductionOrder' }, { field: 'material_id', ref: 'Material' }],
  PremixBatch: [{ field: 'material_id', ref: 'Material' }, { field: 'recipe_id', ref: 'Recipe' }, { field: 'production_id', ref: 'ProductionOrder' }],
  PremixBatchComponent: [{ field: 'premix_batch_id', ref: 'PremixBatch' }, { field: 'component_material_id', ref: 'Material' }],
  BottlingOrder: [{ field: 'product_id', ref: 'Product' }, { field: 'brand_id', ref: 'Brand' }, { field: 'bottle_item_id', ref: 'Material' }],
  BottlingOutput: [{ field: 'bottling_id', ref: 'BottlingOrder' }, { field: 'product_id', ref: 'Product' }, { field: 'bottle_item_id', ref: 'Material' }],
  LabelingOrder: [{ field: 'product_id', ref: 'Product' }, { field: 'brand_id', ref: 'Brand' }, { field: 'label_item_id', ref: 'Material' }],
  LabelingMaterial: [{ field: 'labeling_id', ref: 'LabelingOrder' }, { field: 'label_item_id', ref: 'Material' }],
  ExciseOrder: [{ field: 'product_id', ref: 'Product' }, { field: 'brand_id', ref: 'Brand' }],
  Purchase: [{ field: 'supplier_id', ref: 'Supplier' }, { field: 'warehouse_id', ref: 'Warehouse' }],
  PurchaseItem: [{ field: 'purchase_id', ref: 'Purchase' }, { field: 'item_id', ref: ['Material', 'Product'] }, { field: 'warehouse_id', ref: 'Warehouse' }],
  SupplierPayable: [{ field: 'purchase_id', ref: 'Purchase' }, { field: 'supplier_id', ref: 'Supplier' }],
  Sale: [{ field: 'customer_id', ref: 'Customer' }, { field: 'warehouse_id', ref: 'Warehouse' }],
  SaleItem: [{ field: 'sale_id', ref: 'Sale' }, { field: 'product_id', ref: 'Product' }],
  CustomerPayment: [{ field: 'customer_id', ref: 'Customer' }],
  PaymentAllocation: [{ field: 'sale_id', ref: 'Sale' }, { field: 'payment_id', ref: 'CustomerPayment' }],
  StockLedger: [{ field: 'item_id', ref: ['Material', 'Product'] }, { field: 'warehouse_id', ref: 'Warehouse' }],
  StockBalance: [{ field: 'item_id', ref: ['Material', 'Product'] }, { field: 'warehouse_id', ref: 'Warehouse' }],
  StockAdjustment: [{ field: 'item_id', ref: ['Material', 'Product'] }, { field: 'warehouse_id', ref: 'Warehouse' }],
};

// DocumentSequence prefixes eligible for reset in development. USER sequence kept.
export const RESET_SEQUENCE_PREFIXES = ['MRK', 'KAT', 'SPL', 'GUD', 'BHN', 'PMX', 'PMXB', 'RCP', 'BRG', 'CUS', 'PRD', 'BATCH', 'BTL', 'LBL', 'CUK', 'PO', 'AP', 'INV', 'PAY', 'ADJ'];

const BUILTIN_FIELDS = ['id', 'created_date', 'updated_date', 'created_by_id', 'created_by'];

export function stripBuiltins(rec) {
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    if (BUILTIN_FIELDS.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

export async function sha256hex(str) {
  const buf = new TextEncoder().encode(str);
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function nowYMD() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

// Generate BKP-YYYYMMDD-NNNNN via DocumentSequence (optimistic lock, like generateDocumentCode).
export async function generateBackupCode(base44) {
  const ds = base44.asServiceRole.entities.DocumentSequence;
  const key = `BACKUP-${nowYMD()}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const existing = await ds.filter({ sequence_key: key });
    if (existing.length > 0) {
      const seq = existing[0];
      const current = seq.last_number || 0;
      const next = current + 1;
      const res = await ds.updateMany({ sequence_key: key, last_number: current }, { $set: { last_number: next } });
      if (res && (res.updated || res.modifiedCount) > 0) {
        return `BKP-${nowYMD()}-${String(next).padStart(5, '0')}`;
      }
    } else {
      try {
        await ds.create({ sequence_key: key, prefix: 'BKP', year: new Date().getFullYear(), last_number: 1 });
        return `BKP-${nowYMD()}-00001`;
      } catch { /* concurrent create; retry update path */ }
    }
  }
  return `BKP-${nowYMD()}-${Date.now()}`;
}

// Collect full snapshot of BACKUP_ENTITIES (service role, up to 10000 rows each).
export async function collectSnapshot(base44) {
  const tables = {};
  let recordCount = 0;
  for (const name of BACKUP_ENTITIES) {
    try {
      const rows = await base44.asServiceRole.entities[name].list('-created_date', 10000);
      tables[name] = (rows || []).map(stripBuiltins);
      recordCount += tables[name].length;
    } catch (_e) {
      tables[name] = [];
    }
  }
  return { tables, recordCount, tableCount: BACKUP_ENTITIES.length };
}

// Create a backup end-to-end: snapshot -> private file -> DatabaseBackup record.
// On failure marks the record FAILED and rethrows.
export async function createBackup(base44, { name, notes, createdBy, environment }) {
  const { tables, recordCount, tableCount } = await collectSnapshot(base44);
  const backupCode = await generateBackupCode(base44);
  const createdAt = new Date().toISOString();
  const env = environment || APP_ENVIRONMENT;
  const meta = {
    backupId: backupCode,
    backupName: name || backupCode,
    createdAt,
    createdBy: createdBy || 'system',
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    environment: env,
    tableCount,
    recordCount,
  };
  // Checksum is computed over the EXACT bytes stored in the file, and kept only on the
  // DatabaseBackup record (not inside the file's metadata) to avoid a self-referential hash.
  const finalJson = JSON.stringify({ metadata: meta, tables });
  const checksum = await sha256hex(finalJson);
  const fileSize = new Blob([finalJson]).size;

  const db = base44.asServiceRole.entities.DatabaseBackup;
  const rec = await db.create({
    backup_code: backupCode,
    backup_name: name || backupCode,
    storage_path: '',
    file_name: `${backupCode}.json`,
    file_size: fileSize,
    checksum,
    schema_version: SCHEMA_VERSION,
    app_version: APP_VERSION,
    environment: env,
    record_count: recordCount,
    table_count: tableCount,
    status: 'CREATING',
    created_by: createdBy || 'system',
    created_at: createdAt,
    notes: notes || '',
  });

  try {
    const file = new File([new Blob([finalJson])], `${backupCode}.json`, { type: 'application/json' });
    const up = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file });
    const fileUri = up.file_uri;
    await db.update(rec.id, {
      storage_path: fileUri,
      status: 'COMPLETED',
      completed_at: new Date().toISOString(),
    });
    rec.storage_path = fileUri;
    rec.status = 'COMPLETED';
    rec.completed_at = new Date().toISOString();
    return { record: rec, checksum, recordCount, tableCount, fileSize };
  } catch (e) {
    try { await db.update(rec.id, { status: 'FAILED', notes: (notes || '') + ' | ERROR: ' + e.message }); } catch {}
    throw e;
  }
}

// Remap FK string fields of a record using idMaps ({ entity: { oldId: newId } }).
// Best-effort: unmapped references are left as-is.
export function remapRecord(entityName, rec, idMaps) {
  const refs = RESTORE_REFS[entityName] || [];
  if (refs.length === 0) return rec;
  const out = { ...rec };
  for (const { field, ref } of refs) {
    const oldVal = out[field];
    if (!oldVal) continue;
    const refs2 = Array.isArray(ref) ? ref : [ref];
    let mapped = null;
    for (const r of refs2) {
      const m = idMaps[r];
      if (m && m[oldVal]) { mapped = m[oldVal]; break; }
    }
    if (mapped) out[field] = mapped;
  }
  return out;
}

// Whether any other entity references `name` (-> must be created one-by-one to capture new ids).
export function isReferencedByOthers(name) {
  return Object.values(RESTORE_REFS).some((arr) =>
    arr.some((r) => (Array.isArray(r.ref) ? r.ref : [r.ref]).includes(name))
  );
}