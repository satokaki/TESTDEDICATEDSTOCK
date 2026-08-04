/**
 * Centralized permission catalog and helpers.
 * Permissions are stored per-user as: { [menuKey]: { view, create, edit, delete } }
 * Admins bypass all checks; suspended users get no access.
 */
export const ACTIONS = ['view', 'create', 'edit', 'delete'];

export const MENU_CATALOG = [
  { key: 'dashboard', label: 'Dashboard', group: 'utama', actions: ['view'] },
  { key: 'recipes', label: 'Resep', group: 'operasional', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'production', label: 'Produksi', group: 'operasional', actions: ['view', 'create', 'edit'] },
  { key: 'premix', label: 'Produksi Premix', group: 'operasional', actions: ['view', 'create', 'edit', 'post', 'cancel'] },
  { key: 'premix_batch', label: 'Batch Premix', group: 'operasional', actions: ['view', 'adjust'] },
  { key: 'bottling', label: 'Bottling', group: 'operasional', actions: ['view', 'create'] },
  { key: 'labeling', label: 'Labeling', group: 'operasional', actions: ['view', 'create'] },
  { key: 'excise', label: 'Proses Cukai', group: 'operasional', actions: ['view', 'create'] },
  { key: 'purchases', label: 'Pembelian', group: 'operasional', actions: ['view', 'create', 'edit'] },
  { key: 'sales', label: 'Penjualan', group: 'operasional', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'payments', label: 'Pembayaran Piutang', group: 'operasional', actions: ['view', 'create', 'edit'] },
  { key: 'stock_card', label: 'Kartu Stok', group: 'operasional', actions: ['view'] },
  { key: 'report_sales', label: 'Laporan Penjualan', group: 'laporan', actions: ['view'] },
  { key: 'report_receivables', label: 'Laporan Piutang', group: 'laporan', actions: ['view'] },
  { key: 'traceability', label: 'Traceability Batch', group: 'laporan', actions: ['view'] },
  { key: 'master', label: 'Master Data', group: 'master', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'users', label: 'Manajemen Pengguna', group: 'sistem', actions: ['view', 'create', 'edit'] },
  { key: 'settings', label: 'Pengaturan', group: 'sistem', actions: ['view'] },
];

/** Operator (role=user) default permissions. */
const OPERATOR_DEFAULTS = {
  dashboard: { view: true },
  recipes: { view: true, create: true, edit: true, delete: false },
  production: { view: true, create: true, edit: true },
  premix: { view: true, create: true, edit: true, post: true, cancel: false },
  premix_batch: { view: true, adjust: false },
  bottling: { view: true, create: true },
  labeling: { view: true, create: true },
  excise: { view: true, create: true },
  purchases: { view: true, create: true, edit: true },
  sales: { view: true, create: true, edit: true, delete: false },
  payments: { view: true, create: true, edit: true },
  stock_card: { view: true },
  report_sales: { view: true },
  report_receivables: { view: true },
  traceability: { view: true },
  master: { view: true, create: true, edit: true, delete: false },
  users: { view: false, create: false, edit: false },
  settings: { view: false },
};

export function hasPermission(user, menu, action = 'view') {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.status === 'suspended') return false;
  // Fallback to operator defaults if no custom matrix saved yet (prevents lockout)
  const matrix = user.permissions && Object.keys(user.permissions).length > 0
    ? user.permissions
    : getDefaultPermissions('user');
  const mp = matrix[menu];
  return !!(mp && mp[action]);
}

/** Build a fresh permission matrix for a role (admin = all true). */
export function getDefaultPermissions(role) {
  const base = {};
  for (const m of MENU_CATALOG) {
    base[m.key] = {};
    for (const a of m.actions) base[m.key][a] = role === 'admin';
  }
  if (role === 'admin') return base;
  for (const k of Object.keys(OPERATOR_DEFAULTS)) {
    base[k] = { ...base[k], ...OPERATOR_DEFAULTS[k] };
  }
  return base;
}

/** Ensure a permission matrix has every catalog menu/action (fills missing with false). */
export function normalizePermissions(perm) {
  const out = {};
  for (const m of MENU_CATALOG) {
    const row = perm?.[m.key] || {};
    out[m.key] = {};
    for (const a of m.actions) out[m.key][a] = !!row[a];
  }
  return out;
}