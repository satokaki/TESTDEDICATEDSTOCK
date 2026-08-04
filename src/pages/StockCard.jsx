import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Search } from 'lucide-react';

const transactionTypeLabels = {
  opening_balance: 'Opening Balance',
  purchase_receipt: 'Purchase Receipt',
  production_consumption: 'Production Consumption',
  production_output: 'Production Output',
  bottling_consumption: 'Bottling Consumption',
  bottling_output: 'Bottling Output',
  labeling_consumption: 'Labeling Consumption',
  labeling_output: 'Labeling Output',
  excise_consumption: 'Excise Consumption',
  excise_output: 'Excise Output',
  sales: 'Sales',
  sales_return: 'Sales Return',
  production_reversal: 'Production Reversal',
  sales_reversal: 'Sales Reversal',
  stock_adjustment: 'Stock Adjustment',
  transfer_gudang: 'Transfer Gudang',
};

export default function StockCard() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ item_type: '', transaction_type: '', item_name: '', date_from: '', date_to: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const items = await base44.entities.StockLedger.list('-created_date', 500);
      setData(items);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat data' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = data.filter(item => {
    if (filters.item_type && item.item_type !== filters.item_type) return false;
    if (filters.transaction_type && item.transaction_type !== filters.transaction_type) return false;
    if (filters.item_name && !item.item_name?.toLowerCase().includes(filters.item_name.toLowerCase())) return false;
    if (filters.date_from && item.transaction_date?.slice(0, 10) < filters.date_from) return false;
    if (filters.date_to && item.transaction_date?.slice(0, 10) > filters.date_to) return false;
    return true;
  });

  const exportCSV = () => {
    const headers = ['Tanggal', 'No. Transaksi', 'Tipe', 'Item', 'Batch', 'Masuk', 'Keluar', 'Satuan', 'Referensi'];
    const rows = filtered.map(r => [
      r.transaction_date?.slice(0, 19).replace('T', ' '),
      r.transaction_number || '', transactionTypeLabels[r.transaction_type] || r.transaction_type,
      r.item_name || '', r.batch_number || '',
      r.quantity_in || 0, r.quantity_out || 0, r.unit || '', r.reference_number || '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `kartu-stok-${Date.now()}.csv`; a.click();
    toast({ title: 'Kartu stok diexport' });
  };

  const columns = [
    { key: 'transaction_date', header: 'Tanggal', sortable: true, render: (row) => row.transaction_date?.slice(0, 19).replace('T', ' ') },
    { key: 'transaction_number', header: 'No. Transaksi', className: 'font-mono' },
    { key: 'transaction_type', header: 'Tipe', render: (row) => <span className="text-[10.5px] px-1.5 py-0.5 bg-muted rounded">{transactionTypeLabels[row.transaction_type] || row.transaction_type}</span> },
    { key: 'item_name', header: 'Item', className: 'font-medium' },
    { key: 'batch_number', header: 'Batch', className: 'font-mono', render: (row) => row.batch_number || '—' },
    { key: 'quantity_in', header: 'Masuk', render: (row) => row.quantity_in > 0 ? <span className="text-emerald-600 tabular-nums">+{row.quantity_in}</span> : '' },
    { key: 'quantity_out', header: 'Keluar', render: (row) => row.quantity_out > 0 ? <span className="text-red-600 tabular-nums">-{row.quantity_out}</span> : '' },
    { key: 'unit', header: 'Satuan' },
    { key: 'reference_number', header: 'Referensi', className: 'font-mono', render: (row) => row.reference_number || '—' },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader title="Kartu Stok" description="Mutasi persediaan berdasarkan stock ledger"
        actions={<Button onClick={exportCSV} size="sm" variant="outline" className="gap-1.5"><Download className="w-4 h-4" /> Export CSV</Button>} />

      {/* Filters */}
      <div className="bg-white border border-border rounded-lg p-3 mb-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
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