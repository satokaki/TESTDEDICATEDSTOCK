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
import { Plus } from 'lucide-react';
import { generateOrderNumber } from '@/lib/sequence';
import { recordStockMovement, getAllStockBalances, createAuditLog } from '@/lib/stockUtils';
import { getInventoryDisplayName } from '@/lib/inventoryDisplay';

export default function Bottling() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [bulkStock, setBulkStock] = useState([]);
  const [products, setProducts] = useState([]);
  const [brands, setBrands] = useState([]);
  const [bottleMappings, setBottleMappings] = useState([]);
  const [bottleMaterials, setBottleMaterials] = useState([]);
  const [bottleStocks, setBottleStocks] = useState({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ stock_id: '', product_id: '', product_name: '', brand_id: '', brand_name: '', batch_id: '', batch_number: '', available_bulk: '', bottle_mapping_id: '', bottle_count: '', volume_per_bottle: '', bottling_date: new Date().toISOString().slice(0, 10), operator: '', notes: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [items, balances, prods, brs, maps, mats, matBal] = await Promise.all([
        base44.entities.BottlingOrder.list('-created_date', 100),
        getAllStockBalances('product'),
        base44.entities.Product.filter({ is_active: true }),
        base44.entities.Brand.filter({ is_active: true }),
        base44.entities.ProductComponentMapping.filter({ component_type: 'bottle', is_active: true }),
        base44.entities.Material.filter({ material_type: 'BOTTLE', is_active: true }),
        getAllStockBalances('material'),
      ]);
      setData(items);
      setBulkStock(balances.filter(b => b.inventory_status === 'BULK' && b.quantity > 0));
      setProducts(prods); setBrands(brs);
      setBottleMappings(maps); setBottleMaterials(mats);
      const sm = {}; matBal.forEach(b => { sm[b.item_id] = (sm[b.item_id] || 0) + (b.available_quantity || 0); });
      setBottleStocks(sm);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat data' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const openAdd = () => {
    setForm({ stock_id: '', product_id: '', product_name: '', brand_id: '', brand_name: '', batch_id: '', batch_number: '', available_bulk: '', bottle_mapping_id: '', bottle_count: '', volume_per_bottle: '', bottling_date: new Date().toISOString().slice(0, 10), operator: '', notes: '' });
    setModalOpen(true);
  };

  const bottleOptions = form.product_id ? bottleMappings.filter(m => m.product_id === form.product_id) : [];
  const totalVolume = (Number(form.bottle_count) || 0) * (Number(form.volume_per_bottle) || 0);

  const handleSubmit = async () => {
    if (!form.stock_id || !form.bottle_mapping_id || !form.bottle_count || !form.volume_per_bottle || !form.operator) {
      toast({ variant: 'destructive', title: 'Lengkapi: batch bulk, botol, jumlah botol, volume, operator' }); return;
    }
    if (totalVolume > Number(form.available_bulk)) {
      toast({ variant: 'destructive', title: 'Volume melebihi bulk tersedia', description: `Tersedia: ${form.available_bulk} ml` }); return;
    }
    const mapping = bottleMappings.find(m => m.id === form.bottle_mapping_id);
    const bottleStock = bottleStocks[mapping.material_id] || 0;
    if (Number(form.bottle_count) > bottleStock) {
      toast({ variant: 'destructive', title: 'Stok botol tidak cukup', description: `Tersedia: ${bottleStock}` }); return;
    }
    setSubmitting(true);
    try {
      const product = products.find(p => p.id === form.product_id);
      const bottleMat = bottleMaterials.find(m => m.id === mapping.material_id);
      const botNumber = await generateOrderNumber('BOT', 'BottlingOrder');
      const order = await base44.entities.BottlingOrder.create({
        bottling_number: botNumber, production_id: '', batch_number: form.batch_number,
        bottling_date: form.bottling_date, operator: form.operator,
        total_bulk_processed: totalVolume, total_output: totalVolume, waste: 0,
        remaining_bulk: Number(form.available_bulk) - totalVolume,
        status: 'siap_labeling', notes: form.notes,
      });
      await base44.entities.BottlingOutput.create({
        bottling_id: order.id, product_id: form.product_id, product_name: product?.name || form.product_name,
        bottle_size: Number(form.volume_per_bottle), bottle_count: Number(form.bottle_count),
        volume_per_bottle: Number(form.volume_per_bottle), total_volume: totalVolume,
        bottle_item_id: bottleMat.id, bottle_item_code: bottleMat.code || '', bottle_item_name: bottleMat.name,
        bottle_stock_used: Number(form.bottle_count), output_status: 'siap_labeling',
      });
      await recordStockMovement({
        item_type: 'product', item_id: form.product_id, item_name: product?.name || form.product_name, item_code: product?.code || '',
        batch_id: form.batch_id, batch_number: form.batch_number, inventory_status: 'BULK',
        quantity_out: totalVolume, unit: 'mililiter', transaction_type: 'bottling_consumption', transaction_number: botNumber,
        reference_type: 'bottling', reference_id: order.id, notes: `Bottling ${botNumber}`,
      });
      await recordStockMovement({
        item_type: 'material', item_id: bottleMat.id, item_name: bottleMat.name, item_code: bottleMat.code || '',
        inventory_status: '', quantity_out: Number(form.bottle_count), unit: bottleMat.unit || 'unit',
        transaction_type: 'bottling_bottle_consumption', transaction_number: botNumber,
        reference_type: 'bottling', reference_id: order.id, notes: `Botol untuk ${botNumber}`,
      });
      await recordStockMovement({
        item_type: 'product', item_id: form.product_id, item_name: product?.name || form.product_name, item_code: product?.code || '',
        batch_id: form.batch_id, batch_number: form.batch_number, inventory_status: 'READY_FOR_LABELING',
        quantity_in: Number(form.bottle_count), unit: 'unit',
        transaction_type: 'bottling_output', transaction_number: botNumber,
        reference_type: 'bottling', reference_id: order.id, notes: `Output bottling ${botNumber}`,
      });
      await createAuditLog({ module: 'Bottling', action: 'Selesai', entity_type: 'BottlingOrder', entity_id: order.id, reference_number: botNumber });
      toast({ title: 'Bottling selesai', description: botNumber });
      setModalOpen(false); loadData();
    } catch (e) { toast({ variant: 'destructive', title: 'Gagal menyimpan', description: e.message }); }
    finally { setSubmitting(false); }
  };

  const columns = [
    { key: 'bottling_number', header: 'No. Bottling', sortable: true, className: 'font-mono font-medium' },
    { key: 'bottling_date', header: 'Tanggal', sortable: true },
    { key: 'total_output', header: 'Output', render: r => <span className="tabular-nums">{r.total_output} ml</span> },
    { key: 'remaining_bulk', header: 'Sisa Bulk', render: r => <span className="tabular-nums">{r.remaining_bulk} ml</span> },
    { key: 'operator', header: 'Operator', render: r => r.operator || '—' },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader title="Bottling" description="Bottling bulk → botol (siap labeling). Botol dipilih dari mapping produk."
        actions={<Button onClick={openAdd} size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> Bottling Baru</Button>} />
      <DataTable columns={columns} data={data} loading={loading} emptyMessage="Belum ada bottling" searchKeys={['bottling_number', 'batch_number', 'operator']} searchPlaceholder="Cari bottling..." />

      <FormModal open={modalOpen} onClose={() => setModalOpen(false)} title="Bottling Baru" onSubmit={handleSubmit} submitting={submitting} submitLabel="Proses Bottling" size="lg">
        <div>
          <Label className="text-[12.5px] mb-1">Batch Bulk (Siap Bottling) *</Label>
          <Select value={form.stock_id} onValueChange={v => {
            const s = bulkStock.find(b => b.id === v);
            const p = products.find(p => p.id === s?.item_id);
            setForm({ ...form, stock_id: v, product_id: s?.item_id || '', product_name: p?.name || s?.item_name || '', brand_id: p?.brand_id || '', brand_name: p?.brand_name || '', batch_id: s?.batch_id || '', batch_number: s?.batch_number || '', available_bulk: s?.available_quantity || '', bottle_mapping_id: '' });
          }}>
            <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Pilih batch bulk" /></SelectTrigger>
            <SelectContent>
              {bulkStock.map(s => {
                const p = products.find(p => p.id === s.item_id);
                return <SelectItem key={s.id} value={s.id}>{getInventoryDisplayName(p?.name || s.item_name, 'BULK')} ({s.available_quantity} ml){s.batch_number ? ` · ${s.batch_number}` : ''}</SelectItem>;
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-[12.5px] mb-1">Produk</Label><Input value={form.product_name} disabled className="h-9 text-[13px] bg-muted/40" /></div>
          <div><Label className="text-[12.5px] mb-1">Merk</Label><Input value={form.brand_name} disabled className="h-9 text-[13px] bg-muted/40" /></div>
          <div><Label className="text-[12.5px] mb-1">Batch</Label><Input value={form.batch_number} disabled className="h-9 text-[13px] bg-muted/40" /></div>
          <div><Label className="text-[12.5px] mb-1">Bulk Tersedia (ml)</Label><Input value={form.available_bulk} disabled className="h-9 text-[13px] bg-muted/40" /></div>
        </div>
        <div>
          <Label className="text-[12.5px] mb-1">Botol (dari Mapping) *</Label>
          <Select value={form.bottle_mapping_id} onValueChange={v => setForm({ ...form, bottle_mapping_id: v })} disabled={!form.product_id}>
            <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder={form.product_id ? 'Pilih botol' : 'Pilih batch bulk dulu'} /></SelectTrigger>
            <SelectContent>
              {bottleOptions.map(m => {
                const mat = bottleMaterials.find(bm => bm.id === m.material_id);
                const stk = bottleStocks[m.material_id] || 0;
                return <SelectItem key={m.id} value={m.id}>{mat?.name || m.material_name} · Stok {stk} {mat?.unit || 'pcs'}{m.is_default ? ' ★' : ''}</SelectItem>;
              })}
            </SelectContent>
          </Select>
          {form.product_id && bottleOptions.length === 0 && <p className="text-[11px] text-amber-600 mt-1">Belum ada botol di mapping produk ini. Tambahkan via Master Produk.</p>}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><Label className="text-[12.5px] mb-1">Jumlah Botol *</Label><NumberInput value={form.bottle_count} onChange={v => setForm({ ...form, bottle_count: v })} allowDecimal={false} min={0} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Volume/Botol (ml) *</Label><NumberInput value={form.volume_per_bottle} onChange={v => setForm({ ...form, volume_per_bottle: v })} allowDecimal maxDecimals={1} min={0} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Total Volume (ml)</Label><Input value={totalVolume || ''} disabled className="h-9 text-[13px] bg-muted/40" /></div>
          <div><Label className="text-[12.5px] mb-1">Tanggal</Label><Input type="date" value={form.bottling_date} onChange={e => setForm({ ...form, bottling_date: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Operator *</Label><Input value={form.operator} onChange={e => setForm({ ...form, operator: e.target.value })} className="h-9 text-[13px]" /></div>
        </div>
        <div><Label className="text-[12.5px] mb-1">Catatan</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="text-[13px]" /></div>
      </FormModal>
    </div>
  );
}