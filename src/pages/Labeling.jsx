import React from 'react';
import PageHeader from '@/components/PageHeader';
import { AlertTriangle } from 'lucide-react';

export default function Labeling() {
  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader title="Labeling" description="Labeling barang siap labeling — konsumsi label dari stok" />
      <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed rounded-lg bg-muted/20">
        <AlertTriangle className="w-10 h-10 text-amber-500 mb-3" />
        <h2 className="text-base font-semibold mb-1">Modul Labeling sedang diperbarui</h2>
        <p className="text-[13px] text-muted-foreground max-w-md">
          Master Barang sedang disederhanakan. Kompatibilitas label akan dikelola melalui Mapping Produk↔Label pada fase berikutnya.
        </p>
      </div>
    </div>
  );
}