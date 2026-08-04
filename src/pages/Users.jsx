import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import FormModal from '@/components/FormModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ROLES, roleLabel } from '@/lib/roles';
import { MENU_CATALOG, getDefaultPermissions, normalizePermissions } from '@/lib/permissions';
import { generateUserCode } from '@/lib/sequence';
import { UserPlus, Pencil, Shield, ShieldCheck } from 'lucide-react';

const actionLabel = { view: 'Lihat', create: 'Tambah', edit: 'Edit', delete: 'Hapus' };

export default function Users() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', full_name: '', role: 'user' });
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ role: 'user', status: 'active', permissions: {} });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [users, invs] = await Promise.all([
        base44.entities.User.list('-created_date', 200),
        base44.entities.UserInvitation.list('-created_date', 200).catch(() => []),
      ]);
      const usedEmails = new Set(users.map((u) => (u.email || '').toLowerCase()));
      const pendingRows = invs
        .filter((i) => i.status === 'pending' && !usedEmails.has((i.email || '').toLowerCase()))
        .map((i) => ({ id: i.id, kind: 'invitation', full_name: i.full_name || '', email: i.email, role: i.role, status: 'pending_invitation' }));
      setData([...users.map((u) => ({ ...u, kind: 'user' })), ...pendingRows]);
    } catch {
      toast({ variant: 'destructive', title: 'Gagal memuat data pengguna' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const openInvite = () => { setInviteForm({ email: '', full_name: '', role: 'user' }); setInviteOpen(true); };

  const handleInvite = async () => {
    if (!inviteForm.email || !inviteForm.full_name) { toast({ variant: 'destructive', title: 'Nama dan email wajib diisi' }); return; }
    setSubmitting(true);
    try {
      await base44.entities.UserInvitation.create({
        email: inviteForm.email.toLowerCase(),
        full_name: inviteForm.full_name,
        role: inviteForm.role,
        status: 'pending',
        invited_by: currentUser?.full_name || currentUser?.email || '',
      });
      await base44.users.inviteUser(inviteForm.email, inviteForm.role);
      toast({ title: 'Undangan terkirim', description: `${inviteForm.full_name} · ${inviteForm.email}` });
      setInviteOpen(false);
      loadData();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Gagal mengundang', description: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (item) => {
    setEditing(item);
    setEditForm({
      role: item.role || 'user',
      status: item.status || 'active',
      permissions: normalizePermissions(item.permissions),
    });
    setEditOpen(true);
  };

  const togglePerm = (menuKey, action) => {
    setEditForm((f) => {
      const row = { ...(f.permissions[menuKey] || {}) };
      row[action] = !row[action];
      return { ...f, permissions: { ...f.permissions, [menuKey]: row } };
    });
  };

  const setRolePreset = (role) => {
    setEditForm((f) => ({ ...f, role, permissions: getDefaultPermissions(role) }));
  };

  const handleSave = async () => {
    setSubmitting(true);
    try {
      const payload = {
        role: editForm.role,
        status: editForm.status,
        permissions: normalizePermissions(editForm.permissions),
      };
      // Assign user_code if missing
      if (!editing.user_code) {
        try { payload.user_code = await generateUserCode(); } catch { /* ignore */ }
      }
      await base44.entities.User.update(editing.id, payload);
      toast({ title: 'Pengguna diperbarui' });
      setEditOpen(false);
      loadData();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Gagal menyimpan', description: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    { key: 'user_code', header: 'Kode', sortable: true, className: 'font-mono font-medium', render: (row) => row.user_code || '—' },
    { key: 'full_name', header: 'Nama', sortable: true, className: 'font-medium', render: (row) => row.full_name || '—' },
    { key: 'email', header: 'Email', sortable: true },
    {
      key: 'role', header: 'Role', sortable: true,
      render: (row) => row.role === 'admin'
        ? <span className="text-[11px] px-2 py-0.5 bg-primary/10 text-primary rounded font-semibold inline-flex items-center gap-1"><ShieldCheck className="w-3 h-3" />{roleLabel(row.role)}</span>
        : <span className="text-[11px] px-2 py-0.5 bg-muted rounded">{roleLabel(row.role)}</span>,
    },
    {
      key: 'status', header: 'Status',
      render: (row) => row.status === 'pending_invitation'
        ? <span className="text-[11px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded font-semibold">Menunggu Login</span>
        : row.status === 'suspended'
        ? <span className="text-[11px] px-2 py-0.5 bg-red-100 text-red-700 rounded font-semibold">Suspended</span>
        : <span className="text-[11px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded font-semibold">Aktif</span>,
    },
    {
      key: 'actions', header: '', width: '70px',
      render: (row) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => openEdit(row)}
            disabled={row.id === currentUser?.id || row.kind === 'invitation'}
            className="p-1.5 hover:bg-muted rounded disabled:opacity-30"
            title={row.kind === 'invitation' ? 'Menunggu user login pertama kali' : row.id === currentUser?.id ? 'Tidak bisa edit diri sendiri dari sini' : 'Edit'}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader
        title="Manajemen Pengguna"
        description="Kelola pengguna, peran, dan hak akses per menu"
        actions={<Button onClick={openInvite} size="sm" className="gap-1.5"><UserPlus className="w-4 h-4" /> Undang Pengguna</Button>}
      />
      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        emptyMessage="Belum ada pengguna"
        searchKeys={['user_code', 'full_name', 'email']}
        searchPlaceholder="Cari pengguna..."
      />

      {/* Invite modal */}
      <FormModal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Undang Pengguna" onSubmit={handleInvite} submitting={submitting} submitLabel="Kirim Undangan">
        <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 text-[11.5px] text-blue-700 mb-2">
          Pengguna akan menerima email undangan untuk bergabung ke aplikasi ini.
        </div>
        <div className="space-y-3">
          <div>
            <Label className="text-[12.5px] mb-1">Nama Lengkap *</Label>
            <Input value={inviteForm.full_name} onChange={(e) => setInviteForm({ ...inviteForm, full_name: e.target.value })} className="h-9 text-[13px]" placeholder="Operator Lab" />
          </div>
          <div>
            <Label className="text-[12.5px] mb-1">Email *</Label>
            <Input type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} className="h-9 text-[13px]" placeholder="nama@perusahaan.com" />
          </div>
          <div>
            <Label className="text-[12.5px] mb-1">Peran</Label>
            <Select value={inviteForm.role} onValueChange={(v) => setInviteForm({ ...inviteForm, role: v })}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>{ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      </FormModal>

      {/* Edit modal with permission matrix */}
      <FormModal open={editOpen} onClose={() => setEditOpen(false)} title={`Edit Pengguna — ${editing?.full_name || editing?.email || ''}`} onSubmit={handleSave} submitting={submitting} submitLabel="Simpan" size="xl">
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <Label className="text-[12.5px] mb-1">Peran</Label>
            <Select value={editForm.role} onValueChange={(v) => setRolePreset(v)}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>{ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[12.5px] mb-1">Status</Label>
            <Select value={editForm.status} onValueChange={(v) => setEditForm((f) => ({ ...f, status: v }))}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Aktif</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {editForm.role === 'admin' ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded px-3 py-2 text-[11.5px] text-emerald-700 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" /> Administrator memiliki akses penuh ke semua menu.
          </div>
        ) : (
          <div className="border-t pt-3">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-[12.5px] font-semibold flex items-center gap-1"><Shield className="w-3.5 h-3.5" /> Hak Akses per Menu</Label>
              <span className="text-[11px] text-muted-foreground">Ubah peran untuk reset ke preset</span>
            </div>
            <div className="border rounded-md overflow-hidden max-h-72 overflow-y-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-muted/50 text-muted-foreground sticky top-0">
                  <tr>
                    <th className="px-2.5 py-1.5 text-left font-medium">Menu</th>
                    {['view', 'create', 'edit', 'delete'].map((a) => (
                      <th key={a} className="px-2 py-1.5 text-center font-medium w-16">{actionLabel[a]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MENU_CATALOG.map((m) => (
                    <tr key={m.key} className="border-t border-border/40">
                      <td className="px-2.5 py-1.5">{m.label}</td>
                      {['view', 'create', 'edit', 'delete'].map((a) => {
                        const allowed = m.actions.includes(a);
                        const checked = !!editForm.permissions[m.key]?.[a];
                        return (
                          <td key={a} className="px-2 py-1.5 text-center">
                            <input
                              type="checkbox"
                              disabled={!allowed}
                              checked={checked}
                              onChange={() => togglePerm(m.key, a)}
                              className="w-3.5 h-3.5 accent-primary disabled:opacity-30 cursor-pointer"
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </FormModal>
    </div>
  );
}