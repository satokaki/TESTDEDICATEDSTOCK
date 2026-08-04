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
import { Plus, Pencil, Play, CheckCircle, AlertTriangle, X } from 'lucide-react';
import { calculateRecipe } from '@/lib/recipeCalculator';
import { calculatePremixQuantities } from '@/lib/premix';
import { generateProductionNumber, generateBatchNumber } from '@/lib/sequence';
import { recordStockMovement, getStockBalance, createAuditLog } from '@/lib/stockUtils';
import NumberInput from '@/components/NumberInput';
import PdfButton from '@/components/PdfButton';
import { exportDocumentToPDF } from '@/lib/pdfExport';

export default function Production() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [productionMaterials, setProductionMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [calcItems, setCalcItems] = useState([]);
  const [stockCheck, setStockCheck] = useState([]);
  const [actualGrams, setActualGrams] = useState({});
  const [form, setForm] = useState({ recipe_id: '', target_volume: 1000, production_date: new Date().toISOString().slice(0, 10), operator: '', notes: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const items = await base44.entities.ProductionOrder.list('-created_date', 100);
      setData(items);
      const approved = await base44.entities.Recipe.filter({ status: 'approved' });
      setRecipes(approved);
      const mats = await base44.entities.Material.filter({ is_active: true });
      setMaterials(mats);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat data' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const calculateMaterials = useCallback(async (recipeId, targetValue) => {
    if (!recipeId || !targetValue) return;
    const recipe = recipes.find(r => r.id === recipeId);
    if (!recipe) return;
    const ingredients = await base44.entities.RecipeIngredient.filter({ recipe_id: recipeId });
    const matsById = Object.fromEntries(materials.map(m => [m.id, m]));
    const isPremix = recipe.recipe_type === 'PREMIX';
    const basis = recipe.calculation_basis || 'W_W';
    const targetQty = Number(targetValue);

    let items = [];
    if (isPremix) {
      // Premix engine: gram = target × persentase / 100 (W/W). Tidak ada penyeimbangan PG/VG.
      const calc = calculatePremixQuantities({ ingredients, targetQuantity: targetQty, basis, materialsById: matsById });
      items = calc.map(c => ({
        material_id: c.material_id,
        material_name: c.material_name,
        material_type: c.material_type,
        percentage: Number(c.percentage || 0),
        volumeMl: Number(c.ml || 0),
        gram: Number(c.gram || 0),
      }));
    } else {
      const result = calculateRecipe({
        ingredients: ingredients.map(i => ({ ...i })),
        targetVolume: targetQty,
        targetNicotine: recipe.target_nicotine,
        targetPG: recipe.target_pg,
        targetVG: recipe.target_vg,
        nicotineBaseStrength: ingredients.find(i => i.material_type === 'nicotine')?.nicotine_strength || 100,
      });
      items = result.items;
    }

    // Stock check — kebutuhan selalu dalam gram; konversi stok ml→gram via density bila perlu
    const stockChecks = await Promise.all(items.map(async (item) => {
      const mat = materials.find(m => m.id === item.material_id);
      const stockRaw = await getStockBalance(item.material_id, 'material');
      const density = mat?.density || mat?.default_density || 0;
      const matUnit = mat?.unit || 'gram';
      const requiredGram = Number(item.gram || 0);
      let stockGram = stockRaw;
      if (isPremix && matUnit === 'mililiter' && density > 0) {
        stockGram = stockRaw * density;
      }
      return {
        ...item,
        material_name: mat?.name || item.material_name,
        material_id: item.material_id,
        stockAvailable: stockGram,
        stockAvailableRaw: stockRaw,
        stockUnit: matUnit,
        stockSufficient: stockGram >= requiredGram,
        requiredGram,
        requiredMl: item.volumeMl || 0,
      };
    }));
    setCalcItems(stockChecks);
    setStockCheck(stockChecks);
  }, [recipes, materials]);

  useEffect(() => {
    if (form.recipe_id && form.target_volume) {
      calculateMaterials(form.recipe_id, form.target_volume);
    }
  }, [form.recipe_id, form.target_volume, calculateMaterials]);

  const openAdd = () => {
    setEditing(null);
    setForm({ recipe_id: '', target_volume: 1000, production_date: new Date().toISOString().slice(0, 10), operator: '', notes: '' });
    setCalcItems([]);
    setStockCheck([]);
    setModalOpen(true);
  };

  const openDetail = async (item) => {
    setEditing(item);
    const mats = await base44.entities.ProductionMaterial.filter({ production_id: item.id });
    setProductionMaterials(mats);
    const ag = {};
    mats.forEach(m => ag[m.material_id] = m.actual_gram || '');
    setActualGrams(ag);
    setDetailOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.recipe_id || !form.target_volume || !form.operator) { toast({ variant: 'destructive', title: 'Resep, volume, dan operator wajib diisi' }); return; }
    const recipe = recipes.find(r => r.id === form.recipe_id);
    // Bug 4 — validasi total komposisi 100% untuk premix
    if (recipe?.recipe_type === 'PREMIX') {
      const totalPct = stockCheck.reduce((s, i) => s + Number(i.percentage || 0), 0);
      if (Math.abs(totalPct - 100) > 0.1) {
        toast({ variant: 'destructive', title: 'Komposisi Recipe tidak valid', description: 'Total bahan harus 100%.' });
        return;
      }
    }
    const insufficient = stockCheck.filter(s => !s.stockSufficient);
    if (insufficient.length > 0) {
      toast({ variant: 'destructive', title: 'Stok tidak mencukupi', description: insufficient.map(s => `${s.material_name}: butuh ${s.requiredGram.toFixed(1)}g, tersedia ${s.stockAvailable.toFixed(1)}g`).join(', ') });
      return;
    }
    setSubmitting(true);
    try {
      const prdNumber = await generateProductionNumber();
      const batchNumber = await generateBatchNumber(recipe?.brand_name?.substring(0, 3) || 'GEN');
      const isPremix = recipe.recipe_type === 'PREMIX';
      const outputMaterial = isPremix ? materials.find(m => m.id === recipe.output_material_id) : null;
      const production = await base44.entities.ProductionOrder.create({
        production_number: prdNumber,
        batch_number: batchNumber,
        production_date: form.production_date,
        recipe_id: recipe.id, recipe_code: recipe.code, recipe_version: recipe.version,
        recipe_type: recipe.recipe_type || 'FINISHED_PRODUCT',
        production_type: recipe.recipe_type || 'FINISHED_PRODUCT',
        calculation_basis: recipe.calculation_basis || 'W_W',
        product_id: recipe.product_id || '', product_name: recipe.product_name || '',
        output_material_id: isPremix ? (recipe.output_material_id || '') : '',
        output_material_name: outputMaterial?.name || recipe.output_material_name || '',
        brand_id: recipe.brand_id, brand_name: recipe.brand_name,
        target_volume: isPremix ? 0 : Number(form.target_volume),
        target_quantity: isPremix ? Number(form.target_volume) : 0,
        target_unit: isPremix ? (recipe.calculation_basis === 'W_W' ? 'gram' : 'mililiter') : 'mililiter',
        actual_volume: 0,
        operator: form.operator, approver: '',
        status: 'siap_produksi',
        recipe_snapshot: JSON.stringify(recipe),
        notes: form.notes,
      });
      await base44.entities.ProductionMaterial.bulkCreate(calcItems.map(item => ({
        production_id: production.id,
        material_id: item.material_id, material_name: item.material_name, material_type: item.material_type,
        percentage: item.percentage, required_ml: item.volumeMl, required_gram: item.gram,
        actual_gram: 0, deviation_gram: 0, deviation_percent: 0,
        stock_available: item.stockAvailable, stock_sufficient: item.stockSufficient,
      })));
      await createAuditLog({ module: 'Produksi', action: 'Tambah', entity_type: 'ProductionOrder', entity_id: production.id, reference_number: prdNumber });
      toast({ title: 'Produksi dibuat', description: `${prdNumber} · ${batchNumber}` });
      setModalOpen(false); loadData();
    } catch (e) { toast({ variant: 'destructive', title: 'Gagal menyimpan', description: e.message }); }
    finally { setSubmitting(false); }
  };

  const handlePost = async () => {
    if (!editing) return;
    // Idempotency: a production order can only be posted from siap_produksi /
    // sedang_diproses. Once posted (siap_bottling) it must never mutate stock again.
    if (!['siap_produksi', 'sedang_diproses'].includes(editing.status)) {
      toast({ variant: 'destructive', title: 'Produksi sudah diposting', description: 'Transaksi tidak dapat diposting dua kali.' });
      return;
    }
    const allFilled = stockCheck.length > 0; // use detail materials instead
    const mats = await base44.entities.ProductionMaterial.filter({ production_id: editing.id });
    // Check actual grams entered
    const missing = mats.filter(m => !actualGrams[m.material_id] || actualGrams[m.material_id] === '');
    if (missing.length > 0) {
      toast({ variant: 'destructive', title: 'Gram aktual belum lengkap', description: `${missing.length} bahan belum ditimbang` });
      return;
    }
    setSubmitting(true);
    try {
      // Reduce material stock + record ledger
      for (const m of mats) {
        const actual = Number(actualGrams[m.material_id]);
        const dev = actual - m.required_gram;
        const devPct = m.required_gram > 0 ? (dev / m.required_gram) * 100 : 0;
        await base44.entities.ProductionMaterial.update(m.id, { actual_gram: actual, deviation_gram: dev, deviation_percent: devPct });
        const mat = materials.find(x => x.id === m.material_id);
        await recordStockMovement({
          item_type: 'material', item_id: m.material_id, item_name: m.material_name, item_code: mat?.code || '',
          quantity_out: actual, unit: 'gram',
          transaction_type: 'production_consumption', transaction_number: editing.production_number,
          reference_type: 'production', reference_id: editing.id,
          notes: `Produksi ${editing.batch_number}`,
        });
      }
      // Create bulk output (production_output)
      const totalActualGram = mats.reduce((s, m) => s + Number(actualGrams[m.material_id]), 0);
      const actualVolume = (totalActualGram / 1.18).toFixed(0); // approximate bulk density
      await recordStockMovement({
        item_type: 'product', item_id: editing.product_id || editing.recipe_id, item_name: `Bulk ${editing.product_name || editing.recipe_code}`, item_code: editing.batch_number,
        batch_id: editing.id, batch_number: editing.batch_number,
        inventory_status: 'BULK',
        quantity_in: Number(actualVolume), unit: 'ml',
        transaction_type: 'production_output', transaction_number: editing.production_number,
        reference_type: 'production', reference_id: editing.id,
        notes: `Hasil mixing ${editing.batch_number}`,
      });
      await base44.entities.ProductionOrder.update(editing.id, { status: 'siap_bottling', actual_volume: Number(actualVolume) });
      await createAuditLog({ module: 'Produksi', action: 'Posting', entity_type: 'ProductionOrder', entity_id: editing.id, reference_number: editing.production_number });
      toast({ title: 'Produksi berhasil diposting', description: 'Stok bahan dikurangi, bulk masuk' });
      setDetailOpen(false); loadData();
    } catch (e) { toast({ variant: 'destructive', title: 'Gagal posting', description: e.message }); }
    finally { setSubmitting(false); }
  };

  const handleCancel = async (item) => {
    if (!confirm(`Batalkan produksi "${item.production_number}"?`)) return;
    try {
      await base44.entities.ProductionOrder.update(item.id, { status: 'dibatalkan' });
      await createAuditLog({ module: 'Produksi', action: 'Batal', entity_type: 'ProductionOrder', entity_id: item.id, reference_number: item.production_number });
      toast({ title: 'Produksi dibatalkan' });
      loadData();
    } catch { toast({ variant: 'destructive', title: 'Gagal' }); }
  };

  const exportProductionPDF = async (row) => {
    try {
      const mats = await base44.entities.ProductionMaterial.filter({ production_id: row.id });
      exportDocumentToPDF({
        title: row.production_type === 'PREMIX' ? 'Work Order Premix' : 'Work Order Produksi',
        docNumber: row.production_number, docDate: row.production_date,
        partyLabel: 'No. Batch', party: { name: row.batch_number },
        infoLines: [
          { label: 'Produk', value: row.product_name || row.output_material_name || '-' },
          { label: 'Merk', value: row.brand_name || '-' },
          { label: 'Target', value: row.production_type === 'PREMIX' ? `${row.target_quantity || 0} ${row.target_unit || 'gram'}` : `${row.target_volume || 0} ml` },
          { label: 'Operator', value: row.operator || '-' },
          { label: 'Status', value: row.status },
        ],
        itemColumns: [
          { key: 'no', header: '#', width: 24, align: 'right' },
          { key: 'material_name', header: 'Bahan' },
          { key: 'required_gram', header: 'Standar (g)', width: 85, align: 'right' },
          { key: 'actual_gram', header: 'Aktual (g)', width: 85, align: 'right' },
          { key: 'deviation_gram', header: 'Selisih', width: 75, align: 'right' },
        ],
        itemRows: mats.map((m, i) => ({ no: i + 1, material_name: m.material_name, required_gram: (m.required_gram || 0).toFixed(2), actual_gram: (m.actual_gram || 0).toFixed(2), deviation_gram: (m.deviation_gram || 0).toFixed(2) })),
        totals: [
          { label: 'Total Standar (g)', value: mats.reduce((s, m) => s + (m.required_gram || 0), 0).toFixed(2) },
          { label: 'Total Aktual (g)', value: mats.reduce((s, m) => s + (m.actual_gram || 0), 0).toFixed(2), bold: true },
        ],
        notes: row.notes,
        signatures: [{ label: 'Operator,', name: row.operator || '' }, { label: 'Disetujui,', name: row.approver || '' }],
        fileName: `wo-${row.production_number}.pdf`,
      });
    } catch { toast({ variant: 'destructive', title: 'Gagal membuat PDF' }); }
  };

  const columns = [
    { key: 'production_number', header: 'No. Produksi', sortable: true, className: 'font-mono font-medium' },
    { key: 'batch_number', header: 'No. Batch', className: 'font-mono' },
    { key: 'product_name', header: 'Produk', render: (row) => row.product_name || '—' },
    { key: 'brand_name', header: 'Merk', render: (row) => row.brand_name || '—' },
    { key: 'target', header: 'Target', render: (row) => row.production_type === 'PREMIX' ? `${row.target_quantity || 0} ${row.target_unit || 'gram'}` : `${row.target_volume || 0} ml` },
    { key: 'operator', header: 'Operator', render: (row) => row.operator || '—' },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'actions', header: '', width: '100px',
      render: (row) => (
        <div className="flex items-center gap-1">
          <PdfButton onExport={() => exportProductionPDF(row)} perm="production" iconOnly label="Cetak Work Order" />
          {row.status === 'siap_produksi' && (
            <button onClick={() => openDetail(row)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600" title="Proses"><Play className="w-3.5 h-3.5" /></button>
          )}
          {row.status === 'sedang_diproses' && (
            <button onClick={() => openDetail(row)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600" title="Selesaikan"><CheckCircle className="w-3.5 h-3.5" /></button>
          )}
          {row.status === 'siap_bottling' && (
            <span className="p-1.5 text-violet-500" title="Siap bottling"><CheckCircle className="w-3.5 h-3.5" /></span>
          )}
          {!['dibatalkan', 'siap_bottling'].includes(row.status) && (
            <button onClick={() => handleCancel(row)} className="p-1.5 hover:bg-red-50 rounded text-red-500" title="Batalkan"><X className="w-3.5 h-3.5" /></button>
          )}
        </div>
      )
    },
  ];

  const selectedRecipe = recipes.find(r => r.id === form.recipe_id);
  const isPremix = selectedRecipe?.recipe_type === 'PREMIX';
  const basis = selectedRecipe?.calculation_basis || 'W_W';
  const targetUnit = isPremix ? (basis === 'W_W' ? 'Gram' : 'ml') : 'ml';
  const targetLabel = isPremix ? `Target Produksi (${targetUnit}) *` : 'Target Volume (ml) *';
  const totalFormulaPct = stockCheck.reduce((s, i) => s + Number(i.percentage || 0), 0);
  const totalRequirement = stockCheck.reduce((s, i) => s + Number(i.gram || 0), 0);

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader title="Produksi" description="Buat batch produksi dari resep approved"
        actions={<Button onClick={openAdd} size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> Produksi Baru</Button>} />
      <DataTable columns={columns} data={data} loading={loading} emptyMessage="Belum ada produksi" searchKeys={['production_number', 'batch_number', 'product_name', 'brand_name']} searchPlaceholder="Cari produksi..." />

      {/* Create Modal */}
      <FormModal open={modalOpen} onClose={() => setModalOpen(false)} title="Produksi Baru" onSubmit={handleSubmit} submitting={submitting} submitLabel="Buat Produksi" size="lg">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-[12.5px] mb-1">Resep (Approved) *</Label>
            <Select value={form.recipe_id} onValueChange={v => setForm({ ...form, recipe_id: v })}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Pilih resep approved" /></SelectTrigger>
              <SelectContent>{recipes.map(r => <SelectItem key={r.id} value={r.id}>{r.code} · {r.name} (v{r.version})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-[12.5px] mb-1">{targetLabel}</Label><NumberInput value={form.target_volume} onChange={v => setForm({ ...form, target_volume: v })} allowDecimal min={0} maxDecimals={2} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Tanggal Produksi</Label><Input type="date" value={form.production_date} onChange={e => setForm({ ...form, production_date: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Operator *</Label><Input value={form.operator} onChange={e => setForm({ ...form, operator: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Catatan</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="h-9 text-[13px]" /></div>
        </div>

        {/* Production Preview (Bug 6) */}
        {selectedRecipe && stockCheck.length > 0 && (
          <div className="border-t pt-3 mt-2">
            <Label className="text-[12.5px] font-semibold mb-2 block">Ringkasan Produksi</Label>
            <div className="grid grid-cols-3 gap-2 text-[11.5px]">
              <div className="bg-muted/40 rounded px-2 py-1.5">Recipe Type: <b>{isPremix ? 'PREMIX' : 'FINISHED_PRODUCT'}</b></div>
              <div className="bg-muted/40 rounded px-2 py-1.5">Calculation Basis: <b>{isPremix ? basis : '—'}</b></div>
              <div className="bg-muted/40 rounded px-2 py-1.5">Target Produksi: <b>{Number(form.target_volume || 0).toLocaleString('id-ID')} {targetUnit}</b></div>
              <div className="bg-muted/40 rounded px-2 py-1.5">Satuan: <b>{isPremix ? (basis === 'W_W' ? 'Gram' : 'ml') : 'ml'}</b></div>
              <div className="bg-muted/40 rounded px-2 py-1.5">Total Formula: <b>{totalFormulaPct.toFixed(2)}%</b></div>
              <div className="bg-muted/40 rounded px-2 py-1.5">Total Kebutuhan: <b>{totalRequirement.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} gram</b></div>
            </div>
          </div>
        )}

        {/* Stock Check */}
        {stockCheck.length > 0 && (
          <div className="border-t pt-3 mt-2">
            <Label className="text-[12.5px] font-semibold mb-2 block">Pemeriksaan Stok Bahan</Label>
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px]">
                <thead><tr className="bg-muted/40 text-muted-foreground">
                  <th className="px-2 py-1 text-left">Bahan</th>
                  <th className="px-2 py-1 text-right">Persentase</th>
                  <th className="px-2 py-1 text-right">Kebutuhan (ml)</th>
                  <th className="px-2 py-1 text-right">Kebutuhan (gram)</th>
                  <th className="px-2 py-1 text-right">Stok Tersedia{isPremix ? ' (gram)' : ''}</th>
                  <th className="px-2 py-1 text-center">Status</th>
                </tr></thead>
                <tbody>
                  {stockCheck.map((item, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="px-2 py-1">{item.material_name}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{item.percentage.toFixed(2)}%</td>
                      <td className="px-2 py-1 text-right tabular-nums">{item.volumeMl.toFixed(2)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{item.gram.toFixed(2)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{item.stockAvailable.toFixed(2)}</td>
                      <td className="px-2 py-1 text-center">
                        {item.stockSufficient
                          ? <span className="text-emerald-600 font-semibold">✓ Cukup</span>
                          : <span className="text-red-600 font-semibold flex items-center justify-center gap-0.5"><AlertTriangle className="w-3 h-3" /> Kurang</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </FormModal>

      {/* Detail / Actual Weighing Modal */}
      <FormModal open={detailOpen} onClose={() => setDetailOpen(false)} title={`Timbang Aktual · ${editing?.production_number || ''}`} onSubmit={handlePost} submitting={submitting} submitLabel="Posting Produksi" size="lg">
        <div className="text-[12px] text-muted-foreground mb-3">Batch: <b>{editing?.batch_number}</b> · Target: <b>{editing?.production_type === 'PREMIX' ? `${editing?.target_quantity || 0} ${editing?.target_unit || 'gram'}` : `${editing?.target_volume || 0} ml`}</b></div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11.5px]">
            <thead><tr className="bg-muted/40 text-muted-foreground">
              <th className="px-2 py-1 text-left">Bahan</th>
              <th className="px-2 py-1 text-right">Standar (gram)</th>
              <th className="px-2 py-1 text-right">Aktual (gram)</th>
              <th className="px-2 py-1 text-right">Selisih</th>
            </tr></thead>
            <tbody>
              {productionMaterials.map((m) => {
                const actual = Number(actualGrams[m.material_id] || 0);
                const dev = actual - m.required_gram;
                return (
                  <tr key={m.id} className="border-b border-border/30">
                    <td className="px-2 py-1">{m.material_name}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{m.required_gram?.toFixed(2)}</td>
                    <td className="px-2 py-1"><NumberInput value={actualGrams[m.material_id]} onChange={v => setActualGrams({ ...actualGrams, [m.material_id]: v })} allowDecimal min={0} maxDecimals={3} className="h-7 text-[11.5px] text-right" /></td>
                    <td className={`px-2 py-1 text-right tabular-nums ${dev > 0.1 ? 'text-amber-600' : dev < -0.1 ? 'text-red-600' : 'text-emerald-600'}`}>{dev.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-[11px] text-amber-700 mt-2">
          ⚠ Posting akan mengurangi stok bahan dan membuat output bulk. Proses tidak dapat diulang.
        </div>
      </FormModal>
    </div>
  );
}