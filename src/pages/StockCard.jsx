import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download } from 'lucide-react';
import PdfButton from '@/components/PdfButton';
import { exportReportToPDF } from '@/lib/pdfExport';
import { useAuth } from '@/lib/AuthContext';
import { STAGE_LABEL } from '@/lib/inventoryDisplay';

const transactionTypeLabels = {
  opening_balance: 'Opening Balance',
  purchase_receipt: 'Purchase Receipt',
  production_consumption: 'Production Consumption',
  production_output: 'Production Output',
  production_waste: 'Production Waste',
  bottling_consumption: 'Bottling Consumption',
  bottling_bottle_consumption: 'Bottle Consumption',
  bottling_output: 'Bottling Output',
  bottling_waste: 'Bottling Waste',
  labeling_consumption: 'Labeling Consumption',
  label_consumption: 'Label Consumption',
  labeling_output: 'Labeling Output',
  labeling_waste: 'Labeling Waste',
  excise_consumption: 'Excise Consumption',
  excise_output: 'Excise Output',
  sales: 'Sales',
  sales_return: 'Sales Return',
  production_reversal: 'Production Reversal',
  bottling_reversal: 'Bottling Reversal',
  labeling_reversal: 'Labeling Reversal',
  excise_reversal: 'Excise Reversal',
  sales_reversal: 'Sales Reversal',
  stock_adjustment: 'Stock Adjustment',
  transfer_gudang: 'Transfer Gudang',
  premix_consumption: 'Premix Consumption',
  premix_output: 'Premix Output',
  premix_waste: 'Premix Waste',
  premix_reversal: 'Premix Reversal',
};

