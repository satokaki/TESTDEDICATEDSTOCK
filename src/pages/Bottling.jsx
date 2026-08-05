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
import { Plus, X } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { generateOrderNumber } from '@/lib/sequence';
import { recordStockMovement, getAllStockBalances, createAuditLog } from '@/lib/stockUtils';
import NumberInput from '@/components/NumberInput';
import PdfButton from '@/components/PdfButton';
import { exportDocumentToPDF } from '@/lib/pdfExport';

const emptyOutput = () => ({ product_id: '', bottle_count: '', volume_per_bottle: '', bottle_item_id: '' });

export default function Bottling() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [batches, setBatches] = useState([]);
  const [products, setProducts] = useState([]);
  const [bottleMaterials, setBottleMaterials] = useState([]);
  const [materialStocks, setMaterialStocks] = useState({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ production_id: '', bottling_date: new Date().toISOString().slice(0, 10), operator: '', notes: '', outputs: [emptyOutput()], remaining_bulk: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [items, prods, allProducts, mats, matBalances] = await Promise.all([
        base44.entities.BottlingOrder.list('-created_date', 100),
        base44.entities.ProductionOrder.filter({ status: 'siap_bottling' }),
        base44.entities.Product.filter({ is_active: true }),
        base44.entities.Material.filter({ is_active: true }),
        getAllStockBalances('material'),
      ]);
      setData(items);
      setBatches(prods);
      setProducts(allProducts);
      setBottleMaterials(mats.filter(m => m.material_type === 'BOTTLE'));
      const sm = {};
      matBalances.forEach(b => { sm[b.item_id] = (sm[b.item_id] || 0) + (b.available_quantity || 0); });
      setMaterialStocks(sm);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat data' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const selectedBatch = batches.find(b => b.id === form.production_id);
  const totalOutput = form.outputs.reduce((sum, o) => sum + (Number(o.bottle_count) * Number(o.volume_per_bottle)), 0);
  const totalBulk = Number(selectedBatch?.actual_volume || 0);
  const remainingBulk = Number(form.remaining_bulk || 0);
  const waste = Math.max(0, totalBulk - totalOutput - remainingBulk);

  const openAdd = () => {
    setForm({ production_id: '', bottling_date: new Date().toISOString().slice(0, 10), operator: '', notes: '', outputs: [emptyOutput()], remaining_bulk: '' });
    setModalOpen(true);
  };
  const addOutput = () => setForm(f => ({ ...f, outputs: [...f.outputs, emptyOutput()] }));
  const updateOutput = (idx, patch) => setForm(f => { const o = [...f.outputs]; o[idx] = { ...o[idx], ...patch }; return { ...f, outputs: o }; });
  const removeOutput = (idx) => setForm(f => ({ ...f, outputs: f.outputs.filter((_, i) => i !== idx) }));

  const bottleOptions = (sizeMl) => bottleMaterials.filter(m => {
    if ((materialStocks[m.id] || 0) <= 0) return false;
    if (sizeMl && Number(m.bottle_size_ml) !== Number(sizeMl)) return false;
    return true;
  }).map(m => ({
    value: m.id,
    label: `${m.code || ''} · ${m.name} · Stok: ${materialStocks[m.id] || 0} pcs`,
    keywords: `${m.code || ''} ${m.name} ${m.color || ''} ${m.model || ''} ${m.bottle_size_ml || ''} ${m.category_name || ''}`,
  }));

  const bottleInfo = (itemId) => bottleMaterials.find(m => m.id === itemId);

  const handleSubmit = async () => {
    if (!form.production_id || !form.operator) { toast({ variant: 'destructive', title: 'Batch dan operator wajib diisi' }); return; }
    const outs = form.outputs.filter(o => o.product_id && Number(o.bottle_count) > 0 && Number(o.volume_per_bottle) > 0);
    if (outs.length === 0) { toast({ variant: 'destructive', title: 'Output belum lengkap' }); return; }
    const missingBottle = outs.find(o => !o.bottle_item_id);
    if (missingBottle) { toast({ variant: 'destructive', title: 'Item botol wajib dipilih untuk setiap output' }); return; }
    const calcWaste = totalBulk - totalOutput - remainingBulk;
    if (calcWaste < 0) { toast({ variant: 'destructive', title: 'Total output melebihi bulk tersedia' }); return; }
    const working = {};
    for (const o of outs) working[o.bottle_item_id] = materialStocks[o.bottle_item_id] || 0;
    for (const o of outs) {
      const need = Number(o.bottle_count);
      if (working[o.bottle_item_id] < need) {
        const m = bottleInfo(o.bottle_item_id);
        toast({ variant: 'destructive', title: 'Stok botol tidak mencukupi', description: `${m?.name || ''}: dibutuhkan ${need} pcs, tersedia ${working[o.bottle_item_id]} pcs` });
        return;
      }
      working[o.bottle_item_id] -= need;
    }
    setSubmitting(true);
    try {
      const batch = selectedBatch;
      const blgNumber = await generateOrderNumber('BLG', 'BottlingOrder');
      const bottling = await base44.entities.BottlingOrder.create({
        bottling_number: blgNumber,
        production_id: batch.id, batch_number: batch.batch_number,
        bottling_date: form.bottling_date, operator: form.operator,
        total_bulk_processed: totalBulk, total_output: totalOutput,
        waste: calcWaste, remaining_bulk: remainingBulk,
        status: 'siap_labeling', notes: form.notes,
      });
      const outputs = outs.map(o => {
        const prod = products.find(p => p.id === o.product_id);
        const btl = bottleInfo(o.bottle_item_id);
        return {
          bottling_id: bottling.id, product_id: o.product_id, product_name: prod?.name || '',
          bottle_size: Number(o.volume_per_bottle), bottle_count: Number(o.bottle_count),
          volume_per_bottle: Number(o.volume_per_bottle), total_volume: Number(o.bottle_count) * Number(o.volume_per_bottle),
          bottle_item_id: btl?.id || '', bottle_item_code: btl?.code || '', bottle_item_name: btl?.name || '',
          bottle_color: btl?.color || '', bottle_model: btl?.model || '', bottle_stock_used: Number(o.bottle_count),
          output_status: 'siap_labeling',
        };
      });
      await base44.entities.BottlingOutput.bulkCreate(outputs);
      // Reduce bulk
      await recordStockMovement({
        item_type: 'product', item_id: batch.product_id || batch.id, item_name: `Bulk ${batch.product_name || batch.batch_number}`, item_code: batch.batch_number,
        batch_id: batch.id, batch_number: batch.batch_number,
        inventory_status: 'BULK',
        quantity_out: totalBulk, unit: 'ml',
        transaction_type: 'bottling_consumption', transaction_number: blgNumber,
        reference_type: 'bottling', reference_id: bottling.id,
        notes: `Bottling ${blgNumber}`,
      });
      // Consume bottles + add siap_labeling outputs
      for (const o of outputs) {
        const btl = bottleInfo(o.bottle_item_id);
        await recordStockMovement({
          item_type: 'material', item_id: btl.id, item_name: btl.name, item_code: btl.code || '',
          inventory_status: '',
          quantity_out: o.bottle_count, unit: btl.unit || 'unit',
          transaction_type: 'bottling_bottle_consumption', transaction_number: blgNumber,
          reference_type: 'bottling', reference_id: bottling.id,
          notes: `Konsumsi botol ${blgNumber} (${o.bottle_count} pcs)`,
        });
        await recordStockMovement({
          item_type: 'product', item_id: o.product_id, item_name: o.product_name, item_code: products.find(p => p.id === o.product_id)?.code || '',
          batch_id: batch.id, batch_number: batch.batch_number,
          inventory_status: 'READY_FOR_LABELING',
          quantity_in: o.bottle_count, unit: 'unit',
          transaction_type: 'bottling_output', transaction_number: blgNumber,
          reference_type: 'bottling', reference_id: bottling.id,
          notes: `Bottling output ${o.bottle_count}×${o.volume_per_bottle}ml`,
        });
      }
      await base44.entities.ProductionOrder.update(batch.id, { status: 'dibatalkan' });
      await createAuditLog({ module: 'Bottling', action: 'Simpan', entity_type: 'BottlingOrder', entity_id: bottling.id, reference_number: blgNumber });
      toast({ title: 'Bottling berhasil disimpan', description: blgNumber });
      setModalOpen(false); loadData();
    } catch (e) { toast({ variant: 'destructive', title: 'Gagal menyimpan', description: e.message }); }
    finally { setSubmitting(false); }
  };

  const exportBottlingPDF = async (row) => {
    try {
      const outs = await base44.entities.BottlingOutput.filter({ bottling_id: row.id });
      exportDocumentToPDF({
        title: 'Work Order Bottling',
        docNumber: row.bottling_number, docDate: row.bottling_date,
        partyLabel: 'No. Batch', party: { name: row.batch_number },
        infoLines: [
          { label: 'Bulk Diproses', value: `${row.total_bulk_processed || 0} ml` },
          { label: 'Total Output', value: `${row.total_output || 0} ml` },
          { label: 'Waste', value: `${row.waste || 0} ml` },
          { label: 'Operator', value: row.operator || '-' },
          { label: 'Status', value: row.status },
        ],
        itemColumns: [
          { key: 'no', header: '#', width: 24, align: 'right' },
          { key: 'product_name', header: 'Produk' },
          { key: 'bottle_item_name', header: 'Botol', width: 130 },
          { key: 'bottle_count', header: 'Jumlah', width: 60, align: 'right' },
          { key: 'volume_per_bottle', header: 'ml/Botol', width: 70, align: 'right' },
          { key: 'total_volume', header: 'Total (ml)', width: 70, align: 'right' },
        ],
        itemRows: outs.map((o, i) => ({ no: i + 1, product_name: o.product_name, bottle_item_name: o.bottle_item_name || '-', bottle_count: o.bottle_count, volume_per_bottle: o.volume_per_bottle, total_volume: o.total_volume })),
        totals: [{ label: 'Total Output (ml)', value: row.total_output || 0, bold: true }],
        notes: row.notes,
        signatures: [{ label: 'Operator,', name: row.operator || '' }],
        fileName: `bottling-${row.bottling_number}.pdf`,
      });
    } catch { toast({ variant: 'destructive', title: 'Gagal membuat PDF' }); }
  };

  const columns = [
    { key: 'bottling_number', header: 'No. Bottling', sortable: true, className: 'font-mono font-medium' },
    { key: 'batch_number', header: 'No. Batch', className: 'font-mono' },
    { key: 'bottling_date', header: 'Tanggal', sortable: true },
    { key: 'total_bulk_processed', header: 'Bulk Diproses', render: (row) => `${row.total_bulk_processed} ml` },
    { key: 'total_output', header: 'Total Output', render: (row) => `${row.total_output} ml` },
    { key: 'waste', header: 'Waste', render: (row) => `${row.waste} ml` },
    { key: 'remaining_bulk', header: 'Sisa', render: (row) => `${row.remaining_bulk} ml` },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    { key: 'actions', header: '', width: '56px', render: (row) => <PdfButton onExport={() => exportBottlingPDF(row)} perm="bottling" iconOnly label="Cetak Work Order" /> },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader title="Bottling" description="Bottling batch siap bottling — konsumsi botol dari stok per ukuran"
        actions={<Button onClick={openAdd} size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> Bottling Baru</Button>} />
      <DataTable columns={columns} data={data} loading={loading} emptyMessage="Belum ada bottling" searchKeys={['bottling_number', 'batch_number']} searchPlaceholder="Cari bottling..." />

      <FormModal open={modalOpen} onClose={() => setModalOpen(false)} title="Bottling Baru" onSubmit={handleSubmit} submitting={submitting} submitLabel="Simpan Bottling" size="lg">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[12.5px] mb-1">Batch Produksi (Siap Bottling) *</Label>
            <Select value={form.production_id} onValueChange={v => setForm({ ...form, production_id: v })}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Pilih batch" /></SelectTrigger>
              <SelectContent>{batches.map(b => <SelectItem key={b.id} value={b.id}>{b.batch_number} · {b.product_name} ({b.actual_volume} ml)</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-[12.5px] mb-1">Tanggal</Label><Input type="date" value={form.bottling_date} onChange={e => setForm({ ...form, bottling_date: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Operator *</Label><Input value={form.operator} onChange={e => setForm({ ...form, operator: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Sisa Bulk (ml)</Label><NumberInput value={form.remaining_bulk} onChange={v => setForm({ ...form, remaining_bulk: v })} allowDecimal min={0} maxDecimals={2} className="h-9 text-[13px]" /></div>
        </div>

        {selectedBatch && (
          <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 text-[11.5px] text-blue-700">
            Bulk tersedia: <b>{totalBulk} ml</b> · Total output: <b>{totalOutput} ml</b> · Waste: <b>{waste} ml</b>
          </div>
        )}

        <div className="border-t pt-3">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-[12.5px] font-semibold">Output Bottling</Label>
            <Button type="button" onClick={addOutput} size="sm" variant="outline" className="h-7 text-[12px] gap-1"><Plus className="w-3.5 h-3.5" /> Tambah Output</Button>
          </div>
          <div className="space-y-2">
            {form.outputs.map((o, idx) => {
              const btl = bottleInfo(o.bottle_item_id);
              const stock = o.bottle_item_id ? (materialStocks[o.bottle_item_id] || 0) : 0;
              const need = Number(o.bottle_count) || 0;
              const insufficient = o.bottle_item_id && stock < need;
              const opts = bottleOptions(o.volume_per_bottle);
              return (
                <div key={idx} className="border border-border rounded-lg p-2.5 space-y-2 bg-muted/10">
                  <div className="flex items-center justify-between">
                    <span className="text-[10.5px] font-semibold text-muted-foreground">OUTPUT {idx + 1}</span>
                    {form.outputs.length > 1 && <button type="button" onClick={() => removeOutput(idx)} className="p-1 hover:bg-red-50 rounded text-red-500"><X className="w-3.5 h-3.5" /></button>}
                  </div>
                  <div>
                    <Label className="text-[11.5px] mb-1">Produk *</Label>
                    <Select value={o.product_id} onValueChange={v => updateOutput(idx, { product_id: v })}>
                      <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Pilih produk" /></SelectTrigger>
                      <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-[11.5px] mb-1">Ukuran Botol (ml) *</Label><NumberInput value={o.volume_per_bottle} onChange={v => updateOutput(idx, { volume_per_bottle: v, bottle_item_id: '' })} allowDecimal min={0} maxDecimals={1} className="h-9 text-[13px]" /></div>
                    <div><Label className="text-[11.5px] mb-1">Jumlah Botol *</Label><NumberInput value={o.bottle_count} onChange={v => updateOutput(idx, { bottle_count: v })} allowDecimal={false} min={0} className="h-9 text-[13px]" /></div>
                  </div>
                  <div>
                    <Label className="text-[11.5px] mb-1">Item Botol *</Label>
                    <SearchableSelect value={o.bottle_item_id} onValueChange={v => updateOutput(idx, { bottle_item_id: v })} placeholder={o.volume_per_bottle ? `Cari botol ${o.volume_per_bottle} ml` : 'Pilih ukuran dulu'} options={opts} />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div><Label className="text-[11.5px] mb-1">Warna</Label><div className="h-9 flex items-center text-[13px] text-muted-foreground truncate">{btl?.color || '—'}</div></div>
                    <div><Label className="text-[11.5px] mb-1">Model</Label><div className="h-9 flex items-center text-[13px] text-muted-foreground truncate">{btl?.model || '—'}</div></div>
                    <div><Label className="text-[11.5px] mb-1">Stok Botol</Label><div className={`h-9 flex items-center text-[13px] tabular-nums ${insufficient ? 'text-red-500 font-medium' : 'text-muted-foreground'}`}>{o.bottle_item_id ? `${stock} pcs` : '—'}</div></div>
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