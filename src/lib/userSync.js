import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';
import { getDefaultPermissions } from '@/lib/permissions';

// Decode the local access token (JWT) so we can recover the caller's id + email
// even when both syncUserProfile and base44.auth.me() are unavailable.
function decodeJwtToken(token) {
  try {
    const t = String(token || '').replace(/^Bearer\s+/i, '').trim();
    if (!t) return null;
    const seg = t.split('.');
    if (seg.length < 2) return null;
    const b64 = seg[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(b64)));
    return JSON.parse(json);
  } catch { return null; }
}

/**
 * Client-side fallback: ensure a user object always carries role/status/permissions
 * defaults so the sidebar and header never render empty due to missing fields.
 */
export function ensureUserDefaults(user) {
  if (!user) return null;
  const role = user.role || 'user';
  const hasPerms = user.permissions && Object.keys(user.permissions).length > 0;
  return {
    ...user,
    role,
    status: user.status || 'active',
    permissions: hasPerms ? user.permissions : getDefaultPermissions(role),
    full_name: user.full_name || '',
  };
}

/**
 * Fetch the complete current-user profile via the syncUserProfile backend function.
 * Falls back to base44.auth.me() + client defaults if the function is unavailable.
 * Idempotent and safe to call on every login.
 */
export async function fetchProfile() {
  try {
    const res = await base44.functions.invoke('syncUserProfile', {});
    const d = res && res.data ? res.data : res;
    if (d && d.id) return d;
  } catch (e) {
    console.error('syncUserProfile failed, using fallback', e);
  }
  let me = null;
  try { me = await base44.auth.me(); } catch { /* ignore */ }
  if (me && me.id) return ensureUserDefaults(me);
  // Last-resort: decode the local JWT so an authenticated user never renders an
  // empty sidebar / "Belum Ada Role" when sync and me() both fail.
  const jwt = decodeJwtToken(appParams.token);
  if (jwt) {
    const id = jwt.sub || jwt.user_id || jwt.id;
    const email = jwt.email || jwt.user_email || '';
    if (id) {
      return ensureUserDefaults({
        id,
        email,
        full_name: email ? email.split('@')[0] : '',
        role: 'user',
      });
    }
  }
  return null;
}