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
  { key: 'users', actions: ['view', 'create', 'edit', 'delete'] },
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
  users: { view: false, create: false, edit: false, delete: false },
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

function normalizeEmail(e) {
  return (e || '').trim().toLowerCase();
}

async function genUserCode(base44) {
  try {
    const r = await base44.functions.invoke('generateDocumentCode', { doc_type: 'user' });
    const d = r && r.data ? r.data : r;
    return (d && d.code) || '';
  } catch { return ''; }
}

// Decode the Bearer JWT from the request headers. The platform always sends the
// caller's access token here, so this is a reliable identity source even when the
// caller has no User entity record (base44.auth.me() = /entities/User/me 404s
// in that case).
function decodeJwt(req) {
  try {
    const h = req.headers || {};
    const raw = (h.get && (h.get('authorization') || h.get('Authorization'))) || h.authorization || '';
    const token = String(raw).replace(/^Bearer\s+/i, '').trim();
    if (!token) return null;
    const seg = token.split('.');
    if (seg.length < 2) return null;
    const b64 = seg[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    return JSON.parse(json);
  } catch { return null; }
}

/**
 * Idempotent sync of the authenticated user into the application profile.
 * Handles two cases:
 *  1. User has a User entity record (id == auth id) — fill missing defaults.
 *  2. User has NO User entity record (platform did not create one) — build the
 *     profile from the UserInvitation, link auth_user_id, generate user_code,
 *     mark the invitation accepted, and cancel duplicate invitations.
 * Always returns a complete profile (role, status, permissions, full_name,
 * user_code, last_login_at) so the frontend never renders an empty sidebar or
 * placeholder header.
 */
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);

    // Primary identity: base44.auth.me() (returns the User entity record when one
    // exists). Fallback: decode the JWT so users WITHOUT a User entity record
    // (platform did not create one) still resolve and get a profile from their
    // UserInvitation.
    let authUser = null;
    try { authUser = await base44.auth.me(); } catch { authUser = null; }
    const jwt = decodeJwt(req);
    const jwtId = jwt && (jwt.sub || jwt.user_id || jwt.id);
    const jwtEmail = jwt && (jwt.email || jwt.user_email || jwt.email_address);

    const authId = (authUser && authUser.id) || jwtId;
    const email = normalizeEmail((authUser && authUser.email) || jwtEmail || '');
    if (!authId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const now = new Date().toISOString();
    const sr = base44.asServiceRole;

    // 1. Look for an application User record (id == auth id).
    let appUser = null;
    try {
      appUser = await sr.entities.User.get(authId);
    } catch { appUser = null; }

    // 2. Look for invitations by email.
    let invs = [];
    try {
      invs = await sr.entities.UserInvitation.filter({ email });
    } catch { invs = []; }
    const acceptedInvs = invs.filter((i) => i.status === 'accepted');
    const pendingInvs = invs
      .filter((i) => i.status === 'pending')
      .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));

    // 3. Resolve role / full_name / permissions / user_code.
    const invForProfile = acceptedInvs[0] || pendingInvs[0] || null;
    const role = (appUser && appUser.role) || (invForProfile && invForProfile.role) || 'user';
    const status = (appUser && appUser.status) || 'active';
    const hasPerms = appUser && appUser.permissions && typeof appUser.permissions === 'object' && Object.keys(appUser.permissions).length > 0;
    const permissions = hasPerms ? appUser.permissions : defaultPermissions(role);
    const fullName =
      (appUser && appUser.full_name) ||
      (invForProfile && invForProfile.full_name) ||
      (authUser && authUser.full_name) ||
      (email ? email.split('@')[0] : 'Pengguna');
    let userCode = (appUser && appUser.user_code) || (invForProfile && invForProfile.user_code) || '';

    // 4. If a User record exists, fill any missing custom fields + last_login_at.
    if (appUser) {
      const upd = {};
      if (!appUser.role) upd.role = role;
      if (!appUser.status) upd.status = status;
      if (!hasPerms) upd.permissions = permissions;
      if (!appUser.user_code) {
        const c = userCode || (await genUserCode(base44));
        if (c) { upd.user_code = c; userCode = c; }
      }
      upd.last_login_at = now;
      if (Object.keys(upd).length > 0) {
        try { await sr.entities.User.update(authId, upd); } catch { /* best-effort */ }
      }
    }

    // 5. Reconcile invitations: mark the latest pending accepted, cancel duplicates.
    if (pendingInvs.length > 0) {
      const primary = pendingInvs[0];
      const code = userCode || primary.user_code || (await genUserCode(base44));
      if (code) userCode = code;
      try {
        await sr.entities.UserInvitation.update(primary.id, {
          status: 'accepted',
          accepted_at: now,
          auth_user_id: authId,
          user_code: code,
          last_login_at: now,
        });
      } catch { /* ignore */ }
      for (const dup of pendingInvs.slice(1)) {
        try { await sr.entities.UserInvitation.update(dup.id, { status: 'cancelled' }); } catch { /* ignore */ }
      }
    } else if (acceptedInvs.length > 0) {
      // Already accepted — ensure auth_user_id linked + last_login_at fresh.
      const acc = acceptedInvs[0];
      const upd = { last_login_at: now };
      if (!acc.auth_user_id) upd.auth_user_id = authId;
      if (!acc.user_code && userCode) upd.user_code = userCode;
      try { await sr.entities.UserInvitation.update(acc.id, upd); } catch { /* ignore */ }
      // Cancel any stray duplicates.
      for (const dup of acceptedInvs.slice(1)) {
        try { await sr.entities.UserInvitation.update(dup.id, { status: 'cancelled' }); } catch { /* ignore */ }
      }
    }

    return Response.json({
      id: authId,
      full_name: fullName,
      email: email || (authUser && authUser.email) || '',
      role,
      status,
      permissions,
      user_code: userCode,
      last_login_at: now,
      role_assigned: !!role,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}