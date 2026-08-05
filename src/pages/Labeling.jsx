import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import FormModal from '@/components/FormModal';
import StatusBadge from '@/components/StatusBadge';
import SearchableSelect from '@/components/SearchableSelect';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { generateOrderNumber } from '@/lib/sequence';
import { recordStockMovement, getAllStockBalances, createAuditLog } from '@/lib/stockUtils';
import NumberInput from '@/components/NumberInput';
import PdfButton from '@/components/PdfButton';
import { exportDocumentToPDF } from '@/lib/pdfExport';
import { getInventoryDisplayName } from '@/lib/inventoryDisplay';

const emptyLabelLine = () => ({ label_item_id: '', quantity_per_unit: '1' });

export default function Labeling() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [siapLabelingStock, setSiapLabelingStock] = useState([]);
  const [products, setProducts] = useState([]);
  const [brands, setBrands] = useState([]);
  const [labelMaterials, setLabelMaterials] = useState([]);
  const [materialStocks, setMaterialStocks] = useState({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ product_id: '', stock_id: '', brand_id: '', batch_id: '', bottle_size: 0, quantity: '', operator: '', labeling_date: new Date().toISOString().slice(0, 10), notes: '', labels: [emptyLabelLine()] });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [items, balances, prods, brs, mats, matBalances] = await Promise.all([
        base44.entities.LabelingOrder.list('-created_date', 100),
        getAllStockBalances('product'),
        base44.entities.Product.filter({ is_active: true }),
        base44.entities.Brand.filter({ is_active: true }),
        base44.entities.Material.filter({ is_active: true }),
        getAllStockBalances('material'),
      ]);
      setData(items);
      setSiapLabelingStock(balances.filter(b => b.inventory_status === 'READY_FOR_LABELING' && b.quantity > 0));
      setProducts(prods);
      setBrands(brs);
      setLabelMaterials(mats.filter(m => m.material_type === 'LABEL' || m.material_type === 'STICKER'));
      const sm = {};
      matBalances.forEach(b => { sm[b.item_id] = (sm[b.item_id] || 0) + (b.available_quantity || 0); });
      setMaterialStocks(sm);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat data' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const openAdd = () => {
    setForm({ product_id: '', stock_id: '', brand_id: '', batch_id: '', bottle_size: 0, quantity: '', operator: '', labeling_date: new Date().toISOString().slice(0, 10), notes: '', labels: [emptyLabelLine()] });
    setModalOpen(true);
  };

  const selectedProduct = products.find(p => p.id === form.product_id);
  const selectedStock = siapLabelingStock.find(s => s.id === form.stock_id);

  const availableLabels = labelMaterials.filter(m => {
    if ((materialStocks[m.id] || 0) <= 0) return false;
    if (m.product_id && form.product_id && m.product_id !== form.product_id) return false;
    if (m.brand_id && form.brand_id && m.brand_id !== form.brand_id) return false;
    if (m.bottle_size_ml && form.bottle_size && Number(m.bottle_size_ml) !== Number(form.bottle_size)) return false;
    return true;
  });

  const labelOptions = availableLabels.map(m => ({
    value: m.id,
    label: `${m.code || ''} · ${m.name} · Stok: ${materialStocks[m.id] || 0} pcs`,
    keywords: `${m.code || ''} ${m.name} ${m.color || ''} ${m.model || ''} ${m.bottle_size_ml || ''} ${m.category_name || ''} ${m.label_type || ''}`,
  }));

  const updateLabelLine = (idx, patch) => setForm(f => { const l = [...f.labels]; l[idx] = { ...l[idx], ...patch }; return { ...f, labels: l }; });
  const addLabelLine = () => setForm(f => ({ ...f, labels: [...f.labels, emptyLabelLine()] }));
  const removeLabelLine = (idx) => setForm(f => ({ ...f, labels: f.labels.filter((_, i) => i !== idx) }));

  const labelRequiredTotal = (line) => {
    const qty = Number(form.quantity) || 0;
    const per = Number(line.quantity_per_unit) || 0;
    return qty * per;
  };

  const handleSubmit = async () => {
    if (!form.product_id || !form.quantity || !form.operator) { toast({ variant: 'destructive', title: 'Produk, jumlah, dan operator wajib diisi' }); return; }
    const labelLines = form.labels.filter(l => l.label_item_id && Number(l.quantity_per_unit) > 0);
    if (labelLines.length === 0) { toast({ variant: 'destructive', title: 'Label wajib dipilih', description: 'Pilih minimal satu item label dari stok' }); return; }
    if (selectedStock && Number(form.quantity) > selectedStock.available_quantity) {
      toast({ variant: 'destructive', title: 'Jumlah melebihi stok siap labeling', description: `Tersedia: ${selectedStock.available_quantity}` });
      return;
    }
    const working = {};
    for (const l of labelLines) working[l.label_item_id] = materialStocks[l.label_item_id] || 0;
    for (const l of labelLines) {
      const need = labelRequiredTotal(l);
      if (working[l.label_item_id] < need) {
        const m = labelMaterials.find(x => x.id === l.label_item_id);
        toast({ variant: 'destructive', title: 'Stok label tidak mencukupi', description: `${m?.name || ''}: dibutuhkan ${need} pcs, tersedia ${working[l.label_item_id]} pcs` });
        return;
      }
      working[l.label_item_id] -= need;
    }
    setSubmitting(true);
    try {
      const product = selectedProduct;
      const brand = brands.find(b => b.id === form.brand_id);
      const lblNumber = await generateOrderNumber('LBL', 'LabelingOrder');
      const firstLabel = labelLines[0];
      const firstMat = labelMaterials.find(m => m.id === firstLabel.label_item_id);
      const totalLabelReq = labelLines.reduce((s, l) => s + labelRequiredTotal(l), 0);
      const labeling = await base44.entities.LabelingOrder.create({
        labeling_number: lblNumber,
        brand_id: form.brand_id, brand_name: brand?.name || '',
        product_id: form.product_id, product_name: product?.name || '',
        batch_id: selectedStock?.batch_id || '', batch_number: selectedStock?.batch_number || '',
        bottle_size: Number(form.bottle_size), quantity: Number(form.quantity),
        label_type: firstMat?.name || '',
        label_item_id: firstMat?.id || '', label_item_code: firstMat?.code || '', label_item_name: firstMat?.name || '',
        label_quantity_per_unit: Number(firstLabel.quantity_per_unit) || 1,
        label_total_required: totalLabelReq,
        label_color: firstMat?.color || '', label_model: firstMat?.model || '',
        operator: form.operator, labeling_date: form.labeling_date, status: 'belum_cukai', notes: form.notes,
      });
      // Reduce siap_labeling stock (product)
      await recordStockMovement({
        item_type: 'product', item_id: form.product_id, item_name: product?.name || '', item_code: product?.code || '',
        batch_id: selectedStock?.batch_id || '', batch_number: selectedStock?.batch_number || '',
        inventory_status: 'READY_FOR_LABELING',
        quantity_out: Number(form.quantity), unit: 'unit',
        transaction_type: 'labeling_consumption', transaction_number: lblNumber,
        reference_type: 'labeling', reference_id: labeling.id,
        notes: `Labeling ${lblNumber}`,
      });
      // Add belum_cukai stock
      await recordStockMovement({
        item_type: 'product', item_id: form.product_id, item_name: product?.name || '', item_code: product?.code || '',
        batch_id: selectedStock?.batch_id || '', batch_number: selectedStock?.batch_number || '',
        inventory_status: 'UNEXCISED',
        quantity_in: Number(form.quantity), unit: 'unit',
        transaction_type: 'labeling_output', transaction_number: lblNumber,
        reference_type: 'labeling', reference_id: labeling.id,
        notes: `Barang berlabel (belum cukai)`,
      });
      // Consume each label material + create LabelingMaterial records
      for (const l of labelLines) {
        const m = labelMaterials.find(x => x.id === l.label_item_id);
        const need = labelRequiredTotal(l);
        const before = materialStocks[m.id] || 0;
        await recordStockMovement({
          item_type: 'material', item_id: m.id, item_name: m.name, item_code: m.code || '',
          inventory_status: '',
          quantity_out: need, unit: m.unit || 'unit',
          transaction_type: 'label_consumption', transaction_number: lblNumber,
          reference_type: 'labeling', reference_id: labeling.id,
          notes: `Konsumsi label ${lblNumber} (${need} pcs)`,
        });
        await base44.entities.LabelingMaterial.create({
          labeling_id: labeling.id, labeling_number: lblNumber,
          label_item_id: m.id, label_item_code: m.code || '', label_item_name: m.name,
          quantity_per_unit: Number(l.quantity_per_unit) || 1,
          total_quantity_required: need,
          stock_before: before, stock_after: before - need,
          unit: m.unit || 'unit',
        });
      }
      await createAuditLog({ module: 'Labeling', action: 'Selesai', entity_type: 'LabelingOrder', entity_id: labeling.id, reference_number: lblNumber });
      toast({ title: 'Labeling selesai', description: lblNumber });
      setModalOpen(false); loadData();
    } catch (e) { toast({ variant: 'destructive', title: 'Gagal menyimpan', description: e.message }); }
    finally { setSubmitting(false); }
  };

  const exportLabelingPDF = async (row) => {
    let labelMats = [];
    try { labelMats = await base44.entities.LabelingMaterial.filter({ labeling_id: row.id }); } catch {}
    try {
      exportDocumentToPDF({
        title: 'Work Order Labeling',
        docNumber: row.labeling_number, docDate: row.labeling_date,
        partyLabel: 'Produk', party: { name: row.product_name },
        infoLines: [
          { label: 'Merk', value: row.brand_name || '-' },
          { label: 'No. Batch', value: row.batch_number || '-' },
          { label: 'Ukuran', value: row.bottle_size ? `${row.bottle_size} ml` : '-' },
          { label: 'Jumlah', value: row.quantity },
          { label: 'Operator', value: row.operator || '-' },
          { label: 'Status', value: row.status },
        ],
        itemColumns: [{ key: 'desc', header: 'Label yang Digunakan' }],
        itemRows: labelMats.length
          ? labelMats.map(l => ({ desc: `${l.label_item_code || ''} ${l.label_item_name} — ${l.total_quantity_required} ${l.unit || 'pcs'} (per unit ${l.quantity_per_unit})` }))
          : [{ desc: `Labeling ${row.quantity} unit ${row.product_name}${row.bottle_size ? ` ${row.bottle_size}ml` : ''} (batch ${row.batch_number || '-'})` }],
        totals: [{ label: 'Jumlah Unit', value: row.quantity, bold: true }],
        notes: row.notes,
        signatures: [{ label: 'Operator,', name: row.operator || '' }],
        fileName: `labeling-${row.labeling_number}.pdf`,
      });
    } catch { toast({ variant: 'destructive', title: 'Gagal membuat PDF' }); }
  };

  const columns = [
    { key: 'labeling_number', header: 'No. Labeling', sortable: true, className: 'font-mono font-medium' },
    { key: 'product_name', header: 'Produk', sortable: true, className: 'font-medium' },
    { key: 'brand_name', header: 'Merk', render: (row) => row.brand_name || '—' },
    { key: 'batch_number', header: 'Batch', className: 'font-mono' },
    { key: 'bottle_size', header: 'Ukuran', render: (row) => row.bottle_size ? `${row.bottle_size} ml` : '—' },
    { key: 'quantity', header: 'Jumlah', render: (row) => <span className="tabular-nums">{row.quantity}</span> },
    { key: 'label_item_name', header: 'Label', render: (row) => row.label_item_name || row.label_type || '—' },
    { key: 'labeling_date', header: 'Tanggal', sortable: true },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    { key: 'actions', header: '', width: '56px', render: (row) => <PdfButton onExport={() => exportLabelingPDF(row)} perm="labeling" iconOnly label="Cetak Work Order" /> },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader title="Labeling" description="Labeling barang siap labeling — konsumsi label dari stok"
        actions={<Button onClick={openAdd} size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> Labeling Baru</Button>} />
      <DataTable columns={columns} data={data} loading={loading} emptyMessage="Belum ada labeling" searchKeys={['labeling_number', 'product_name', 'batch_number']} searchPlaceholder="Cari labeling..." />

      <FormModal open={modalOpen} onClose={() => setModalOpen(false)} title="Labeling Baru" onSubmit={handleSubmit} submitting={submitting} submitLabel="Proses Labeling" size="lg">
        <div>
          <Label className="text-[12.5px] mb-1">Produk (Siap Labeling) *</Label>
          <Select value={form.stock_id} onValueChange={v => {
            const stock = siapLabelingStock.find(s => s.id === v);
            const prod = products.find(p => p.id === stock?.item_id);
            setForm({ ...form, stock_id: v, product_id: stock?.item_id || '', brand_id: prod?.brand_id || '', bottle_size: prod?.bottle_size || 0, batch_id: stock?.batch_id || '', labels: [emptyLabelLine()] });
          }}>
            <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Pilih produk siap labeling" /></SelectTrigger>
            <SelectContent>
              {siapLabelingStock.map(s => {
                const p = products.find(p => p.id === s.item_id);
                return <SelectItem key={s.id} value={s.id}>{getInventoryDisplayName(p?.name || s.item_name, 'READY_FOR_LABELING')} ({s.available_quantity} unit){s.batch_number ? ` · ${s.batch_number}` : ''}</SelectItem>;
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-[12.5px] mb-1">Merk</Label><Input value={brands.find(b => b.id === form.brand_id)?.name || ''} disabled className="h-9 text-[13px] bg-muted/40" /></div>
          <div><Label className="text-[12.5px] mb-1">Ukuran Botol (ml)</Label><Input value={form.bottle_size || ''} disabled className="h-9 text-[13px] bg-muted/40" /></div>
          <div><Label className="text-[12.5px] mb-1">Jumlah *</Label><NumberInput value={form.quantity} onChange={v => setForm({ ...form, quantity: v })} allowDecimal={false} min={0} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Tanggal Labeling</Label><Input type="date" value={form.labeling_date} onChange={e => setForm({ ...form, labeling_date: e.target.value })} className="h-9 text-[13px]" /></div>
          <div className="col-span-2"><Label className="text-[12.5px] mb-1">Operator *</Label><Input value={form.operator} onChange={e => setForm({ ...form, operator: e.target.value })} className="h-9 text-[13px]" /></div>
        </div>

        <div className="border-t pt-3">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-[12.5px] font-semibold">Label yang Digunakan *</Label>
            <Button type="button" onClick={addLabelLine} size="sm" variant="outline" className="h-7 text-[12px] gap-1"><Plus className="w-3.5 h-3.5" /> Tambah Label</Button>
          </div>
          <div className="space-y-2">
            {form.labels.map((l, idx) => {
              const need = labelRequiredTotal(l);
              const stock = l.label_item_id ? (materialStocks[l.label_item_id] || 0) : 0;
              const insufficient = l.label_item_id && stock < need;
              return (
                <div key={idx} className="border border-border rounded-lg p-2.5 space-y-2 bg-muted/10">
                  <div className="flex items-center justify-between">
                    <span className="text-[10.5px] font-semibold text-muted-foreground">LABEL {idx + 1}</span>
                    {form.labels.length > 1 && <button type="button" onClick={() => removeLabelLine(idx)} className="p-1 hover:bg-red-50 rounded text-red-500" title="Hapus"><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                  <div>
                    <Label className="text-[11.5px] mb-1">Item Label</Label>
                    <SearchableSelect value={l.label_item_id} onValueChange={v => updateLabelLine(idx, { label_item_id: v })} placeholder="Cari label (kode/nama/ukuran)" options={labelOptions} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-[11.5px] mb-1">Per Unit (pcs)</Label><NumberInput value={l.quantity_per_unit} onChange={v => updateLabelLine(idx, { quantity_per_unit: v })} allowDecimal min={0} className="h-9 text-[13px]" /></div>
                    <div><Label className="text-[11.5px] mb-1">Stok Tersedia</Label><div className={`h-9 flex items-center text-[13px] tabular-nums ${insufficient ? 'text-red-500 font-medium' : 'text-muted-foreground'}`}>{l.label_item_id ? `${stock} pcs` : '—'}</div></div>
                  </div>
                  <div className="flex items-center justify-between border-t border-border/50 pt-1.5">
                    <span className="text-[11.5px] text-muted-foreground">Kebutuhan ({Number(form.quantity) || 0} × {Number(l.quantity_per_unit) || 0})</span>
                    <span className="text-[13px] font-medium tabular-nums">{need} pcs</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div><Label className="text-[12.5px] mb-1">Catatan</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="text-[13px]" /></div>
      </FormModal>
    </div>
  );
}