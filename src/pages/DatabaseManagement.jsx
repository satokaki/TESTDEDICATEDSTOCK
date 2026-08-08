import React, { useEffect, useState, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import FormModal from '@/components/FormModal';
import { Save, RotateCcw, Upload, ShieldAlert, Trash2, Download, Lock, FileUp, CheckCircle2, AlertTriangle } from 'lucide-react';
import { APP_ENVIRONMENT, IS_PRODUCTION, RESET_CONFIRM_PHRASE, RESTORE_CONFIRM_PHRASE, MAX_RESTORE_FILE_SIZE } from '@/lib/dbEnv';

// Fetch a signed URL as a blob and force a browser download (never renders inline).
async function triggerDownload(signedUrl, fileName) {
  const res = await fetch(signedUrl);
  if (!res.ok) throw new Error('Gagal mengunduh file (status ' + res.status + ')');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'LABPRO_BACKUP.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function DatabaseManagement() {
  const { toast } = useToast();
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Save modal
  const [saveOpen, setSaveOpen] = useState(false);
  const [bkName, setBkName] = useState('');
  const [bkNotes, setBkNotes] = useState('');
  const [bkType, setBkType] = useState('operational');
  const [bkEncrypt, setBkEncrypt] = useState(false);
  const [bkPassword, setBkPassword] = useState('');
  const [lastBackup, setLastBackup] = useState(null); // { code, fileName, size }

  // Reset modal
  const [resetOpen, setResetOpen] = useState(false);
  const [resetMode, setResetMode] = useState('transaction');
  const [resetSequences, setResetSequences] = useState(true);
  const [skipBackup, setSkipBackup] = useState(false);
  const [resetPhrase, setResetPhrase] = useState('');
  const [resetAck, setResetAck] = useState(false);
  const [resetPassword, setResetPassword] = useState('');

  // Stored-backup restore modal
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreId, setRestoreId] = useState('');
  const [restoreMode, setRestoreMode] = useState('operational');
  const [restorePhrase, setRestorePhrase] = useState('');
  const [restoreAck, setRestoreAck] = useState(false);

  // File restore modal
  const [fileOpen, setFileOpen] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null); // { file_uri, file_name, file_size }
  const [preview, setPreview] = useState(null);
  const [validateError, setValidateError] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [filePassword, setFilePassword] = useState('');
  const [fileMode, setFileMode] = useState('operational');
  const [filePhrase, setFilePhrase] = useState('');
  const [fileAck, setFileAck] = useState(false);
  const fileInputRef = useRef(null);

  // Download permission is enforced by admin role on backend; DatabaseBackup RLS is admin-only.
  const downloadAllowed = true;

  const loadBackups = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await base44.entities.DatabaseBackup.list('-created_at', 200);
      setBackups(rows || []);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Gagal memuat backup', description: e.message });
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadBackups(); }, [loadBackups]);

  const fmtSize = (b) => { if (!b) return '-'; if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'; return (b / 1048576).toFixed(2) + ' MB'; };
  const fmtDate = (d) => (d ? new Date(d).toLocaleString('id-ID') : '-');
  const statusColor = { COMPLETED: 'bg-emerald-100 text-emerald-700', CREATING: 'bg-amber-100 text-amber-700', FAILED: 'bg-red-100 text-red-700', DELETED: 'bg-slate-100 text-slate-500' };
  const completedBackups = backups.filter((b) => b.status === 'COMPLETED');

  const doSave = async () => {
    if (bkEncrypt && !bkPassword) { toast({ variant: 'destructive', title: 'Masukkan password enkripsi' }); return; }
    setBusy(true);
    try {
      const res = await base44.functions.invoke('databaseBackup', {
        name: bkName, notes: bkNotes, backup_type: bkType, encrypt: bkEncrypt, password: bkEncrypt ? bkPassword : undefined,
      });
      const backup = res.data?.backup;
      toast({ title: 'Backup berhasil dibuat', description: backup?.backup_code });
      setLastBackup({ code: backup?.backup_code, fileName: backup?.file_name, size: backup?.file_size });
      // Auto-trigger download
      try {
        const dl = await base44.functions.invoke('databaseDownloadBackup', { backup_id: backup.id });
        await triggerDownload(dl.data.signed_url, dl.data.file_name);
        toast({ title: 'File terunduh', description: dl.data.file_name });
      } catch (e) {
        toast({ variant: 'destructive', title: 'Gagal mengunduh', description: e.response?.data?.error || e.message });
      }
      loadBackups();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Backup gagal', description: e.response?.data?.error || e.message });
    }
    setBusy(false);
  };

  const downloadBackup = async (b) => {
    setBusy(true);
    try {
      const dl = await base44.functions.invoke('databaseDownloadBackup', { backup_id: b.id });
      await triggerDownload(dl.data.signed_url, dl.data.file_name);
      toast({ title: 'File terunduh', description: dl.data.file_name });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Gagal mengunduh', description: e.response?.data?.error || e.message });
    }
    setBusy(false);
  };

  const reDownloadLast = async () => {
    if (!lastBackup) return;
    const rec = backups.find((b) => b.backup_code === lastBackup.code);
    if (rec) await downloadBackup(rec);
  };

  const doReset = async () => {
    if (resetPhrase !== RESET_CONFIRM_PHRASE) { toast({ variant: 'destructive', title: 'Kalimat konfirmasi belum sesuai' }); return; }
    if (!resetAck) { toast({ variant: 'destructive', title: 'Centang pemahaman risiko' }); return; }
    if (!resetPassword) { toast({ variant: 'destructive', title: 'Masukkan password' }); return; }
    setBusy(true);
    try {
      const res = await base44.functions.invoke('databaseReset', { mode: resetMode, resetSequences, skipBackup, confirm: resetPhrase });
      toast({ title: 'Reset selesai', description: `Mode ${resetMode} • ${res.data?.sequencesReset || 0} sequence direset` });
      setResetOpen(false); setResetPhrase(''); setResetAck(false); setResetPassword('');
      loadBackups();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Reset gagal', description: e.response?.data?.error || e.message });
    }
    setBusy(false);
  };

  const doRestore = async () => {
    if (!restoreId) { toast({ variant: 'destructive', title: 'Pilih backup' }); return; }
    if (restorePhrase !== RESTORE_CONFIRM_PHRASE) { toast({ variant: 'destructive', title: 'Kalimat konfirmasi belum sesuai' }); return; }
    if (!restoreAck) { toast({ variant: 'destructive', title: 'Centang pemahaman risiko' }); return; }
    setBusy(true);
    try {
      const res = await base44.functions.invoke('databaseRestore', { backup_id: restoreId, mode: restoreMode, confirm: restorePhrase, autoBackup: true });
      toast({ title: 'Restore selesai', description: res.data?.backup_code });
      setRestoreOpen(false); setRestorePhrase(''); setRestoreAck(false); setRestoreId('');
      loadBackups();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Restore gagal', description: e.response?.data?.error || e.message });
    }
    setBusy(false);
  };

  const resetFileState = () => {
    setUploadedFile(null); setPreview(null); setValidateError(''); setNeedsPassword(false); setFilePassword(''); setFilePhrase(''); setFileAck(false);
  };

  const onPickFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_RESTORE_FILE_SIZE) {
      toast({ variant: 'destructive', title: 'File terlalu besar', description: `Maksimum ${MAX_RESTORE_FILE_SIZE / 1048576} MB` });
      return;
    }
    setBusy(true);
    resetFileState();
    try {
      const up = await base44.integrations.Core.UploadPrivateFile({ file });
      setUploadedFile({ file_uri: up.file_uri, file_name: file.name, file_size: file.size });
      await validateFile(up.file_uri, file.name, file.size, undefined);
    } catch (e) {
      setValidateError(e.response?.data?.error || e.message || 'Gagal mengupload file');
    }
    setBusy(false);
  };

  const validateFile = async (file_uri, file_name, file_size, password) => {
    setValidateError(''); setPreview(null); setNeedsPassword(false);
    try {
      const res = await base44.functions.invoke('databaseValidateRestoreFile', { file_uri, file_name, file_size, password });
      setPreview(res.data?.preview);
      setNeedsPassword(false);
    } catch (e) {
      const data = e.response?.data;
      if (data?.needsPassword) { setNeedsPassword(true); setValidateError(data.error || 'File terenkripsi, masukkan password'); }
      else { setValidateError(data?.error || e.message || 'Validasi gagal'); setNeedsPassword(false); }
    }
  };

  const revalidateWithPassword = async () => {
    if (!uploadedFile || !filePassword) { toast({ variant: 'destructive', title: 'Masukkan password' }); return; }
    setBusy(true);
    await validateFile(uploadedFile.file_uri, uploadedFile.file_name, uploadedFile.file_size, filePassword);
    setBusy(false);
  };

  const doFileRestore = async () => {
    if (!uploadedFile) { toast({ variant: 'destructive', title: 'Pilih file backup' }); return; }
    if (!preview) { toast({ variant: 'destructive', title: 'File belum tervalidasi' }); return; }
    if (filePhrase !== RESTORE_CONFIRM_PHRASE) { toast({ variant: 'destructive', title: 'Kalimat konfirmasi belum sesuai' }); return; }
    if (!fileAck) { toast({ variant: 'destructive', title: 'Centang pemahaman risiko' }); return; }
    setBusy(true);
    try {
      const res = await base44.functions.invoke('databaseRestoreFromFile', {
        file_uri: uploadedFile.file_uri, file_name: uploadedFile.file_name, mode: fileMode, confirm: filePhrase, autoBackup: true, password: needsPassword ? filePassword : undefined,
      });
      toast({ title: 'Restore dari file selesai', description: res.data?.backup_code || '' });
      setFileOpen(false); resetFileState();
      loadBackups();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Restore gagal', description: e.response?.data?.error || e.message });
    }
    setBusy(false);
  };

  const deleteBackup = async (b) => {
    if (!window.confirm(`Hapus record backup ${b.backup_code}? (metadata ditandai DELETED; file storage tetap)`)) return;
    try {
      await base44.entities.DatabaseBackup.update(b.id, { status: 'DELETED' });
      loadBackups();
    } catch (e) { toast({ variant: 'destructive', title: 'Gagal', description: e.message }); }
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader title="Database Management" description={`Environment: ${APP_ENVIRONMENT.toUpperCase()} • Khusus Administrator`} />

      {IS_PRODUCTION && (
        <div className="mb-4 bg-red-50 border border-red-300 rounded-lg px-4 py-3 text-[13px] text-red-700 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" /> Reset &amp; Restore dinonaktifkan pada environment Production. Backup &amp; Download tetap tersedia.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white border rounded-lg p-4 flex flex-col">
          <div className="flex items-center gap-2 mb-2"><Save className="w-4 h-4 text-primary" /><h3 className="font-semibold text-[14px]">Save &amp; Download Backup</h3></div>
          <p className="text-[12px] text-muted-foreground mb-3 flex-1">Buat backup database lalu unduh file ke komputer / HP. Disimpan juga di server dengan checksum SHA-256.</p>
          <Button onClick={() => { setLastBackup(null); setSaveOpen(true); }} className="w-full"><Save className="w-4 h-4" /> Save Database</Button>
        </div>
        <div className="bg-white border rounded-lg p-4 flex flex-col">
          <div className="flex items-center gap-2 mb-2"><FileUp className="w-4 h-4 text-primary" /><h3 className="font-semibold text-[14px]">Restore from Backup File</h3></div>
          <p className="text-[12px] text-muted-foreground mb-3 flex-1">Pilih file backup (.json) dari local drive. Divalidasi sebelum restore dijalankan.</p>
          <Button variant="outline" onClick={() => { resetFileState(); setFileOpen(true); }} className="w-full"><FileUp className="w-4 h-4" /> Pilih File Backup</Button>
        </div>
        <div className="bg-white border rounded-lg p-4 flex flex-col">
          <div className="flex items-center gap-2 mb-2"><Upload className="w-4 h-4 text-primary" /><h3 className="font-semibold text-[14px]">Restore dari Backup Tersimpan</h3></div>
          <p className="text-[12px] text-muted-foreground mb-3 flex-1">Kembalikan database dari backup yang ada di server (lihat daftar di bawah).</p>
          <Button variant="outline" onClick={() => setRestoreOpen(true)} className="w-full"><Upload className="w-4 h-4" /> Lihat Backup Tersimpan</Button>
        </div>
        <div className="bg-white border border-red-200 rounded-lg p-4 flex flex-col">
          <div className="flex items-center gap-2 mb-2"><RotateCcw className="w-4 h-4 text-red-600" /><h3 className="font-semibold text-[14px] text-red-700">Reset Development Data</h3></div>
          <p className="text-[12px] text-muted-foreground mb-3 flex-1">Hapus data test dengan tetap mempertahankan user dan hak akses.</p>
          <Button variant="destructive" disabled={IS_PRODUCTION} onClick={() => setResetOpen(true)} className="w-full"><RotateCcw className="w-4 h-4" /> Reset Data</Button>
        </div>
      </div>

      <div className="bg-white border rounded-lg">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold text-[14px]">Daftar Backup</h3>
          <Button variant="ghost" size="sm" onClick={loadBackups} disabled={loading}>Refresh</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Kode</th>
                <th className="text-left px-3 py-2 font-medium">Nama</th>
                <th className="text-left px-3 py-2 font-medium">Tanggal</th>
                <th className="text-left px-3 py-2 font-medium">Dibuat Oleh</th>
                <th className="text-left px-3 py-2 font-medium">Jenis</th>
                <th className="text-right px-3 py-2 font-medium">Ukuran</th>
                <th className="text-right px-3 py-2 font-medium">Record</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">Memuat...</td></tr>}
              {!loading && backups.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">Belum ada backup</td></tr>}
              {!loading && backups.map((b) => (
                <tr key={b.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono">{b.backup_code}{b.encrypted && <Lock className="w-3 h-3 inline ml-1 text-amber-600" />}</td>
                  <td className="px-3 py-2">{b.backup_name}</td>
                  <td className="px-3 py-2">{fmtDate(b.created_at)}</td>
                  <td className="px-3 py-2">{b.created_by}</td>
                  <td className="px-3 py-2"><span className="px-2 py-0.5 rounded bg-muted text-[11px]">{b.backup_type === 'full' ? 'Full' : 'Operational'}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtSize(b.file_size)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{b.record_count}</td>
                  <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-[11px] ${statusColor[b.status] || 'bg-slate-100'}`}>{b.status}</span></td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" disabled={b.status !== 'COMPLETED' || !downloadAllowed} onClick={() => downloadBackup(b)} title="Download ke local"><Download className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="ghost" disabled={b.status !== 'COMPLETED' || IS_PRODUCTION} onClick={() => { setRestoreId(b.id); setRestoreOpen(true); }} title="Restore"><Upload className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteBackup(b)} title="Hapus"><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* SAVE MODAL */}
      <FormModal open={saveOpen} onClose={() => setSaveOpen(false)} title="Save & Download Backup" submitLabel={lastBackup ? 'Selesai' : 'Buat & Download Backup'} submitting={busy} onSubmit={lastBackup ? () => { setSaveOpen(false); setLastBackup(null); setBkName(''); setBkNotes(''); setBkType('operational'); setBkEncrypt(false); setBkPassword(''); } : doSave} size="md">
        {lastBackup ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="w-5 h-5" /><span className="font-semibold text-[14px]">Backup berhasil dibuat</span></div>
            <div className="bg-muted/40 rounded p-3 text-[12.5px] space-y-1">
              <div><span className="text-muted-foreground">Backup:</span> <span className="font-mono">{lastBackup.code}</span></div>
              <div><span className="text-muted-foreground">File:</span> <span className="font-mono break-all">{lastBackup.fileName}</span></div>
              <div><span className="text-muted-foreground">Ukuran:</span> {fmtSize(lastBackup.size)}</div>
            </div>
            <Button variant="outline" className="w-full" onClick={reDownloadLast}><Download className="w-4 h-4" /> Download Lagi</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div><Label>Nama Backup</Label><Input value={bkName} onChange={(e) => setBkName(e.target.value)} placeholder="Opsional — otomatis jika kosong" /></div>
            <div><Label>Catatan</Label><Textarea value={bkNotes} onChange={(e) => setBkNotes(e.target.value)} rows={2} placeholder="Alasan backup..." /></div>
            <div>
              <Label>Jenis Backup</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <button type="button" onClick={() => setBkType('operational')} className={`border rounded px-3 py-2 text-left text-[12px] ${bkType === 'operational' ? 'border-primary bg-primary/5' : 'border-input'}`}>
                  <div className="font-semibold">Operational</div>
                  <div className="text-muted-foreground text-[11px]">Master, resep, transaksi, stok, HPP, batch. Tanpa user/auth. (Direkomendasikan)</div>
                </button>
                <button type="button" onClick={() => setBkType('full')} className={`border rounded px-3 py-2 text-left text-[12px] ${bkType === 'full' ? 'border-primary bg-primary/5' : 'border-input'}`}>
                  <div className="font-semibold">Full</div>
                  <div className="text-muted-foreground text-[11px]">Operational + data User (export-only, tidak di-restore).</div>
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between rounded border px-3 py-2">
              <div><div className="text-[13px] font-medium flex items-center gap-1"><Lock className="w-3.5 h-3.5" /> Encrypt Backup File</div><div className="text-[11px] text-muted-foreground">Enkripsi AES-256. Password tidak disimpan.</div></div>
              <Switch checked={bkEncrypt} onCheckedChange={setBkEncrypt} />
            </div>
            {bkEncrypt && (
              <div><Label>Password Enkripsi</Label><Input type="password" value={bkPassword} onChange={(e) => setBkPassword(e.target.value)} placeholder="Password untuk membuka file backup" /></div>
            )}
            <p className="text-[11px] text-muted-foreground">Backup disimpan di private storage + langsung diunduh ke perangkat Anda. Checksum SHA-256 menjamin integritas.</p>
          </div>
        )}
      </FormModal>

      {/* RESET MODAL */}
      <FormModal open={resetOpen} onClose={() => setResetOpen(false)} title="Reset Development Data" submitLabel="Jalankan Reset" submitting={busy} onSubmit={doReset} size="md">
        <div className="space-y-3">
          <div className="bg-red-50 border border-red-300 rounded px-3 py-2 text-[12px] text-red-700">
            ⚠ Proses ini menghapus data operasional dan transaksi secara permanen. Data pengguna, role, dan hak akses tetap dipertahankan.
          </div>
          <div>
            <Label>Mode Reset</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button type="button" onClick={() => setResetMode('transaction')} className={`border rounded px-3 py-2 text-left text-[12px] ${resetMode === 'transaction' ? 'border-primary bg-primary/5' : 'border-input'}`}>
                <div className="font-semibold">Transaksi Saja</div>
                <div className="text-muted-foreground text-[11px]">Hapus transaksi + stok. Master & resep tetap.</div>
              </button>
              <button type="button" onClick={() => setResetMode('full')} className={`border rounded px-3 py-2 text-left text-[12px] ${resetMode === 'full' ? 'border-primary bg-primary/5' : 'border-input'}`}>
                <div className="font-semibold">Penuh Operasional</div>
                <div className="text-muted-foreground text-[11px]">Hapus transaksi + master + resep + stok.</div>
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between"><Label>Reset nomor dokumen operasional</Label><Switch checked={resetSequences} onCheckedChange={setResetSequences} /></div>
          <div className="flex items-center justify-between"><Label>Lanjut tanpa backup</Label><Switch checked={skipBackup} onCheckedChange={setSkipBackup} /></div>
          {!skipBackup && <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">Disarankan buat backup terlebih dahulu (Save Database) sebelum reset.</p>}
          <div><Label>Password (re-authentication)</Label><Input type="password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} placeholder="Masukkan password Anda" /></div>
          <div><Label>Ketik kalimat konfirmasi</Label><Input value={resetPhrase} onChange={(e) => setResetPhrase(e.target.value)} placeholder={RESET_CONFIRM_PHRASE} className="font-mono text-[12px]" /></div>
          <label className="flex items-start gap-2 text-[12px]"><input type="checkbox" checked={resetAck} onChange={(e) => setResetAck(e.target.checked)} className="mt-0.5" /> Saya memahami bahwa data yang dihapus tidak dapat dipulihkan kecuali tersedia backup.</label>
        </div>
      </FormModal>

      {/* STORED-RESTORE MODAL */}
      <FormModal open={restoreOpen} onClose={() => setRestoreOpen(false)} title="Restore dari Backup Tersimpan" submitLabel="Jalankan Restore" submitting={busy} onSubmit={doRestore} size="md">
        <div className="space-y-3">
          <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-[12px] text-amber-700">
            Restore akan mengganti data operasional saat ini dengan data dari backup. User & hak akses tetap dipertahankan. Sistem membuat auto-backup otomatis sebelum restore.
          </div>
          <div>
            <Label>Pilih Backup</Label>
            <select value={restoreId} onChange={(e) => setRestoreId(e.target.value)} className="w-full h-9 border rounded px-2 text-[13px] bg-transparent">
              <option value="">— Pilih —</option>
              {completedBackups.map((b) => (<option key={b.id} value={b.id}>{b.backup_code} — {fmtDate(b.created_at)}</option>))}
            </select>
          </div>
          <div><Label>Mode Restore</Label><div className="text-[12px] text-muted-foreground mt-1">Operational — Master+resep+transaksi+stok. User tetap (platform-managed).</div></div>
          <div><Label>Ketik kalimat konfirmasi</Label><Input value={restorePhrase} onChange={(e) => setRestorePhrase(e.target.value)} placeholder={RESTORE_CONFIRM_PHRASE} className="font-mono text-[12px]" /></div>
          <label className="flex items-start gap-2 text-[12px]"><input type="checkbox" checked={restoreAck} onChange={(e) => setRestoreAck(e.target.checked)} className="mt-0.5" /> Saya memahami data saat ini akan ditimpa oleh backup.</label>
        </div>
      </FormModal>

      {/* FILE-RESTORE MODAL */}
      <FormModal open={fileOpen} onClose={() => { setFileOpen(false); resetFileState(); }} title="Restore from Backup File" submitLabel="Jalankan Restore" submitting={busy} onSubmit={doFileRestore} size="md">
        <div className="space-y-3">
          <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-[12px] text-amber-700">
            Pilih file backup (.json) dari local drive. File divalidasi (manifest, checksum, schema) sebelum restore dijalankan.
          </div>

          <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={onPickFile} />
          <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={() => fileInputRef.current?.click()}>
            <FileUp className="w-4 h-4" /> {uploadedFile ? uploadedFile.file_name : 'Pilih File Backup (.json)'}
          </Button>
          {uploadedFile && <div className="text-[11px] text-muted-foreground">Ukuran: {fmtSize(uploadedFile.file_size)}</div>}

          {needsPassword && (
            <div className="space-y-1">
              <Label>Password File (terenkripsi)</Label>
              <div className="flex gap-2">
                <Input type="password" value={filePassword} onChange={(e) => setFilePassword(e.target.value)} placeholder="Password backup" />
                <Button type="button" variant="secondary" onClick={revalidateWithPassword} disabled={busy}>Validasi</Button>
              </div>
            </div>
          )}

          {validateError && (
            <div className="bg-red-50 border border-red-300 rounded px-3 py-2 text-[12px] text-red-700 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{validateError}</span>
            </div>
          )}

          {preview && (
            <div className="bg-emerald-50 border border-emerald-200 rounded p-3 space-y-1.5 text-[12px]">
              <div className="flex items-center gap-1.5 text-emerald-700 font-semibold"><CheckCircle2 className="w-4 h-4" /> File tervalidasi</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                <div><span className="text-muted-foreground">Aplikasi:</span> {preview.application}</div>
                <div><span className="text-muted-foreground">Backup ID:</span> <span className="font-mono">{preview.backupId}</span></div>
                <div><span className="text-muted-foreground">Tanggal:</span> {fmtDate(preview.createdAt)}</div>
                <div><span className="text-muted-foreground">Dibuat oleh:</span> {preview.createdBy}</div>
                <div><span className="text-muted-foreground">Versi App:</span> {preview.appVersion}</div>
                <div><span className="text-muted-foreground">Schema:</span> {preview.schemaVersion} {preview.schemaOk ? '(kompatibel)' : <span className="text-red-600">(tidak kompatibel)</span>}</div>
                <div><span className="text-muted-foreground">Jenis:</span> {preview.backupType === 'full' ? 'Full' : 'Operational'}</div>
                <div><span className="text-muted-foreground">Terenkripsi:</span> {preview.encrypted ? 'Ya' : 'Tidak'}</div>
                <div><span className="text-muted-foreground">Record:</span> {preview.recordCount}</div>
                <div><span className="text-muted-foreground">Checksum:</span> <span className="text-emerald-700">{preview.checksumStatus}</span></div>
                <div><span className="text-muted-foreground">Ukuran:</span> {fmtSize(preview.fileSize)}</div>
                <div><span className="text-muted-foreground">Environment asal:</span> {preview.environment}</div>
              </div>
            </div>
          )}

          {preview && (
            <>
              <div><Label>Mode Restore</Label><div className="text-[12px] text-muted-foreground mt-1">Operational — Master+resep+transaksi+stok. User tetap (platform-managed).</div></div>
              <div><Label>Ketik kalimat konfirmasi</Label><Input value={filePhrase} onChange={(e) => setFilePhrase(e.target.value)} placeholder={RESTORE_CONFIRM_PHRASE} className="font-mono text-[12px]" /></div>
              <label className="flex items-start gap-2 text-[12px]"><input type="checkbox" checked={fileAck} onChange={(e) => setFileAck(e.target.checked)} className="mt-0.5" /> Saya memahami data saat ini akan ditimpa oleh backup ini.</label>
            </>
          )}
        </div>
      </FormModal>
    </div>
  );
}