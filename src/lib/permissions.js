/**
 * Centralized permission catalog and helpers.
 * Permissions are stored per-user as: { [menuKey]: { view, create, edit, delete, post, cancel, print, approve } }
 * Admins bypass all checks; suspended users get no access.
 *
 * Master data is split per-entity (master_customers, master_materials, ...) so roles
 * like SALES can access only Customer. A legacy `master` key is kept for backward
 * compatibility with users saved before the split.
 */
export const ACTIONS = ['view', 'create', 'edit', 'delete'];

export const MENU_CATALOG = [
  { key: 'dashboard', label: 'Dashboard', group: 'utama', actions: ['view'] },
  { key: 'recipes', label: 'Resep', group: 'operasional', actions: ['view', 'create', 'edit', 'delete', 'approve'] },
  { key: 'production', label: 'Produksi', group: 'operasional', actions: ['view', 'create', 'edit', 'post', 'cancel'] },
  { key: 'premix', label: 'Produksi Premix', group: 'operasional', actions: ['view', 'create', 'edit', 'post', 'cancel'] },
  { key: 'premix_batch', label: 'Batch Premix', group: 'operasional', actions: ['view', 'adjust'] },
  { key: 'bottling', label: 'Bottling', group: 'operasional', actions: ['view', 'create', 'edit', 'post', 'cancel'] },
  { key: 'labeling', label: 'Labeling', group: 'operasional', actions: ['view', 'create', 'edit', 'post', 'cancel'] },
  { key: 'excise', label: 'Proses Cukai', group: 'operasional', actions: ['view', 'create', 'edit', 'post', 'cancel'] },
  { key: 'purchases', label: 'Pembelian', group: 'operasional', actions: ['view', 'create', 'edit', 'post', 'cancel', 'print'] },
  { key: 'sales', label: 'Penjualan', group: 'operasional', actions: ['view', 'create', 'edit', 'delete', 'post', 'print'] },
  { key: 'payments', label: 'Pembayaran Piutang', group: 'operasional', actions: ['view', 'create', 'edit'] },
  { key: 'stock_card', label: 'Kartu Stok', group: 'operasional', actions: ['view'] },
  { key: 'report_sales', label: 'Laporan Penjualan', group: 'laporan', actions: ['view'] },
  { key: 'report_receivables', label: 'Laporan Piutang', group: 'laporan', actions: ['view'] },
  { key: 'traceability', label: 'Traceability Batch', group: 'laporan', actions: ['view'] },
  { key: 'master_brands', label: 'Master Merk', group: 'master', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'master_categories', label: 'Master Kategori', group: 'master', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'master_suppliers', label: 'Master Supplier', group: 'master', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'master_customers', label: 'Master Customer', group: 'master', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'master_materials', label: 'Master Bahan', group: 'master', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'master_products', label: 'Master Barang', group: 'master', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'master_warehouses', label: 'Master Gudang', group: 'master', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'master', label: 'Master Data (legacy)', group: 'master', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'report_pdf', label: 'Export PDF Laporan', group: 'sistem', actions: ['view'] },
  { key: 'invoice_pdf', label: 'Export PDF Invoice', group: 'sistem', actions: ['view'] },
  { key: 'users', label: 'Manajemen Pengguna', group: 'sistem', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'settings', label: 'Pengaturan', group: 'sistem', actions: ['view'] },
];

const MASTER_ENTITY_KEYS = ['master_brands', 'master_categories', 'master_suppliers', 'master_customers', 'master_materials', 'master_products', 'master_warehouses'];

/** Operator (role=user) default permissions. */
const OPERATOR_DEFAULTS = {
  dashboard: { view: true },
  recipes: { view: true, create: true, edit: true, delete: false, approve: false },
  production: { view: true, create: true, edit: true, post: true, cancel: false },
  premix: { view: true, create: true, edit: true, post: true, cancel: false },
  premix_batch: { view: true, adjust: false },
  bottling: { view: true, create: true, edit: true, post: true, cancel: false },
  labeling: { view: true, create: true, edit: true, post: true, cancel: false },
  excise: { view: true, create: true, edit: true, post: true, cancel: false },
  purchases: { view: true, create: true, edit: true, post: true, cancel: false, print: true },
  sales: { view: true, create: true, edit: true, delete: false, post: true, print: true },
  payments: { view: true, create: true, edit: true },
  stock_card: { view: true },
  report_sales: { view: true },
  report_receivables: { view: true },
  traceability: { view: true },
  master: { view: true, create: true, edit: true, delete: false },
  ...Object.fromEntries(MASTER_ENTITY_KEYS.map((k) => [k, { view: true, create: true, edit: true, delete: false }])),
  report_pdf: { view: true },
  invoice_pdf: { view: true },
  users: { view: false, create: false, edit: false, delete: false },
  settings: { view: false },
};

