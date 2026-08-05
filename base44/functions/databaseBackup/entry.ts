import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { createBackup, APP_ENVIRONMENT } from '../../shared/dbManagement.js';

export default async function (req) {
  let base44;
  let user;
  try {
    base44 = createClientFromRequest(req);
    user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const { name, notes } = body;

    const result = await createBackup(base44, {
      name,
      notes,
      createdBy: user.email || user.id,
      environment: APP_ENVIRONMENT,
    });

    await base44.asServiceRole.entities.AuditLog.create({
      action_time: new Date().toISOString(),
      user_name: user.email || user.full_name || 'admin',
      module: 'database',
      action: 'DATABASE_BACKUP_CREATED',
      entity_type: 'DatabaseBackup',
      entity_id: result.record.id,
      reference_number: result.record.backup_code,
      reason: notes || 'Backup created',
      data_after: JSON.stringify({ recordCount: result.recordCount, checksum: result.checksum, fileSize: result.fileSize, environment: APP_ENVIRONMENT }),
    });

    return Response.json({ ok: true, backup: result.record });
  } catch (error) {
    try {
      if (base44 && user) {
        await base44.asServiceRole.entities.AuditLog.create({
          action_time: new Date().toISOString(),
          user_name: user.email || '',
          module: 'database',
          action: 'DATABASE_BACKUP_FAILED',
          reason: error.message,
        });
      }
    } catch {}
    return Response.json({ error: error.message }, { status: 500 });
  }
}