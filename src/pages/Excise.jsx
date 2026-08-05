import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import FormModal from '@/components/FormModal';
import StatusBadge from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import NumberInput from '@/components/NumberInput';
import PdfButton from '@/components/PdfButton';
import { exportDocumentToPDF } from '@/lib/pdfExport';
import { Plus } from 'lucide-react';
import { generateOrderNumber } from '@/lib/sequence';
import { recordStockMovement, getAllStockBalances, createAuditLog } from '@/lib/stockUtils';
import { getInventoryDisplayName } from '@/lib/inventoryDisplay';

export default function Excise() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [belumCukaiStock, setBelumCukaiStock] = useState([]);
  const [products, setProducts] = useState([]);
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ product_id: '', stock_id: '', brand_id: '', bottle_size: '', quantity: '', excise_label_type: '', document_number: '', excise_reference_number: '', excise_date: new Date().toISOString().slice(0, 10), operator: '', notes: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [items, balances, prods, brs] = await Promise.all([
        base44.entities.ExciseOrder.list('-created_date', 100),
        getAllStockBalances('product'),
        base44.entities.Product.filter({ is_active: true }),
        base44.entities.Brand.filter({ is_active: true }),
      ]);
      setData(items);
      // belum_cukai stock = stock balances that have belum_cukai products
      setBelumCukaiStock(balances.filter(b => b.inventory_status === 'UNEXCISED' && b.quantity > 0));
      setProducts(prods);
      setBrands(brs);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat data' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const openAdd = () => {
    setForm({ product_id: '', stock_id: '', brand_id: '', bottle_size: '', quantity: '', excise_label_type: '', document_number: '', excise_reference_number: '', excise_date: new Date().toISOString().slice(0, 10), operator: '', notes: '' });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.product_id || !form.quantity || !form.operator) { toast({ variant: 'destructive', title: 'Produk, jumlah, dan operator wajib diisi' }); return; }
    const stockItem = belumCukaiStock.find(s => s.id === form.stock_id);
    if (stockItem && Number(form.quantity) > stockItem.available_quantity) {
      toast({ variant: 'destructive', title: 'Jumlah melebihi stok belum cukai', description: `Tersedia: ${stockItem.available_quantity}` });
      return;
    }
    setSubmitting(true);
    try {
      const product = products.find(p => p.id === form.product_id);
      const brand = brands.find(b => b.id === form.brand_id);
      const excNumber = await generateOrderNumber('EXC', 'ExciseOrder');
      const excise = await base44.entities.ExciseOrder.create({
        excise_number: excNumber,
        brand_id: form.brand_id, brand_name: brand?.name || '',
        product_id: form.product_id, product_name: product?.name || '',
        batch_number: stockItem?.batch_number || '',
        bottle_size: Number(form.bottle_size), quantity: Number(form.quantity),
        excise_label_type: form.excise_label_type, document_number: form.document_number,
        excise_reference_number: form.excise_reference_number,
        excise_date: form.excise_date, operator: form.operator,
        status: 'siap_jual', notes: form.notes,
      });
      // Reduce belum_cukai stock
      await recordStockMovement({
        item_type: 'product', item_id: form.product_id, item_name: product?.name || '', item_code: product?.code || '',
        batch_id: stockItem?.batch_id || '', batch_number: stockItem?.batch_number || '',
        inventory_status: 'UNEXCISED',
        quantity_out: Number(form.quantity), unit: 'unit',
        transaction_type: 'excise_consumption', transaction_number: excNumber,
        reference_type: 'excise', reference_id: excise.id,
        notes: `Proses cukai ${excNumber}`,
      });
      // Add siap_jual stock
      await recordStockMovement({
        item_type: 'product', item_id: form.product_id, item_name: product?.name || '', item_code: product?.code || '',
        batch_id: stockItem?.batch_id || '', batch_number: stockItem?.batch_number || '',
        inventory_status: 'READY_FOR_SALE',
        quantity_in: Number(form.quantity), unit: 'unit',
        transaction_type: 'excise_output', transaction_number: excNumber,
        reference_type: 'excise', reference_id: excise.id,
        notes: `Barang siap jual`,
      });
      await createAuditLog({ module: 'Cukai', action: 'Selesai', entity_type: 'ExciseOrder', entity_id: excise.id, reference_number: excNumber });
      toast({ title: 'Proses cukai selesai', description: excNumber });
      setModalOpen(false); loadData();
    } catch (e) { toast({ variant: 'destructive', title: 'Gagal menyimpan', description: e.message }); }
    finally { setSubmitting(false); }
  };

  const exportExcisePDF = async (row) => {
    try {
      exportDocumentToPDF({
        title: 'Dokumen Proses Cukai',
        docNumber: row.excise_number, docDate: row.excise_date,
        partyLabel: 'Produk', party: { name: row.product_name },
        infoLines: [
          { label: 'Merk', value: row.brand_name || '-' },
          { label: 'No. Batch', value: row.batch_number || '-' },
          { label: 'Ukuran', value: row.bottle_size ? `${row.bottle_size} ml` : '-' },
          { label: 'Jenis Pita Cukai', value: row.excise_label_type || '-' },
          { label: 'No. Dokumen', value: row.document_number || '-' },
          { label: 'Ref. Cukai', value: row.excise_reference_number || '-' },
          { label: 'Jumlah', value: row.quantity },
          { label: 'Operator', value: row.operator || '-' },
          { label: 'Status', value: row.status },
        ],
        itemColumns: [{ key: 'desc', header: 'Keterangan' }],
        itemRows: [{ desc: `Proses cukai ${row.quantity} unit ${row.product_name} (batch ${row.batch_number || '-'}) — ref ${row.excise_reference_number || '-'}` }],
        totals: [{ label: 'Jumlah Unit', value: row.quantity, bold: true }],
        notes: row.notes,
        signatures: [{ label: 'Operator,', name: row.operator || '' }],
        fileName: `cukai-${row.excise_number}.pdf`,
      });
    } catch { toast({ variant: 'destructive', title: 'Gagal membuat PDF' }); }
  };

  const columns = [
    { key: 'excise_number', header: 'No. Cukai', sortable: true, className: 'font-mono font-medium' },
    { key: 'product_name', header: 'Produk', sortable: true, className: 'font-medium' },
    { key: 'brand_name', header: 'Merk', render: (row) => row.brand_name || '—' },
    { key: 'batch_number', header: 'Batch', className: 'font-mono' },
    { key: 'quantity', header: 'Jumlah', render: (row) => <span className="tabular-nums">{row.quantity}</span> },
    { key: 'excise_reference_number', header: 'Ref. Cukai', render: (row) => row.excise_reference_number || '—' },
    { key: 'excise_date', header: 'Tanggal', sortable: true },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    { key: 'actions', header: '', width: '56px', render: (row) => <PdfButton onExport={() => exportExcisePDF(row)} perm="excise" iconOnly label="Cetak Dokumen" /> },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader title="Proses Cukai" description="Proses pita cukai untuk barang belum cukai"
        actions={<Button onClick={openAdd} size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> Proses Cukai Baru</Button>} />
      <DataTable columns={columns} data={data} loading={loading} emptyMessage="Belum ada proses cukai" searchKeys={['excise_number', 'product_name', 'batch_number']} searchPlaceholder="Cari proses cukai..." />

      <FormModal open={modalOpen} onClose={() => setModalOpen(false)} title="Proses Cukai Baru" onSubmit={handleSubmit} submitting={submitting} submitLabel="Proses Cukai">
        <div>
          <Label className="text-[12.5px] mb-1">Produk (Belum Cukai) *</Label>
          <Select value={form.stock_id} onValueChange={v => {
            const stock = belumCukaiStock.find(s => s.id === v);
            const prod = products.find(p => p.id === stock?.item_id);
            setForm({ ...form, stock_id: v, product_id: stock?.item_id || '', brand_id: prod?.brand_id || '', bottle_size: prod?.bottle_size ?? '' });
          }}>
            <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Pilih produk belum cukai" /></SelectTrigger>
            <SelectContent>
              {belumCukaiStock.map(s => {
                const p = products.find(p => p.id === s.item_id);
                return <SelectItem key={s.id} value={s.id}>{getInventoryDisplayName(p?.name || s.item_name, 'UNEXCISED')} ({s.available_quantity} unit){s.batch_number ? ` · ${s.batch_number}` : ''}</SelectItem>;
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-[12.5px] mb-1">Merk</Label><Input value={brands.find(b => b.id === form.brand_id)?.name || ''} disabled className="h-9 text-[13px] bg-muted/40" /></div>
          <div><Label className="text-[12.5px] mb-1">Ukuran Botol (ml)</Label><NumberInput value={form.bottle_size} onChange={v => setForm({ ...form, bottle_size: v })} allowDecimal maxDecimals={1} min={0} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Jumlah *</Label><NumberInput value={form.quantity} onChange={v => setForm({ ...form, quantity: v })} allowDecimal={false} min={0} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Jenis Pita Cukai</Label><Input value={form.excise_label_type} onChange={e => setForm({ ...form, excise_label_type: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Nomor Dokumen</Label><Input value={form.document_number} onChange={e => setForm({ ...form, document_number: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Nomor Referensi Cukai</Label><Input value={form.excise_reference_number} onChange={e => setForm({ ...form, excise_reference_number: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Tanggal Proses</Label><Input type="date" value={form.excise_date} onChange={e => setForm({ ...form, excise_date: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Operator *</Label><Input value={form.operator} onChange={e => setForm({ ...form, operator: e.target.value })} className="h-9 text-[13px]" /></div>
        </div>
        <div><Label className="text-[12.5px] mb-1">Catatan</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="text-[13px]" /></div>
      </FormModal>
    </div>
  );
}