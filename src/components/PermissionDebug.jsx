import React from 'react';
import { useAuth } from '@/lib/AuthContext';
import { appParams } from '@/lib/app-params';
import { hasPermission } from '@/lib/permissions';

// TEMPORARY diagnostic panel — remove after root cause is found.
// Shows the ACTUAL current user object + per-menu permission check as rendered.
const MENU_CHECKS = [
  { menu: 'Dashboard', perm: 'dashboard' },
  { menu: 'Resep', perm: 'recipes' },
  { menu: 'Produksi', perm: 'production' },
  { menu: 'Bottling', perm: 'bottling' },
  { menu: 'Labeling', perm: 'labeling' },
  { menu: 'Cukai', perm: 'excise' },
  { menu: 'Pembelian', perm: 'purchases' },
  { menu: 'Penjualan', perm: 'sales' },
  { menu: 'Piutang', perm: 'payments' },
  { menu: 'Kartu Stok', perm: 'stock_card' },
  { menu: 'Master Data', perm: 'master' },
  { menu: 'Users', perm: 'users' },
  { menu: 'Settings', perm: 'settings' },
];

export default function PermissionDebug() {
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const token = appParams.token;
  const permKeys = user?.permissions ? Object.keys(user.permissions) : [];

  // Console log once per render for inspection.
  React.useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('=== PERMISSION DEBUG ===', {
      isLoadingAuth,
      isAuthenticated,
      tokenPresent: !!token,
      tokenLen: token ? token.length : 0,
      user,
      menuCheck: MENU_CHECKS.map((m) => ({
        menu: m.menu,
        requiredPermission: `${m.perm}.view`,
        hasPermission: hasPermission(user, m.perm, 'view'),
      })),
    });
  });

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[100] max-h-[45vh] overflow-auto bg-black/95 text-white text-[11px] font-mono p-3 border-t-2 border-yellow-400">
      <div className="font-bold text-yellow-400 mb-1">TEMP DEBUG — Permission Diagnosis</div>
      <div className="mb-1">isLoadingAuth={String(isLoadingAuth)} · isAuthenticated={String(isAuthenticated)} · tokenPresent={String(!!token)} (len={token ? token.length : 0})</div>
      <div className="mb-1 font-bold text-green-400">CURRENT USER:</div>
      <pre className="whitespace-pre-wrap break-all mb-2">
{JSON.stringify({
  id: user?.id || null,
  email: user?.email || null,
  role: user?.role || null,
  status: user?.status || null,
  full_name: user?.full_name || null,
  permissionsKeys: permKeys,
  permissions: user?.permissions || null,
}, null, 2)}
      </pre>
      <div className="mb-1 font-bold text-green-400">MENU CHECK:</div>
      <pre className="whitespace-pre-wrap break-all">
{JSON.stringify(MENU_CHECKS.map((m) => ({
  menu: m.menu,
  requiredPermission: `${m.perm}.view`,
  hasPermission: hasPermission(user, m.perm, 'view'),
})), null, 2)}
      </pre>
    </div>
  );
}