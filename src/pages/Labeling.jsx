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
import { Checkbox } from '@/components/ui/checkbox';
import { Plus } from 'lucide-react';
import { generateOrderNumber } from '@/lib/sequence';
import { recordStockMovement, getAllStockBalances, createAuditLog } from '@/lib/stockUtils';
import { getInventoryDisplayName } from '@/lib/inventoryDisplay';

export default function Labeling() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [siapLabelStock, setSiapLabelStock] = useState([]);
  const [products, setProducts] = useState([]);
  const [brands, setBrands] = useState([]);
  const [labelMappings, setLabelMappings] = useState([]);
  const [labelMaterials, setLabelMaterials] = useState([]);
  const [labelStocks, setLabelStocks] = useState({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ stock_id: '', product_id: '', product_name: '', brand_id: '', brand_name: '', batch_id: '', batch_number: '', bottle_size: '', available_qty: '', quantity: '', labeling_date: new Date().toISOString().slice(0, 10), operator: '', notes: '', labels: [] });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [items, balances, prods, brs, maps, mats, matBal] = await Promise.all([
        base44.entities.LabelingOrder.list('-created_date', 100),
        getAllStockBalances('product'),
        base44.entities.Product.filter({ is_active: true }),
        base44.entities.Brand.filter({ is_active: true }),
        base44.entities.ProductComponentMapping.filter({ component_type: 'label', is_active: true }),
        base44.entities.Material.filter({ is_active: true }),
        getAllStockBalances('material'),
      ]);
      setData(items);
      setSiapLabelStock(balances.filter(b => b.inventory_status === 'READY_FOR_LABELING' && b.quantity > 0));
      setProducts(prods); setBrands(brs);
      setLabelMappings(maps);
      setLabelMaterials(mats.filter(m => m.material_type === 'LABEL' || m.material_type === 'STICKER'));
      const sm = {}; matBal.forEach(b => { sm[b.item_id] = (sm[b.item_id] || 0) + (b.available_quantity || 0); });
      setLabelStocks(sm);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat data' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const buildLabels = (productId) => {
    const maps = labelMappings.filter(m => m.product_id === productId);
    return maps.map(m => {
      const mat = labelMaterials.find(lm => lm.id === m.material_id);
      return { mapping_id: m.id, material_id: m.material_id, material_name: mat?.name || m.material_name, material_code: mat?.code || m.material_code, unit: mat?.unit || 'unit', quantity_per_unit: String(m.quantity_per_unit ?? 1), stock: labelStocks[m.material_id] || 0, checked: true };
    });
  };

  const openAdd = () => {
    setForm({ stock_id: '', product_id: '', product_name: '', brand_id: '', brand_name: '', batch_id: '', batch_number: '', bottle_size: '', available_qty: '', quantity: '', labeling_date: new Date().toISOString().slice(0, 10), operator: '', notes: '', labels: [] });
    setModalOpen(true);
  };

  const onStockChange = (v) => {
    const s = siapLabelStock.find(b => b.id === v);
    const p = products.find(p => p.id === s?.item_id);
    const pid = s?.item_id || '';
    setForm(f => ({ ...f, stock_id: v, product_id: pid, product_name: p?.name || s?.item_name || '', brand_id: p?.brand_id || '', brand_name: p?.brand_name || '', batch_id: s?.batch_id || '', batch_number: s?.batch_number || '', bottle_size: p?.bottle_size ?? '', available_qty: s?.available_quantity || '', quantity: String(s?.available_quantity || ''), labels: buildLabels(pid) }));
  };

  const updateLabel = (idx, patch) => setForm(f => ({ ...f, labels: f.labels.map((l, i) => i === idx ? { ...l, ...patch } : l) }));

  const handleSubmit = async () => {
    if (!form.stock_id || !form.quantity || !form.operator) { toast({ variant: 'destructive', title: 'Batch, jumlah, operator wajib' }); return; }
    if (Number(form.quantity) > Number(form.available_qty)) { toast({ variant: 'destructive', title: 'Jumlah melebihi stok siap labeling', description: `Tersedia: ${form.available_qty}` }); return; }
    const used = form.labels.filter(l => l.checked);
    if (used.length === 0) { toast({ variant: 'destructive', title: 'Pilih minimal satu label' }); return; }
    for (const l of used) {
      const need = Number(form.quantity) * (Number(l.quantity_per_unit) || 0);
      if (need > l.stock) { toast({ variant: 'destructive', title: `Stok label "${l.material_name}" tidak cukup`, description: `Butuh ${need}, stok ${l.stock}` }); return; }
    }
    setSubmitting(true);
    try {
      const product = products.find(p => p.id === form.product_id);
      const brand = brands.find(b => b.id === form.brand_id);
      const lblNumber = await generateOrderNumber('LBL', 'LabelingOrder');
      const def = used[0];
      const order = await base44.entities.LabelingOrder.create({
        labeling_number: lblNumber, brand_id: form.brand_id, brand_name: brand?.name || '',
        product_id: form.product_id, product_name: product?.name || form.product_name,
        batch_id: form.batch_id, batch_number: form.batch_number, bottle_size: Number(form.bottle_size),
        quantity: Number(form.quantity), label_type: def.material_name, label_item_id: def.material_id, label_item_code: def.material_code, label_item_name: def.material_name,
        label_quantity_per_unit: Number(def.quantity_per_unit) || 1, label_total_required: Number(form.quantity) * (Number(def.quantity_per_unit) || 1),
        labeling_date: form.labeling_date, operator: form.operator, status: 'belum_cukai', notes: form.notes,
      });
      for (const l of used) {
        const totalReq = Number(form.quantity) * (Number(l.quantity_per_unit) || 1);
        await base44.entities.LabelingMaterial.create({
          labeling_id: order.id, labeling_number: lblNumber,
          label_item_id: l.material_id, label_item_code: l.material_code, label_item_name: l.material_name,
          quantity_per_unit: Number(l.quantity_per_unit) || 1, total_quantity_required: totalReq,
          stock_before: l.stock, stock_after: l.stock - totalReq, unit: l.unit,
        });
        await recordStockMovement({
          item_type: 'material', item_id: l.material_id, item_name: l.material_name, item_code: l.material_code,
          inventory_status: '', quantity_out: totalReq, unit: l.unit,
          transaction_type: 'label_consumption', transaction_number: lblNumber,
          reference_type: 'labeling', reference_id: order.id, notes: `Label untuk ${lblNumber}`,
        });
      }
      await recordStockMovement({
        item_type: 'product', item_id: form.product_id, item_name: product?.name || form.product_name, item_code: product?.code || '',
        batch_id: form.batch_id, batch_number: form.batch_number, inventory_status: 'READY_FOR_LABELING',
        quantity_out: Number(form.quantity), unit: 'unit', transaction_type: 'labeling_consumption', transaction_number: lblNumber,
        reference_type: 'labeling', reference_id: order.id, notes: `Labeling ${lblNumber}`,
      });
      await recordStockMovement({
        item_type: 'product', item_id: form.product_id, item_name: product?.name || form.product_name, item_code: product?.code || '',
        batch_id: form.batch_id, batch_number: form.batch_number, inventory_status: 'UNEXCISED',
        quantity_in: Number(form.quantity), unit: 'unit', transaction_type: 'labeling_output', transaction_number: lblNumber,
        reference_type: 'labeling', reference_id: order.id, notes: `Output labeling ${lblNumber}`,
      });
      await createAuditLog({ module: 'Labeling', action: 'Selesai', entity_type: 'LabelingOrder', entity_id: order.id, reference_number: lblNumber });
      toast({ title: 'Labeling selesai', description: lblNumber });
      setModalOpen(false); loadData();
    } catch (e) { toast({ variant: 'destructive', title: 'Gagal menyimpan', description: e.message }); }
    finally { setSubmitting(false); }
  };

  const columns = [
    { key: 'labeling_number', header: 'No. Labeling', sortable: true, className: 'font-mono font-medium' },
    { key: 'product_name', header: 'Produk', sortable: true, className: 'font-medium' },
    { key: 'brand_name', header: 'Merk', render: r => r.brand_name || '—' },
    { key: 'batch_number', header: 'Batch', className: 'font-mono' },
    { key: 'quantity', header: 'Jumlah', render: r => <span className="tabular-nums">{r.quantity}</span> },
    { key: 'labeling_date', header: 'Tanggal', sortable: true },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader title="Labeling" description="Labeling barang siap labeling → belum cukai. Label dipilih dari mapping produk."
        actions={<Button onClick={openAdd} size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> Labeling Baru</Button>} />
      <DataTable columns={columns} data={data} loading={loading} emptyMessage="Belum ada labeling" searchKeys={['labeling_number', 'product_name', 'batch_number']} searchPlaceholder="Cari labeling..." />

      <FormModal open={modalOpen} onClose={() => setModalOpen(false)} title="Labeling Baru" onSubmit={handleSubmit} submitting={submitting} submitLabel="Proses Labeling" size="lg">
        <div>
          <Label className="text-[12.5px] mb-1">Batch Siap Labeling *</Label>
          <Select value={form.stock_id} onValueChange={onStockChange}>
            <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Pilih batch siap labeling" /></SelectTrigger>
            <SelectContent>
              {siapLabelStock.map(s => {
                const p = products.find(p => p.id === s.item_id);
                return <SelectItem key={s.id} value={s.id}>{getInventoryDisplayName(p?.name || s.item_name, 'READY_FOR_LABELING')} ({s.available_quantity} unit){s.batch_number ? ` · ${s.batch_number}` : ''}</SelectItem>;
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-[12.5px] mb-1">Produk</Label><Input value={form.product_name} disabled className="h-9 text-[13px] bg-muted/40" /></div>
          <div><Label className="text-[12.5px] mb-1">Merk</Label><Input value={form.brand_name} disabled className="h-9 text-[13px] bg-muted/40" /></div>
          <div><Label className="text-[12.5px] mb-1">Batch</Label><Input value={form.batch_number} disabled className="h-9 text-[13px] bg-muted/40" /></div>
          <div><Label className="text-[12.5px] mb-1">Stok Tersedia (unit)</Label><Input value={form.available_qty} disabled className="h-9 text-[13px] bg-muted/40" /></div>
          <div><Label className="text-[12.5px] mb-1">Jumlah Dilabeli *</Label><NumberInput value={form.quantity} onChange={v => setForm({ ...form, quantity: v })} allowDecimal={false} min={0} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Tanggal</Label><Input type="date" value={form.labeling_date} onChange={e => setForm({ ...form, labeling_date: e.target.value })} className="h-9 text-[13px]" /></div>
        </div>
        <div>
          <Label className="text-[12.5px] mb-1">Label (dari Mapping)</Label>
          {form.product_id && form.labels.length === 0 && <p className="text-[11px] text-amber-600">Belum ada label di mapping produk ini. Tambahkan via Master Produk.</p>}
          <div className="space-y-1.5">
            {form.labels.map((l, idx) => (
              <div key={l.mapping_id} className="flex items-center gap-2 border border-border rounded px-2 py-1.5 bg-muted/10">
                <Checkbox checked={l.checked} onCheckedChange={v => updateLabel(idx, { checked: v })} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-medium truncate">{l.material_name}</div>
                  <div className="text-[11px] text-muted-foreground">Stok: {l.stock} {l.unit}</div>
                </div>
                <div className="w-24"><NumberInput value={l.quantity_per_unit} onChange={v => updateLabel(idx, { quantity_per_unit: v })} allowDecimal min={0} className="h-8 text-[12px]" /></div>
                <span className="text-[11px] text-muted-foreground">/unit</span>
                <span className="text-[11px] tabular-nums w-20 text-right">Butuh: {(Number(form.quantity) || 0) * (Number(l.quantity_per_unit) || 0)}</span>
              </div>
            ))}
          </div>
        </div>
        <div><Label className="text-[12.5px] mb-1">Operator *</Label><Input value={form.operator} onChange={e => setForm({ ...form, operator: e.target.value })} className="h-9 text-[13px]" /></div>
        <div><Label className="text-[12.5px] mb-1">Catatan</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="text-[13px]" /></div>
      </FormModal>
    </div>
  );
}