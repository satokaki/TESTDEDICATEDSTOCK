// Shared constants & helpers for Database Management (backup / reset / restore / download).
// Pure logic + web-standard APIs only (no SDK import). Backend functions pass `base44`
// (service-role) into the helpers. Imported from Deno backend functions.

export const APP_ENVIRONMENT = 'development'; // 'development' | 'staging' | 'production'
export const APP_VERSION = '1.0.0';
export const SCHEMA_VERSION = '2026.08';
export const APPLICATION_NAME = 'LAB PRO';
export const MAX_RESTORE_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

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

// Operational backup entities (master + recipes + transactions + stock + HPP + batch).
// No User / auth / secrets.
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

// FULL backup = operational + User (export-only; User is NOT restored — platform-managed).
export const FULL_BACKUP_ENTITIES = [...BACKUP_ENTITIES, 'User'];

// Restore order: parent first (so FK idMaps exist before children reference them).
// User intentionally excluded — cannot be recreated via SDK (platform-managed).
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
const SENSITIVE_FIELD_PATTERNS = ['password', 'secret', 'token', 'api_key', 'apikey', 'session', 'refresh_token', 'access_token'];

export function stripBuiltins(rec) {
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    if (BUILTIN_FIELDS.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

// Strip fields that look like credentials / secrets / tokens — never written to a backup file.
export function sanitizeRecord(rec) {
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    const lower = String(k).toLowerCase();
    if (SENSITIVE_FIELD_PATTERNS.some((p) => lower.includes(p))) continue;
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

// Portable backup file name: LABPRO_BACKUP_YYYY-MM-DD_HHMMSS.json
export function backupFileName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const ymd = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const ts = `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `LABPRO_BACKUP_${ymd}_${ts}.json`;
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

// ---- Encryption (Web Crypto AES-GCM + PBKDF2 — standard, no custom crypto) ----
function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
function b64ToBuf(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveAesKey(password, saltBytes) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptPayload(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return {
    encrypted: true,
    kdf: { algorithm: 'PBKDF2', salt: bufToB64(salt), iterations: 100000, hash: 'SHA-256' },
    iv: bufToB64(iv),
    ciphertext: bufToB64(ct),
  };
}

export async function decryptPayload(wrapper, password) {
  const salt = b64ToBuf(wrapper.kdf.salt);
  const iv = b64ToBuf(wrapper.iv);
  const key = await deriveAesKey(password, salt);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, b64ToBuf(wrapper.ciphertext));
  return new TextDecoder().decode(pt);
}

// Collect snapshot of given entities (service role, up to 10000 rows each), sanitized.
export async function collectSnapshot(base44, entities = BACKUP_ENTITIES) {
  const tables = {};
  let recordCount = 0;
  for (const name of entities) {
    try {
      const rows = await base44.asServiceRole.entities[name].list('-created_date', 10000);
      tables[name] = (rows || []).map((r) => sanitizeRecord(stripBuiltins(r)));
      recordCount += tables[name].length;
    } catch (_e) {
      tables[name] = [];
    }
  }
  return { tables, recordCount, tableCount: entities.length };
}

// Create a backup end-to-end: snapshot -> (optional encrypt) -> private file -> DatabaseBackup record.
export async function createBackup(base44, { name, notes, createdBy, environment, backupType = 'operational', encrypt = false, password }) {
  const entities = backupType === 'full' ? FULL_BACKUP_ENTITIES : BACKUP_ENTITIES;
  const { tables, recordCount, tableCount } = await collectSnapshot(base44, entities);
  const backupCode = await generateBackupCode(base44);
  const createdAt = new Date().toISOString();
  const env = environment || APP_ENVIRONMENT;
  const fileName = backupFileName();

  const tablesJson = JSON.stringify(tables);
  const checksum = await sha256hex(tablesJson);

  const manifest = {
    application: APPLICATION_NAME,
    backupId: backupCode,
    backupName: name || backupCode,
    createdAt,
    createdBy: createdBy || 'system',
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    environment: env,
    backupType,
    encrypted: !!encrypt,
    recordCount,
    tableCount,
    checksumAlgorithm: 'SHA-256',
    checksum,
  };

  const plaintext = JSON.stringify({ metadata: manifest, tables });
  let fileContent = plaintext;
  if (encrypt) {
    if (!password) throw new Error('Password enkripsi wajib');
    fileContent = JSON.stringify(await encryptPayload(plaintext, password));
  }
  const fileSize = new Blob([fileContent]).size;

  const db = base44.asServiceRole.entities.DatabaseBackup;
  const rec = await db.create({
    backup_code: backupCode,
    backup_name: name || backupCode,
    storage_path: '',
    file_name: fileName,
    file_size: fileSize,
    checksum,
    schema_version: SCHEMA_VERSION,
    app_version: APP_VERSION,
    environment: env,
    record_count: recordCount,
    table_count: tableCount,
    backup_type: backupType,
    encrypted: !!encrypt,
    status: 'CREATING',
    created_by: createdBy || 'system',
    created_at: createdAt,
    notes: notes || '',
  });

  try {
    const file = new File([new Blob([fileContent])], fileName, { type: 'application/json' });
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
    return { record: rec, checksum, recordCount, tableCount, fileSize, fileName };
  } catch (e) {
    try { await db.update(rec.id, { status: 'FAILED', notes: (notes || '') + ' | ERROR: ' + e.message }); } catch {}
    throw e;
  }
}

// Parse + validate an uploaded/stored backup file text. Self-contained: verifies the
// manifest checksum against the recomputed tables hash. `recordChecksum` enables a
// legacy fallback for backups made before the manifest-checksum scheme.
export async function parseAndValidateBackup(text, { password, recordChecksum } = {}) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { ok: false, error: 'File backup tidak valid atau bukan berasal dari LAB PRO.' }; }

  let metadata, tables, encrypted = false;
  if (parsed && parsed.encrypted === true) {
    encrypted = true;
    if (!password) return { ok: false, error: 'File backup terenkripsi. Masukkan password.', needsPassword: true };
    try {
      const pt = await decryptPayload(parsed, password);
      const inner = JSON.parse(pt);
      metadata = inner.metadata;
      tables = inner.tables;
    } catch {
      return { ok: false, error: 'Password salah atau file terenkripsi rusak.', needsPassword: true };
    }
  } else {
    metadata = parsed && parsed.metadata;
    tables = parsed && parsed.tables;
  }

  if (!metadata || !metadata.application) return { ok: false, error: 'Manifest tidak tersedia. Bukan file backup LAB PRO.' };
  if (metadata.application !== APPLICATION_NAME) return { ok: false, error: 'File backup bukan berasal dari LAB PRO.' };
  if (!tables || typeof tables !== 'object') return { ok: false, error: 'Struktur entity tidak lengkap.' };

  const recomputed = await sha256hex(JSON.stringify(tables));
  let checksumOk = false;
  if (metadata.checksum) {
    checksumOk = recomputed === metadata.checksum;
  } else if (recordChecksum) {
    // Legacy: whole-file hash vs record checksum
    checksumOk = (await sha256hex(text)) === recordChecksum;
  }
  if (!checksumOk) return { ok: false, error: 'Checksum tidak cocok. File backup mungkin rusak atau telah diubah.' };

  const schemaOk = metadata.schemaVersion === SCHEMA_VERSION;
  return { ok: true, metadata, tables, schemaOk, encrypted };
}

// Execute a restore from a validated tables snapshot: auto-backup -> delete -> recreate with remap.
export async function performRestore(base44, tables, { mode, autoBackup, createdBy }) {
  let autoBackupCode = null;
  if (autoBackup) {
    try {
      const ab = await createBackup(base44, {
        name: `Auto-backup sebelum restore`,
        notes: 'Auto backup otomatis sebelum restore',
        createdBy,
        environment: APP_ENVIRONMENT,
        backupType: 'operational',
      });
      autoBackupCode = ab.record.backup_code;
    } catch {}
  }

  const delEntities = [...TRANSACTION_ENTITIES, ...FULL_ONLY_ENTITIES];
  for (const name of delEntities) {
    try { await base44.asServiceRole.entities[name].deleteMany({}); } catch {}
  }

  const idMaps = {};
  const restored = {};
  for (const name of RESTORE_ORDER) {
    idMaps[name] = idMaps[name] || {};
    const rows = tables[name] || [];
    if (rows.length === 0) { restored[name] = 0; continue; }
    let count = 0;
    if (isReferencedByOthers(name)) {
      for (const row of rows) {
        const cleaned = stripBuiltins(row);
        const remapped = remapRecord(name, cleaned, idMaps);
        try {
          const created = await base44.asServiceRole.entities[name].create(remapped);
          if (created && created.id && row.id) idMaps[name][row.id] = created.id;
          count++;
        } catch {}
      }
    } else {
      const payload = rows.map((r) => remapRecord(name, stripBuiltins(r), idMaps));
      try {
        await base44.asServiceRole.entities[name].bulkCreate(payload);
        count = payload.length;
      } catch {
        for (const p of payload) {
          try { await base44.asServiceRole.entities[name].create(p); count++; } catch {}
        }
      }
    }
    restored[name] = count;
  }
  return { autoBackupCode, restored };
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