export default function StockCard() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [data, setData] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ item_type: '', transaction_type: '', inventory_status: '', warehouse_id: '', item_name: '', date_from: '', date_to: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [items, whs] = await Promise.all([
        base44.entities.StockLedger.list('-created_date', 500),
        base44.entities.Warehouse.filter({ is_active: true }).catch(() => []),
      ]);
      setData(items);
      setWarehouses(whs);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat data' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = useMemo(() => {
    const rows = data.filter(item => {
      if (filters.item_type && item.item_type !== filters.item_type) return false;
      if (filters.transaction_type && item.transaction_type !== filters.transaction_type) return false;
      if (filters.inventory_status && item.inventory_status !== filters.inventory_status) return false;
      if (filters.warehouse_id && item.warehouse_id !== filters.warehouse_id) return false;
      if (filters.item_name && !item.item_name?.toLowerCase().includes(filters.item_name.toLowerCase())) return false;
      if (filters.date_from && item.transaction_date?.slice(0, 10) < filters.date_from) return false;
      if (filters.date_to && item.transaction_date?.slice(0, 10) > filters.date_to) return false;
      return true;
    });

    // Hitung saldo berjalan (Sisa) per item+stage, urut kronologis ascending.
    const sorted = [...rows].sort((a, b) => {
      const da = a.transaction_date || a.created_date || '';
      const db = b.transaction_date || b.created_date || '';
      return da.localeCompare(db);
    });
    const running = {};
    const result = sorted.map(r => {
      const key = `${r.item_id}|${r.inventory_status || ''}`;
      const delta = (Number(r.quantity_in) || 0) - (Number(r.quantity_out) || 0);
      running[key] = (running[key] || 0) + delta;
      return { ...r, running_balance: running[key] };
    });

    // Kembalikan ke urutan created_date descending agar konsisten dengan DataTable.
    return result.sort((a, b) => (b.created_date || '').localeCompare(a.created_date || ''));
  }, [data, filters]);

  const exportCSV = () => {
    const headers = ['Tanggal', 'No. Transaksi', 'Tipe', 'Item', 'Batch', 'Gudang', 'Masuk', 'Keluar', 'Sisa', 'Satuan', 'Referensi'];
    const rows = filtered.map(r => [
      r.transaction_date?.slice(0, 19).replace('T', ' '),
      r.transaction_number || '', transactionTypeLabels[r.transaction_type] || r.transaction_type,
      r.item_name || '', r.batch_number || '', r.warehouse_name || '',
      r.quantity_in || 0, r.quantity_out || 0, r.running_balance ?? 0, r.unit || '', r.reference_number || '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `kartu-stok-${Date.now()}.csv`; a.click();
    toast({ title: 'Kartu stok diexport' });
  };

  const exportPDF = () => exportReportToPDF({
    title: 'Kartu Stok',
    subtitle: `${filtered.length} mutasi`,
    meta: { company: 'LAB PRO', printedBy: user?.full_name },
    columns: [
      { key: 'transaction_date', header: 'Tanggal' },
      { key: 'transaction_number', header: 'No. Transaksi' },
      { key: 'transaction_type', header: 'Tipe' },
      { key: 'item_name', header: 'Item' },
      { key: 'batch_number', header: 'Batch' },
      { key: 'warehouse_name', header: 'Gudang' },
      { key: 'quantity_in', header: 'Masuk', align: 'right' },
      { key: 'quantity_out', header: 'Keluar', align: 'right' },
      { key: 'running_balance', header: 'Sisa', align: 'right' },
      { key: 'unit', header: 'Satuan' },
      { key: 'reference_number', header: 'Referensi' },
    ],
    rows: filtered.map(r => ({
      transaction_date: r.transaction_date?.slice(0, 19).replace('T', ' '),
      transaction_number: r.transaction_number || '',
      transaction_type: transactionTypeLabels[r.transaction_type] || r.transaction_type,
      item_name: r.item_name || '', batch_number: r.batch_number || '',
      warehouse_name: r.warehouse_name || '',
      quantity_in: r.quantity_in || '', quantity_out: r.quantity_out || '',
      running_balance: r.running_balance ?? 0,
      unit: r.unit || '', reference_number: r.reference_number || '',
    })),
    fileName: `kartu-stok-${Date.now()}.pdf`,
  });

  const columns = [
    { key: 'transaction_date', header: 'Tanggal', sortable: true, render: (row) => row.transaction_date?.slice(0, 19).replace('T', ' ') },
    { key: 'transaction_number', header: 'No. Transaksi', className: 'font-mono' },
    { key: 'transaction_type', header: 'Tipe', render: (row) => <span className="text-[10.5px] px-1.5 py-0.5 bg-muted rounded">{transactionTypeLabels[row.transaction_type] || row.transaction_type}</span> },
    { key: 'item_name', header: 'Item', className: 'font-medium' },
    { key: 'inventory_status', header: 'Stage', render: (row) => row.inventory_status ? <span className="text-[10.5px] px-1.5 py-0.5 bg-muted rounded">{STAGE_LABEL[row.inventory_status] || row.inventory_status}</span> : '—' },
    { key: 'batch_number', header: 'Batch', className: 'font-mono', render: (row) => row.batch_number || '—' },
    { key: 'warehouse_name', header: 'Gudang', render: (row) => row.warehouse_name || '—' },
    { key: 'quantity_in', header: 'Masuk', render: (row) => row.quantity_in > 0 ? <span className="text-emerald-600 tabular-nums">+{row.quantity_in}</span> : '' },
    { key: 'quantity_out', header: 'Keluar', render: (row) => row.quantity_out > 0 ? <span className="text-red-600 tabular-nums">-{row.quantity_out}</span> : '' },
    { key: 'running_balance', header: 'Sisa', render: (row) => <span className="tabular-nums font-semibold text-foreground">{row.running_balance ?? 0}</span> },
    { key: 'unit', header: 'Satuan' },
    { key: 'reference_number', header: 'Referensi', className: 'font-mono', render: (row) => row.reference_number || '—' },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader title="Kartu Stok" description="Mutasi persediaan berdasarkan stock ledger"
        actions={<div className="flex items-center gap-2"><Button onClick={exportCSV} size="sm" variant="outline" className="gap-1.5"><Download className="w-4 h-4" /> Export CSV</Button><PdfButton onExport={exportPDF} /></div>} />

      {/* Filters */}
      <div className="bg-white border border-border rounded-lg p-3 mb-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <div>
          <Label className="text-[11px] mb-1">Jenis Item</Label>
          <Select value={filters.item_type} onValueChange={v => setFilters({ ...filters, item_type: v })}>
            <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Semua" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="material">Bahan</SelectItem>
              <SelectItem value="product">Barang</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[11px] mb-1">Tipe Transaksi</Label>
          <Select value={filters.transaction_type} onValueChange={v => setFilters({ ...filters, transaction_type: v })}>
            <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Semua" /></SelectTrigger>
            <SelectContent>
              {Object.entries(transactionTypeLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[11px] mb-1">Stage</Label>
          <Select value={filters.inventory_status} onValueChange={v => setFilters({ ...filters, inventory_status: v })}>
            <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Semua" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="BULK">Bulk (Produksi)</SelectItem>
              <SelectItem value="READY_FOR_LABELING">Siap Labeling</SelectItem>
              <SelectItem value="UNEXCISED">Belum Cukai</SelectItem>
              <SelectItem value="READY_FOR_SALE">Siap Jual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[11px] mb-1">Gudang</Label>
          <Select value={filters.warehouse_id} onValueChange={v => setFilters({ ...filters, warehouse_id: v })}>
            <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Semua" /></SelectTrigger>
            <SelectContent>
              {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[11px] mb-1">Nama Item</Label>
          <Input value={filters.item_name} onChange={e => setFilters({ ...filters, item_name: e.target.value })} className="h-8 text-[12px]" placeholder="Cari item..." />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <div><Label className="text-[11px] mb-1">Dari</Label><Input type="date" value={filters.date_from} onChange={e => setFilters({ ...filters, date_from: e.target.value })} className="h-8 text-[12px]" /></div>
          <div><Label className="text-[11px] mb-1">Sampai</Label><Input type="date" value={filters.date_to} onChange={e => setFilters({ ...filters, date_to: e.target.value })} className="h-8 text-[12px]" /></div>
        </div>
      </div>

      <DataTable columns={columns} data={filtered} loading={loading} emptyMessage="Belum ada mutasi stok" searchKeys={['transaction_number', 'item_name', 'batch_number']} searchPlaceholder="Cari transaksi..." />
    </div>
  );
}