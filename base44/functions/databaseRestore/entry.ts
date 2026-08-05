import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  APP_ENVIRONMENT,
  RESTORE_ORDER,
  RESTORE_REFS,
  TRANSACTION_ENTITIES,
  FULL_ONLY_ENTITIES,
  createBackup,
  sha256hex,
  stripBuiltins,
  remapRecord,
  isReferencedByOthers,
} from '../../shared/dbManagement.js';

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
    const { backup_id, mode = 'operational', confirm, autoBackup = true } = body;
    if (!backup_id) return Response.json({ error: 'backup_id wajib' }, { status: 400 });
    if (confirm !== 'RESTORE DATABASE LAB PRO') {
      return Response.json({ error: 'Kalimat konfirmasi tidak sesuai.' }, { status: 400 });
    }

    const backup = await base44.asServiceRole.entities.DatabaseBackup.get(backup_id).catch(() => null);
    if (!backup) return Response.json({ error: 'Backup tidak ditemukan' }, { status: 404 });
    if (backup.status !== 'COMPLETED') return Response.json({ error: 'Backup belum selesai atau gagal' }, { status: 400 });

    // Verify checksum
    const signed = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: backup.storage_path, expires_in: 120 });
    const resp = await fetch(signed.signed_url);
    if (!resp.ok) return Response.json({ error: 'Gagal mengambil file backup' }, { status: 500 });
    const text = await resp.text();
    const checksum = await sha256hex(text);
    if (checksum !== backup.checksum) {
      await base44.asServiceRole.entities.AuditLog.create({
        action_time: new Date().toISOString(),
        user_name: user.email || '',
        module: 'database',
        action: 'DATABASE_RESTORE_FAILED',
        reference_number: backup.backup_code,
        reason: 'Checksum mismatch',
      });
      return Response.json({ error: 'Checksum backup tidak valid. Restore dibatalkan.' }, { status: 400 });
    }
    const snapshot = JSON.parse(text);
    const tables = snapshot.tables || {};

    // Auto-backup current state before restore
    let autoBackupCode = null;
    if (autoBackup) {
      try {
        const ab = await createBackup(base44, {
          name: `Auto-backup sebelum restore ${backup.backup_code}`,
          notes: 'Auto backup sebelum restore',
          createdBy: user.email || user.id,
          environment: APP_ENVIRONMENT,
        });
        autoBackupCode = ab.record.backup_code;
      } catch {}
    }

    // Delete current operational data (full operational reset)
    const entities = [...TRANSACTION_ENTITIES, ...FULL_ONLY_ENTITIES];
    for (const name of entities) {
      try { await base44.asServiceRole.entities[name].deleteMany({}); } catch {}
    }

    // Restore in order with ID remap
    const idMaps = {};
    const restored = {};
    for (const name of RESTORE_ORDER) {
      idMaps[name] = idMaps[name] || {};
      const rows = tables[name] || [];
      if (rows.length === 0) { restored[name] = 0; continue; }
      let count = 0;
      if (isReferencedByOthers(name)) {
        for (const row of rows) {
          const cleaned = stripBuiltins(row);
          const remapped = remapRecord(name, cleaned, idMaps);
          try {
            const created = await base44.asServiceRole.entities[name].create(remapped);
            if (created && created.id && row.id) idMaps[name][row.id] = created.id;
            count++;
          } catch {}
        }
      } else {
        const payload = rows.map((r) => remapRecord(name, stripBuiltins(r), idMaps));
        try {
          await base44.asServiceRole.entities[name].bulkCreate(payload);
          count = payload.length;
        } catch {
          for (const p of payload) {
            try { await base44.asServiceRole.entities[name].create(p); count++; } catch {}
          }
        }
      }
      restored[name] = count;
    }

    await base44.asServiceRole.entities.AuditLog.create({
      action_time: new Date().toISOString(),
      user_name: user.email || user.full_name || 'admin',
      module: 'database',
      action: 'DATABASE_RESTORE_COMPLETED',
      reference_number: backup.backup_code,
      reason: `mode=${mode}; autoBackup=${autoBackupCode || 'none'}; environment=${APP_ENVIRONMENT}`,
      data_after: JSON.stringify(restored),
    });

    return Response.json({ ok: true, mode, backup_code: backup.backup_code, autoBackup: autoBackupCode, restored });
  } catch (error) {
    try {
      if (base44 && user) {
        await base44.asServiceRole.entities.AuditLog.create({
          action_time: new Date().toISOString(),
          user_name: user.email || '',
          module: 'database',
          action: 'DATABASE_RESTORE_FAILED',
          reason: error.message,
        });
      }
    } catch {}
    return Response.json({ error: error.message }, { status: 500 });
  }
}