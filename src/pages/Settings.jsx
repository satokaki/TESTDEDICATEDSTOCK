import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Shield, User, Save } from 'lucide-react';
import { getDefaultPermissions } from '@/lib/permissions';

const menus = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'recipes', label: 'Resep' },
  { key: 'production', label: 'Produksi' },
  { key: 'bottling', label: 'Bottling' },
  { key: 'labeling', label: 'Labeling' },
  { key: 'excise', label: 'Proses Cukai' },
  { key: 'purchases', label: 'Pembelian' },
  { key: 'sales', label: 'Penjualan' },
  { key: 'payments', label: 'Pembayaran Piutang' },
  { key: 'stock_card', label: 'Kartu Stok' },
  { key: 'reports', label: 'Laporan' },
  { key: 'master', label: 'Master Data' },
  { key: 'settings', label: 'Pengaturan' },
];

const actions = ['view', 'create', 'edit', 'delete', 'approve', 'post', 'cancel', 'print', 'export'];

export default function Settings() {
  const { toast } = useToast();
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [userItems, invs] = await Promise.all([
        base44.entities.User.list(),
        base44.entities.UserInvitation.list().catch(() => []),
      ]);
      const rows = userItems.map((u) => ({ ...u, kind: 'user' }));
      const usedEmails = new Set(rows.map((r) => (r.email || '').toLowerCase()));
      const seenInv = new Set();
      const invRows = invs
        .filter((i) => i.status !== 'cancelled')
        .filter((i) => {
          const e = (i.email || '').toLowerCase();
          if (usedEmails.has(e) || seenInv.has(e)) return false;
          seenInv.add(e);
          return true;
        })
        .map((i) => ({
          id: i.id, kind: 'invitation',
          full_name: i.full_name || '', email: i.email,
          role: i.role, status: 'active', permissions: i.permissions || {},
        }));
      setUsers([...rows, ...invRows]);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat data' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const selectUser = (user) => {
    setSelectedUser(user);
    const src = user.permissions && Object.keys(user.permissions).length > 0 ? user.permissions : getDefaultPermissions(user.role || 'user');
    const perms = src;
    const matrix = {};
    menus.forEach(m => {
      matrix[m.key] = {};
      actions.forEach(a => {
        if (user.role === 'admin') matrix[m.key][a] = true;
        else matrix[m.key][a] = perms[m.key]?.[a] || false;
      });
      matrix[m.key].view = true; // view always granted
    });
    setPermissions(matrix);
  };

  const togglePerm = (menuKey, action) => {
    if (selectedUser?.role === 'admin') return; // admin has all
    setPermissions(prev => ({ ...prev, [menuKey]: { ...prev[menuKey], [action]: !prev[menuKey]?.[action] } }));
  };

  const toggleMenuAll = (menuKey, value) => {
    if (selectedUser?.role === 'admin') return;
    setPermissions(prev => {
      const next = { ...prev };
      actions.forEach(a => { next[menuKey][a] = value; });
      next[menuKey].view = true;
      return next;
    });
  };

  const handleSave = async () => {
    if (!selectedUser) return;
    setSaving(true);
    try {
      const cleanPerms = {};
      menus.forEach(m => {
        cleanPerms[m.key] = {};
        actions.forEach(a => cleanPerms[m.key][a] = permissions[m.key]?.[a] || false);
      });
      if (selectedUser.kind === 'invitation') {
        // User belum punya record User — simpan permissions di undangan.
        await base44.entities.UserInvitation.update(selectedUser.id, { permissions: cleanPerms });
      } else {
        await base44.auth.updateMe({ permissions: cleanPerms }).catch(() => {});
        try {
          await base44.entities.User.update(selectedUser.id, { permissions: cleanPerms });
        } catch {
          // Fallback: updateMe only
        }
      }
      toast({ title: 'Permission disimpan', description: `Hak akses ${selectedUser.email} diperbarui` });
    } catch (e) { toast({ variant: 'destructive', title: 'Gagal menyimpan', description: e.message }); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader title="Pengaturan" description="Kelola hak akses user per menu dan aksi"
        actions={selectedUser && selectedUser.role !== 'admin' ? (
          <Button onClick={handleSave} size="sm" className="gap-1.5" disabled={saving}>
            <Save className="w-4 h-4" /> {saving ? 'Menyimpan...' : 'Simpan Permission'}
          </Button>
        ) : null} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* User List */}
        <div className="lg:col-span-1">
          <div className="bg-white border border-border rounded-lg p-3">
            <Label className="text-[12.5px] font-semibold mb-2 block">Daftar User</Label>
            <div className="space-y-1.5">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 bg-muted/50 rounded animate-pulse" />)
              ) : users.map(u => (
                <button
                  key={u.id}
                  onClick={() => selectUser(u)}
                  className={`w-full flex items-center gap-2.5 p-2.5 rounded-lg border transition-colors text-left ${selectedUser?.id === u.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/30'}`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold ${u.role === 'admin' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                    {u.full_name?.[0]?.toUpperCase() || u.email?.[0]?.toUpperCase() || 'U'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-semibold truncate">{u.full_name || u.email}</div>
                    <div className="text-[10.5px] text-muted-foreground flex items-center gap-1">
                      {u.role === 'admin' ? <><Shield className="w-2.5 h-2.5" /> Admin</> : <><User className="w-2.5 h-2.5" /> User</>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Permission Matrix */}
        <div className="lg:col-span-2">
          {selectedUser ? (
            <div className="bg-white border border-border rounded-lg p-4">
              <div className="mb-4 pb-3 border-b border-border">
                <h2 className="text-[15px] font-bold">{selectedUser.full_name || selectedUser.email}</h2>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  Role: <span className="font-semibold">{selectedUser.role}</span>
                  {selectedUser.role === 'admin' && ' · Admin memiliki akses penuh ke semua menu'}
                </p>
              </div>

              {selectedUser.role === 'admin' ? (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-[12px] text-blue-700 flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Admin memiliki akses ke seluruh menu dan aksi. Tidak perlu konfigurasi permission.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11.5px]">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="px-2 py-2 text-left font-semibold">Menu</th>
                        {actions.map(a => (
                          <th key={a} className="px-1.5 py-2 text-center font-semibold capitalize text-[10.5px]">{a}</th>
                        ))}
                        <th className="px-2 py-2 text-center">
                          <button onClick={() => {
                            const allEnabled = menus.every(m => actions.every(a => permissions[m.key]?.[a]));
                            menus.forEach(m => toggleMenuAll(m.key, !allEnabled));
                          }} className="text-[10px] hover:text-primary">Toggle All</button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {menus.map(menu => (
                        <tr key={menu.key} className="border-b border-border/40 hover:bg-muted/20">
                          <td className="px-2 py-1.5 font-medium">{menu.label}</td>
                          {actions.map(a => (
                            <td key={a} className="px-1.5 py-1.5 text-center">
                              <Switch
                                checked={permissions[menu.key]?.[a] || false}
                                onCheckedChange={() => togglePerm(menu.key, a)}
                                className="scale-75"
                              />
                            </td>
                          ))}
                          <td className="px-2 py-1.5 text-center">
                            <button onClick={() => toggleMenuAll(menu.key, !actions.every(a => permissions[menu.key]?.[a]))} className="text-[10px] text-primary hover:underline">
                              {actions.every(a => permissions[menu.key]?.[a]) ? 'Clear' : 'All'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white border border-border rounded-lg p-12 text-center text-muted-foreground">
              <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <div className="text-[13px]">Pilih user untuk mengatur hak akses</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}