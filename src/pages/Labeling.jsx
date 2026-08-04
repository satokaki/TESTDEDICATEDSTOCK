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
import { Plus, CheckCircle } from 'lucide-react';
import { generateOrderNumber } from '@/lib/sequence';
import { recordStockMovement, getAllStockBalances, createAuditLog } from '@/lib/stockUtils';

export default function Labeling() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [siapLabelingStock, setSiapLabelingStock] = useState([]);
  const [products, setProducts] = useState([]);
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ product_id: '', brand_id: '', batch_id: '', bottle_size: 0, quantity: 0, label_type: '', operator: '', labeling_date: new Date().toISOString().slice(0, 10), notes: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [items, balances, prods, brs] = await Promise.all([
        base44.entities.LabelingOrder.list('-created_date', 100),
        getAllStockBalances('product'),
        base44.entities.Product.filter({ is_active: true }),
        base44.entities.Brand.filter({ is_active: true }),
      ]);
      setData(items);
      // Stock with siap_labeling type products
      const slStock = balances.filter(b => b.quantity > 0);
      setSiapLabelingStock(slStock);
      setProducts(prods);
      setBrands(brs);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat data' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const openAdd = () => {
    setForm({ product_id: '', brand_id: '', batch_id: '', bottle_size: 0, quantity: 0, label_type: '', operator: '', labeling_date: new Date().toISOString().slice(0, 10), notes: '' });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.product_id || !form.quantity || !form.operator) { toast({ variant: 'destructive', title: 'Produk, jumlah, dan operator wajib diisi' }); return; }
    const stockItem = siapLabelingStock.find(s => s.item_id === form.product_id);
    if (stockItem && Number(form.quantity) > stockItem.available_quantity) {
      toast({ variant: 'destructive', title: 'Jumlah melebihi stok siap labeling', description: `Tersedia: ${stockItem.available_quantity}` });
      return;
    }
    setSubmitting(true);
    try {
      const product = products.find(p => p.id === form.product_id);
      const brand = brands.find(b => b.id === form.brand_id);
      const lblNumber = await generateOrderNumber('LBL', 'LabelingOrder');
      const labeling = await base44.entities.LabelingOrder.create({
        labeling_number: lblNumber,
        brand_id: form.brand_id, brand_name: brand?.name || '',
        product_id: form.product_id, product_name: product?.name || '',
        batch_id: stockItem?.batch_id || '', batch_number: stockItem?.batch_number || '',
        bottle_size: Number(form.bottle_size), quantity: Number(form.quantity),
        label_type: form.label_type, operator: form.operator,
        labeling_date: form.labeling_date, status: 'belum_cukai', notes: form.notes,
      });
      // Reduce siap_labeling stock
      await recordStockMovement({
        item_type: 'product', item_id: form.product_id, item_name: product?.name || '', item_code: product?.code || '',
        batch_id: stockItem?.batch_id || '', batch_number: stockItem?.batch_number || '',
        quantity_out: Number(form.quantity), unit: 'unit',
        transaction_type: 'labeling_consumption', transaction_number: lblNumber,
        reference_type: 'labeling', reference_id: labeling.id,
        notes: `Labeling ${lblNumber}`,
      });
      // Add belum_cukai stock
      await recordStockMovement({
        item_type: 'product', item_id: form.product_id, item_name: product?.name || '', item_code: product?.code || '',
        batch_id: stockItem?.batch_id || '', batch_number: stockItem?.batch_number || '',
        quantity_in: Number(form.quantity), unit: 'unit',
        transaction_type: 'labeling_output', transaction_number: lblNumber,
        reference_type: 'labeling', reference_id: labeling.id,
        notes: `Barang berlabel (belum cukai)`,
      });
      await createAuditLog({ module: 'Labeling', action: 'Selesai', entity_type: 'LabelingOrder', entity_id: labeling.id, reference_number: lblNumber });
      toast({ title: 'Labeling selesai', description: lblNumber });
      setModalOpen(false); loadData();
    } catch (e) { toast({ variant: 'destructive', title: 'Gagal menyimpan', description: e.message }); }
    finally { setSubmitting(false); }
  };

  const columns = [
    { key: 'labeling_number', header: 'No. Labeling', sortable: true, className: 'font-mono font-medium' },
    { key: 'product_name', header: 'Produk', sortable: true, className: 'font-medium' },
    { key: 'brand_name', header: 'Merk', render: (row) => row.brand_name || '—' },
    { key: 'batch_number', header: 'Batch', className: 'font-mono' },
    { key: 'bottle_size', header: 'Ukuran', render: (row) => row.bottle_size ? `${row.bottle_size} ml` : '—' },
    { key: 'quantity', header: 'Jumlah', render: (row) => <span className="tabular-nums">{row.quantity}</span> },
    { key: 'labeling_date', header: 'Tanggal', sortable: true },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader title="Labeling" description="Labeling barang siap labeling"
        actions={<Button onClick={openAdd} size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> Labeling Baru</Button>} />
      <DataTable columns={columns} data={data} loading={loading} emptyMessage="Belum ada labeling" searchKeys={['labeling_number', 'product_name', 'batch_number']} searchPlaceholder="Cari labeling..." />

      <FormModal open={modalOpen} onClose={() => setModalOpen(false)} title="Labeling Baru" onSubmit={handleSubmit} submitting={submitting} submitLabel="Proses Labeling">
        <div>
          <Label className="text-[12.5px] mb-1">Produk (Siap Labeling) *</Label>
          <Select value={form.product_id} onValueChange={v => {
            const stock = siapLabelingStock.find(s => s.item_id === v);
            const prod = products.find(p => p.id === v);
            setForm({ ...form, product_id: v, brand_id: prod?.brand_id || '', bottle_size: prod?.bottle_size || 0, batch_id: stock?.batch_id || '' });
          }}>
            <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Pilih produk siap labeling" /></SelectTrigger>
            <SelectContent>
              {siapLabelingStock.map(s => {
                const p = products.find(p => p.id === s.item_id);
                return <SelectItem key={s.item_id} value={s.item_id}>{s.item_name} ({s.available_quantity} unit){s.batch_number ? ` · ${s.batch_number}` : ''}</SelectItem>;
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-[12.5px] mb-1">Merk</Label><Input value={brands.find(b => b.id === form.brand_id)?.name || ''} disabled className="h-9 text-[13px] bg-muted/40" /></div>
          <div><Label className="text-[12.5px] mb-1">Ukuran Botol (ml)</Label><Input type="number" value={form.bottle_size} onChange={e => setForm({ ...form, bottle_size: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Jumlah *</Label><Input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Jenis Label</Label><Input value={form.label_type} onChange={e => setForm({ ...form, label_type: e.target.value })} className="h-9 text-[13px]" placeholder="Contoh: Label Standard" /></div>
          <div><Label className="text-[12.5px] mb-1">Tanggal Labeling</Label><Input type="date" value={form.labeling_date} onChange={e => setForm({ ...form, labeling_date: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Operator *</Label><Input value={form.operator} onChange={e => setForm({ ...form, operator: e.target.value })} className="h-9 text-[13px]" /></div>
        </div>
        <div><Label className="text-[12.5px] mb-1">Catatan</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="text-[13px]" /></div>
      </FormModal>
    </div>
  );
}