import React from 'react';
import { Button } from '@/components/ui/button';
import { FileDown } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/permissions';

/**
 * Reusable "Export PDF" button gated by a permission key.
 * Renders nothing when the current user lacks the permission, so PDF export
 * stays disabled for roles without it (e.g. Brewer).
 */
export default function PdfButton({ onExport, perm = 'report_pdf', label = 'Export PDF', size = 'sm', className = '' }) {
  const { user } = useAuth();
  if (!hasPermission(user, perm, 'view')) return null;
  return (
    <Button onClick={onExport} size={size} variant="outline" className={`gap-1.5 ${className}`}>
      <FileDown className="w-4 h-4" /> {label}
    </Button>
  );
}