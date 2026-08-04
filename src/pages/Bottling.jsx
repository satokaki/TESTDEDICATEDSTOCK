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
import { Plus, Play, X } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { generateOrderNumber } from '@/lib/sequence';
import { recordStockMovement, createAuditLog } from '@/lib/stockUtils';
import NumberInput from '@/components/NumberInput';
import PdfButton from '@/components/PdfButton';
import { exportDocumentToPDF } from '@/lib/pdfExport';

export default function Bottling() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [batches, setBatches] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ production_id: '', bottling_date: new Date().toISOString().slice(0, 10), operator: '', notes: '', outputs: [{ product_id: '', bottle_count: 0, volume_per_bottle: 0 }] });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [items, prods, allProducts] = await Promise.all([
        base44.entities.BottlingOrder.list('-created_date', 100),
        base44.entities.ProductionOrder.filter({ status: 'siap_bottling' }),
        base44.entities.Product.filter({ is_active: true }),
      ]);
      setData(items);
      setBatches(prods);
      setProducts(allProducts);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat data' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const selectedBatch = batches.find(b => b.id === form.production_id);
  const totalOutput = form.outputs.reduce((sum, o) => sum + (Number(o.bottle_count) * Number(o.volume_per_bottle)), 0);
  const totalBulk = Number(selectedBatch?.actual_volume || 0);
  const waste = Math.max(0, totalBulk - totalOutput - (form.remaining_bulk || 0));

  const openAdd = () => {
    setForm({ production_id: '', bottling_date: new Date().toISOString().slice(0, 10), operator: '', notes: '', outputs: [{ product_id: '', bottle_count: 0, volume_per_bottle: 0 }], remaining_bulk: 0 });
    setModalOpen(true);
  };

  const addOutput = () => setForm(f => ({ ...f, outputs: [...f.outputs, { product_id: '', bottle_count: 0, volume_per_bottle: 0 }] }));
  const updateOutput = (idx, field, value) => setForm(f => { const o = [...f.outputs]; o[idx] = { ...o[idx], [field]: value }; return { ...f, outputs: o }; });
  const removeOutput = (idx) => setForm(f => ({ ...f, outputs: f.outputs.filter((_, i) => i !== idx) }));

  const handleSubmit = async () => {
    if (!form.production_id || !form.operator) { toast({ variant: 'destructive', title: 'Batch dan operator wajib diisi' }); return; }
    if (form.outputs.length === 0 || form.outputs.some(o => !o.product_id || o.bottle_count <= 0)) { toast({ variant: 'destructive', title: 'Output belum lengkap' }); return; }
    const remainingBulk = Number(form.remaining_bulk || 0);
    const calculatedWaste = totalBulk - totalOutput - remainingBulk;
    if (calculatedWaste < 0) { toast({ variant: 'destructive', title: 'Total output melebihi bulk tersedia' }); return; }
    setSubmitting(true);
    try {
      const batch = selectedBatch;
      const blgNumber = await generateOrderNumber('BLG', 'BottlingOrder');
      const bottling = await base44.entities.BottlingOrder.create({
        bottling_number: blgNumber,
        production_id: batch.id, batch_number: batch.batch_number,
        bottling_date: form.bottling_date, operator: form.operator,
        total_bulk_processed: totalBulk, total_output: totalOutput,
        waste: calculatedWaste, remaining_bulk: remainingBulk,
        status: 'siap_labeling', notes: form.notes,
      });
      // Create outputs
      const outputs = form.outputs.map(o => {
        const prod = products.find(p => p.id === o.product_id);
        return {
          bottling_id: bottling.id, product_id: o.product_id, product_name: prod?.name || '',
          bottle_size: Number(o.volume_per_bottle), bottle_count: Number(o.bottle_count),
          volume_per_bottle: Number(o.volume_per_bottle), total_volume: Number(o.bottle_count) * Number(o.volume_per_bottle),
          output_status: 'siap_labeling',
        };
      });
      await base44.entities.BottlingOutput.bulkCreate(outputs);
      // Stock: reduce bulk, add siap_labeling items
      await recordStockMovement({
        item_type: 'product', item_id: batch.product_id || batch.id, item_name: `Bulk ${batch.product_name || batch.batch_number}`, item_code: batch.batch_number,
        batch_id: batch.id, batch_number: batch.batch_number,
        quantity_out: totalBulk, unit: 'ml',
        transaction_type: 'bottling_consumption', transaction_number: blgNumber,
        reference_type: 'bottling', reference_id: bottling.id,
        notes: `Bottling ${blgNumber}`,
      });
      for (const o of outputs) {
        const prod = products.find(p => p.id === o.product_id);
        await recordStockMovement({
          item_type: 'product', item_id: o.product_id, item_name: o.product_name, item_code: prod?.code || '',
          batch_id: batch.id, batch_number: batch.batch_number,
          quantity_in: o.bottle_count, unit: 'unit',
          transaction_type: 'bottling_output', transaction_number: blgNumber,
          reference_type: 'bottling', reference_id: bottling.id,
          notes: `Bottling output ${o.bottle_count}×${o.volume_per_bottle}ml`,
        });
      }
      await base44.entities.ProductionOrder.update(batch.id, { status: 'dibatalkan' }); // batch consumed
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
          { key: 'bottle_count', header: 'Jumlah', width: 70, align: 'right' },
          { key: 'volume_per_bottle', header: 'ml/Botol', width: 80, align: 'right' },
          { key: 'total_volume', header: 'Total (ml)', width: 80, align: 'right' },
        ],
        itemRows: outs.map((o, i) => ({ no: i + 1, product_name: o.product_name, bottle_count: o.bottle_count, volume_per_bottle: o.volume_per_bottle, total_volume: o.total_volume })),
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
      <PageHeader title="Bottling" description="Bottling batch siap bottling dengan multi-output"
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
          <div className="space-y-1.5">
            {form.outputs.map((o, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_90px_100px_30px] gap-1.5 items-center">
                <Select value={o.product_id} onValueChange={v => updateOutput(idx, 'product_id', v)}>
                  <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Pilih produk" /></SelectTrigger>
                  <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
                <NumberInput placeholder="Jumlah" value={o.bottle_count} onChange={v => updateOutput(idx, 'bottle_count', v)} allowDecimal={false} min={0} className="h-8 text-[12px]" />
                <NumberInput placeholder="ml/botol" value={o.volume_per_bottle} onChange={v => updateOutput(idx, 'volume_per_bottle', v)} allowDecimal min={0} maxDecimals={1} className="h-8 text-[12px]" />
                <button type="button" onClick={() => removeOutput(idx)} className="p-1 hover:bg-red-50 rounded text-red-500"><X className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        </div>
        <div><Label className="text-[12.5px] mb-1">Catatan</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="text-[13px]" /></div>
      </FormModal>
    </div>
  );
}