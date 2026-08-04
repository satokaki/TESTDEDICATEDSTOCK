import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Mirror of src/lib/permissions.js — default permission matrix per role.
const MENU_CATALOG = [
  { key: 'dashboard', actions: ['view'] },
  { key: 'recipes', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'production', actions: ['view', 'create', 'edit'] },
  { key: 'premix', actions: ['view', 'create', 'edit', 'post', 'cancel'] },
  { key: 'premix_batch', actions: ['view', 'adjust'] },
  { key: 'bottling', actions: ['view', 'create'] },
  { key: 'labeling', actions: ['view', 'create'] },
  { key: 'excise', actions: ['view', 'create'] },
  { key: 'purchases', actions: ['view', 'create', 'edit'] },
  { key: 'sales', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'payments', actions: ['view', 'create', 'edit'] },
  { key: 'stock_card', actions: ['view'] },
  { key: 'report_sales', actions: ['view'] },
  { key: 'report_receivables', actions: ['view'] },
  { key: 'traceability', actions: ['view'] },
  { key: 'master', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'users', actions: ['view', 'create', 'edit'] },
  { key: 'settings', actions: ['view'] },
];

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

function defaultPermissions(role) {
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

/**
 * Idempotent user profile sync.
 * Called by the frontend after login. Ensures the app User record has a role,
 * status, permissions matrix, and user_code — filling defaults from a pending
 * invitation when present. Returns a complete profile so the frontend never
 * renders an empty sidebar / placeholder header due to missing fields.
 */
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const authUser = await base44.auth.me();
    if (!authUser) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const email = (authUser.email || '').toLowerCase();

    // Pending invitation (service role — UserInvitation is admin-only via RLS)
    let invitation = null;
    try {
      const invs = await base44.asServiceRole.entities.UserInvitation.filter({ email, status: 'pending' });
      invitation = invs && invs[0] ? invs[0] : null;
    } catch { invitation = null; }

    const role = authUser.role || (invitation && invitation.role) || 'user';
    const status = authUser.status || 'active';
    const hasPerms = authUser.permissions && typeof authUser.permissions === 'object' && Object.keys(authUser.permissions).length > 0;
    const permissions = hasPerms ? authUser.permissions : defaultPermissions(role);
    const fullName = authUser.full_name || (invitation && invitation.full_name) || '';

    // Persist missing custom fields (best-effort via service role)
    const updates = {};
    if (!authUser.role) updates.role = role;
    if (!authUser.status) updates.status = status;
    if (!hasPerms) updates.permissions = permissions;
    if (!authUser.user_code) {
      try {
        const r = await base44.functions.invoke('generateDocumentCode', { doc_type: 'user' });
        const d = r && r.data ? r.data : r;
        if (d && d.code) updates.user_code = d.code;
      } catch { /* ignore — code generated later */ }
    }
    if (Object.keys(updates).length > 0) {
      try { await base44.asServiceRole.entities.User.update(authUser.id, updates); } catch { /* best-effort */ }
    }

    // Mark invitation accepted on first login
    if (invitation) {
      try {
        await base44.asServiceRole.entities.UserInvitation.update(invitation.id, {
          status: 'accepted',
          accepted_at: new Date().toISOString(),
        });
      } catch { /* ignore */ }
    }

    return Response.json({
      id: authUser.id,
      full_name: fullName,
      email: authUser.email,
      role,
      status,
      permissions,
      user_code: updates.user_code || authUser.user_code || '',
      role_assigned: !!role,
      invitation_status: invitation ? 'accepted' : null,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}