import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import FormModal from '@/components/FormModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ROLES, roleLabel } from '@/lib/roles';
import { MENU_CATALOG, getDefaultPermissions, normalizePermissions, hasPermission } from '@/lib/permissions';
import { generateUserCode } from '@/lib/sequence';
import { format } from 'date-fns';
import { UserPlus, Pencil, Shield, ShieldCheck, Trash2 } from 'lucide-react';

const actionLabel = { view: 'Lihat', create: 'Tambah', edit: 'Edit', delete: 'Hapus' };

const statusBadge = (status) => {
  const cls = {
    active: 'bg-emerald-100 text-emerald-700',
    inactive: 'bg-slate-200 text-slate-600',
    suspended: 'bg-red-100 text-red-700',
    deleted: 'bg-slate-300 text-slate-500',
    pending_invitation: 'bg-amber-100 text-amber-700',
  }[status] || 'bg-muted text-muted-foreground';
  const label = {
    active: 'Aktif', inactive: 'Nonaktif', suspended: 'Suspended',
    deleted: 'Dihapus', pending_invitation: 'Menunggu Login',
  }[status] || status;
  return <span className={`text-[11px] px-2 py-0.5 rounded font-semibold ${cls}`}>{label}</span>;
};

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
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  const canDelete = hasPermission(currentUser, 'users', 'delete');

  // Reconcile User records + invitations into one row per email.
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [users, invs] = await Promise.all([
        base44.entities.User.list('-created_date', 200),
        base44.entities.UserInvitation.list('-created_date', 200).catch(() => []),
      ]);
      const rows = users.map((u) => ({
        id: u.id, kind: 'user', user_code: u.user_code, full_name: u.full_name,
        email: u.email, role: u.role, status: u.status || 'active',
        last_login_at: u.last_login_at || u.updated_date,
      }));
      const usedEmails = new Set(rows.map((r) => (r.email || '').toLowerCase()));

      // Group invitations by email (prefer accepted > pending), skip cancelled.
      const invByEmail = {};
      for (const i of invs) {
        if (i.status === 'cancelled') continue;
        const e = (i.email || '').toLowerCase();
        if (usedEmails.has(e)) continue;
        const prev = invByEmail[e];
        if (!prev) { invByEmail[e] = i; continue; }
        // keep accepted over pending; else keep latest
        if (i.status === 'accepted' && prev.status !== 'accepted') invByEmail[e] = i;
        else if (i.status === prev.status && new Date(i.created_date) > new Date(prev.created_date)) invByEmail[e] = i;
      }
      const invRows = Object.values(invByEmail).map((i) => ({
        id: i.id, kind: 'invitation', user_code: i.user_code, full_name: i.full_name || '',
        email: i.email, role: i.role,
        status: i.status === 'accepted' ? 'active' : 'pending_invitation',
        last_login_at: i.last_login_at || i.accepted_at,
      }));
      setData([...rows, ...invRows]);
    } catch {
      toast({ variant: 'destructive', title: 'Gagal memuat data pengguna' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredData = useMemo(() => {
    if (statusFilter === 'all') return data;
    return data.filter((r) => r.status === statusFilter);
  }, [data, statusFilter]);

  const openInvite = () => { setInviteForm({ email: '', full_name: '', role: 'user' }); setInviteOpen(true); };

  const handleInvite = async () => {
    if (!inviteForm.email || !inviteForm.full_name) { toast({ variant: 'destructive', title: 'Nama dan email wajib diisi' }); return; }
    const email = inviteForm.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ variant: 'destructive', title: 'Format email tidak valid' });
      return;
    }
    // Dedup: reject if active user or active/pending invitation already exists.
    const exists = data.find((r) => (r.email || '').toLowerCase() === email && r.status !== 'inactive' && r.status !== 'deleted');
    if (exists) {
      toast({ variant: 'destructive', title: 'Pengguna dengan email ini sudah terdaftar atau memiliki undangan aktif.' });
      return;
    }
    // Guard: the platform invitation endpoint needs a valid active App ID.
    if (!appParams.appId) {
      toast({
        type: 'error',
        title: 'App ID belum dikonfigurasi',
        description: 'Publish ulang aplikasi dari builder Base44 agar App ID aktif terpasang, lalu muat ulang halaman.',
        duration: 7000,
      });
      return;
    }
    setSubmitting(true);
    try {
      // Call the platform invitation endpoint first; only track locally on success
      // to avoid dangling UserInvitation records when the endpoint rejects.
      await base44.users.inviteUser(email, inviteForm.role);
      await base44.entities.UserInvitation.create({
        email,
        full_name: inviteForm.full_name,
        role: inviteForm.role,
        status: 'pending',
        invited_by: currentUser?.full_name || currentUser?.email || '',
      });
      toast({ title: 'Undangan terkirim', description: `${inviteForm.full_name} · ${email}` });
      setInviteOpen(false);
      loadData();
    } catch (e) {
      const errData = e?.response?.data || {};
      const msg = (errData.message || errData.detail || errData.error || e.message || '').toString();
      if (/app not found/i.test(msg)) {
        toast({
          type: 'error',
          title: 'Undangan gagal — layanan tidak menemukan aplikasi (App not found)',
          description: 'App ID pada build ini kemungkinan kedaluwarsa. Publish ulang aplikasi dari builder Base44, muat ulang halaman, lalu undang ulang. Pengguna lama tetap dapat login.',
          duration: 9000,
        });
      } else {
        toast({ variant: 'destructive', title: 'Gagal mengundang', description: msg || 'Terjadi kesalahan' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (item) => {
    setEditing(item);
    setEditForm({
      role: item.role || 'user',
      status: item.status === 'pending_invitation' ? 'active' : (item.status || 'active'),
      permissions: normalizePermissions(item.permissions || getDefaultPermissions(item.role || 'user')),
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
        permissions: normalizePermissions(editForm.permissions),
      };
      if (editing.kind === 'invitation') {
        // User belum punya record User — simpan role & permissions di undangan.
        await base44.entities.UserInvitation.update(editing.id, payload);
        toast({ title: 'Pengguna diperbarui' });
        setEditOpen(false);
        loadData();
        return;
      }
      payload.status = editForm.status;
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

  const openDelete = (row) => { setDeleteTarget(row); setDeleteReason(''); };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await base44.functions.invoke('deactivateUser', { email: deleteTarget.email, reason: deleteReason });
      const d = res && res.data ? res.data : res;
      if (d && d.error) { toast({ variant: 'destructive', title: d.error }); return; }
      toast({ title: 'Pengguna dinonaktifkan', description: deleteTarget.email });
      setDeleteTarget(null);
      loadData();
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || 'Gagal menonaktifkan';
      toast({ variant: 'destructive', title: msg });
    } finally {
      setDeleting(false);
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
    { key: 'status', header: 'Status', render: (row) => statusBadge(row.status) },
    {
      key: 'last_login_at', header: 'Login Terakhir', sortable: true,
      render: (row) => row.last_login_at ? format(new Date(row.last_login_at), 'dd MMM yyyy, HH:mm') : '—',
    },
    {
      key: 'actions', header: '', width: '90px',
      render: (row) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => openEdit(row)}
            disabled={row.kind === 'user' && row.id === currentUser?.id}
            className="p-1.5 hover:bg-muted rounded disabled:opacity-30"
            title={row.kind === 'invitation' ? 'Edit undangan (role/akses)' : row.id === currentUser?.id ? 'Tidak bisa edit diri sendiri dari sini' : 'Edit'}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          {canDelete && row.status !== 'inactive' && row.status !== 'deleted' && (
            <button
              onClick={() => openDelete(row)}
              disabled={row.email?.toLowerCase() === currentUser?.email?.toLowerCase()}
              className="p-1.5 hover:bg-red-50 rounded text-red-600 disabled:opacity-30"
              title={row.email?.toLowerCase() === currentUser?.email?.toLowerCase() ? 'Tidak bisa menghapus akun sendiri' : 'Nonaktifkan pengguna'}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader
        title="Manajemen Pengguna"
        description="Kelola pengguna, peran, dan hak akses per menu"
        actions={
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-[150px] text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="active">Aktif</SelectItem>
                <SelectItem value="pending_invitation">Menunggu Login</SelectItem>
                <SelectItem value="inactive">Nonaktif</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="deleted">Dihapus</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={openInvite} size="sm" className="gap-1.5"><UserPlus className="w-4 h-4" /> Undang Pengguna</Button>
          </div>
        }
      />
      <DataTable
        columns={columns}
        data={filteredData}
        loading={loading}
        emptyMessage="Belum ada pengguna"
        searchKeys={['user_code', 'full_name', 'email']}
        searchPlaceholder="Cari pengguna..."
      />

      {/* Invite modal */}
      <FormModal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Undang Pengguna" onSubmit={handleInvite} submitting={submitting} submitLabel="Kirim Undangan">
        <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 text-[11.5px] text-blue-700 mb-2">
          Pengguna akan menerima email undangan untuk bergabung ke aplikasi ini. Role & nama akan otomatis terpasang saat login pertama.
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
            <Select value={editForm.role} onValueChange={setRolePreset}>
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
                <SelectItem value="inactive">Nonaktif</SelectItem>
                <SelectItem value="deleted">Dihapus</SelectItem>
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

      {/* Delete / deactivate confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus pengguna {deleteTarget?.full_name || deleteTarget?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              Pengguna tidak akan dapat mengakses aplikasi, tetapi histori transaksi tetap dipertahankan.
              Email: {deleteTarget?.email}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Label className="text-[12.5px] mb-1">Alasan (opsional)</Label>
            <Textarea
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              className="min-h-[60px] text-[13px]"
              placeholder="Contoh: resign, pindah divisi, dll."
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? 'Memproses...' : 'Hapus Pengguna'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}