/** Sales: customer + invoice + piutang terkait. */
const SALES_DEFAULTS = {
  dashboard: { view: true },
  sales: { view: true, create: true, edit: true, delete: false, post: true, print: true },
  payments: { view: true },
  stock_card: { view: true },
  master_customers: { view: true, create: true, edit: true, delete: false },
  master_products: { view: true, create: false, edit: false, delete: false },
  report_sales: { view: true },
  report_receivables: { view: true },
  report_pdf: { view: true },
  invoice_pdf: { view: true },
};

/** Kepala Produksi: bahan/produk/supplier + pembelian + produksi + bottling/labeling/cukai + stok/traceability. */
const PRODUCTION_HEAD_DEFAULTS = {
  dashboard: { view: true },
  recipes: { view: true, create: false, edit: false, delete: false, approve: false },
  production: { view: true, create: true, edit: true, post: true, cancel: true },
  premix: { view: true, create: true, edit: true, post: true, cancel: true },
  premix_batch: { view: true, adjust: false },
  bottling: { view: true, create: true, edit: true, post: true, cancel: true },
  labeling: { view: true, create: true, edit: true, post: true, cancel: true },
  excise: { view: true, create: true, edit: true, post: true, cancel: true },
  purchases: { view: true, create: true, edit: true, post: true, cancel: true, print: true },
  stock_card: { view: true },
  traceability: { view: true },
  master_materials: { view: true, create: true, edit: true, delete: false },
  master_products: { view: true, create: true, edit: true, delete: false },
  master_suppliers: { view: true, create: true, edit: true, delete: false },
  master_brands: { view: true, create: false, edit: false, delete: false },
  master_categories: { view: true, create: false, edit: false, delete: false },
  master_warehouses: { view: true, create: false, edit: false, delete: false },
  report_pdf: { view: true },
  invoice_pdf: { view: true },
};

/** Brewer: resep (view approved) + produksi (create + aktual) + stok bahan. */
const BREWER_DEFAULTS = {
  dashboard: { view: true },
  recipes: { view: true, create: false, edit: false, delete: false, approve: false },
  production: { view: true, create: true, edit: false, post: false, cancel: false },
  premix: { view: true, create: true, edit: false, post: false, cancel: false },
  stock_card: { view: true },
  traceability: { view: true },
};

const ROLE_DEFAULTS = {
  user: OPERATOR_DEFAULTS,
  sales: SALES_DEFAULTS,
  production_head: PRODUCTION_HEAD_DEFAULTS,
  brewer: BREWER_DEFAULTS,
};

export function hasPermission(user, menu, action = 'view') {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.status === 'suspended') return false;
  const matrix = user.permissions && Object.keys(user.permissions).length > 0
    ? user.permissions
    : getDefaultPermissions(user.role || 'user');
  let mp = matrix[menu];
  // Backward-compat: legacy 'master' key covers per-entity master_* menus for
  // users saved before the master split.
  if (!mp && menu.startsWith('master_') && matrix.master) mp = matrix.master;
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
  const defaults = ROLE_DEFAULTS[role] || OPERATOR_DEFAULTS;
  for (const k of Object.keys(defaults)) {
    base[k] = { ...base[k], ...defaults[k] };
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

/**
 * Ordered route → permission map. Drives the permission-aware landing page:
 * after login the user is sent to the first route they can `view`, never to a
 * page they lack access to. Order mirrors the sidebar (Layout.jsx menuItems).
 */
export const ROUTE_ACCESS = [
  { route: '/', perm: 'dashboard' },
  { route: '/recipes', perm: 'recipes' },
  { route: '/production', perm: 'production' },
  { route: '/bottling', perm: 'bottling' },
  { route: '/labeling', perm: 'labeling' },
  { route: '/excise', perm: 'excise' },
  { route: '/purchases', perm: 'purchases' },
  { route: '/sales', perm: 'sales' },
  { route: '/payments', perm: 'payments' },
  { route: '/stock-card', perm: 'stock_card' },
  { route: '/reports/sales', perm: 'report_sales' },
  { route: '/reports/receivables', perm: 'report_receivables' },
  { route: '/traceability', perm: 'traceability' },
  { route: '/master/brands', perm: 'master_brands' },
  { route: '/master/categories', perm: 'master_categories' },
  { route: '/master/suppliers', perm: 'master_suppliers' },
  { route: '/master/customers', perm: 'master_customers' },
  { route: '/master/materials', perm: 'master_materials' },
  { route: '/master/products', perm: 'master_products' },
  { route: '/master/warehouses', perm: 'master_warehouses' },
  { route: '/users', perm: 'users' },
  { route: '/settings', perm: 'settings' },
];

/** First route the user may view, or null if they have no view permission at all. */
export function getFirstAccessibleRoute(user) {
  return ROUTE_ACCESS.find((r) => hasPermission(user, r.perm, 'view'))?.route || null;
}

/** Whether the user may view a given path. Unknown routes pass (public/auth pages). */
export function canAccessRoute(user, path) {
  if (user?.role === 'admin') return true;
  const entry = ROUTE_ACCESS.find((r) => r.route === path);
  if (!entry) return true;
  return hasPermission(user, entry.perm, 'view');
}