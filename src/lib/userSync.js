import { base44 } from '@/api/base44Client';
import { getDefaultPermissions } from '@/lib/permissions';

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
  return ensureUserDefaults(me);
}