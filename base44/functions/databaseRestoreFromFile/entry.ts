import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { APP_ENVIRONMENT, MAX_RESTORE_FILE_SIZE, SCHEMA_VERSION, parseAndValidateBackup, performRestore } from '../../shared/dbManagement.js';

// Restores the database from an uploaded backup file (already in private storage).
// Re-validates (checksum + manifest) before deleting + recreating. Production-guarded.
export default async function (req) {
  let base44;
  let user;
  try {
    base44 = createClientFromRequest(req);
    user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    if (APP_ENVIRONMENT === 'production') {
      return Response.json({ error: 'Restore tidak tersedia pada environment Production.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { file_uri, file_name, mode = 'operational', confirm, autoBackup = true, password } = body;
    if (!file_uri) return Response.json({ error: 'file_uri wajib' }, { status: 400 });
    if (confirm !== 'RESTORE DATABASE LAB PRO') {
      return Response.json({ error: 'Kalimat konfirmasi tidak sesuai.' }, { status: 400 });
    }

    const signed = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri, expires_in: 120 });
    const resp = await fetch(signed.signed_url);
    if (!resp.ok) return Response.json({ error: 'Gagal mengambil file backup' }, { status: 500 });
    const text = await resp.text();
    if (new Blob([text]).size > MAX_RESTORE_FILE_SIZE) {
      return Response.json({ error: `Ukuran file melebihi batas (${MAX_RESTORE_FILE_SIZE / 1048576} MB).` }, { status: 400 });
    }

    const v = await parseAndValidateBackup(text, { password });
    if (!v.ok) {
      await base44.asServiceRole.entities.AuditLog.create({
        action_time: new Date().toISOString(),
        user_name: user.email || '',
        module: 'database',
        action: 'DATABASE_RESTORE_FROM_LOCAL_FAILED',
        reference_number: file_name || '',
        reason: v.error,
      });
      return Response.json({ error: v.error }, { status: 400 });
    }
    if (!v.schemaOk) {
      await base44.asServiceRole.entities.AuditLog.create({
        action_time: new Date().toISOString(),
        user_name: user.email || '',
        module: 'database',
        action: 'DATABASE_RESTORE_FROM_LOCAL_FAILED',
        reference_number: file_name || '',
        reason: `Schema version tidak kompatibel (file: ${v.metadata.schemaVersion}, aplikasi: ${SCHEMA_VERSION})`,
      });
      return Response.json({ error: `Schema version tidak kompatibel (file: ${v.metadata.schemaVersion}, aplikasi saat ini: ${SCHEMA_VERSION}). Restore ditolak.` }, { status: 400 });
    }

    const result = await performRestore(base44, v.tables, { mode, autoBackup, createdBy: user.email || user.id });

    await base44.asServiceRole.entities.AuditLog.create({
      action_time: new Date().toISOString(),
      user_name: user.email || user.full_name || 'admin',
      module: 'database',
      action: 'DATABASE_RESTORE_FROM_LOCAL_COMPLETED',
      reference_number: v.metadata.backupId,
      reason: `mode=${mode}; autoBackup=${result.autoBackupCode || 'none'}; source=${file_name || 'upload'}; environment=${APP_ENVIRONMENT}`,
      data_after: JSON.stringify(result.restored),
    });

    return Response.json({
      ok: true,
      mode,
      backup_code: v.metadata.backupId,
      autoBackup: result.autoBackupCode,
      restored: result.restored,
    });
  } catch (error) {
    try {
      if (base44 && user) {
        await base44.asServiceRole.entities.AuditLog.create({
          action_time: new Date().toISOString(),
          user_name: user.email || '',
          module: 'database',
          action: 'DATABASE_RESTORE_FROM_LOCAL_FAILED',
          reason: error.message,
        });
      }
    } catch {}
    return Response.json({ error: error.message }, { status: 500 });
  }
}