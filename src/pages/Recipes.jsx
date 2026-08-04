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
import { Plus, Pencil, Copy, CheckCircle, Trash2, Calculator, X } from 'lucide-react';
import { calculateRecipe } from '@/lib/recipeCalculator';
import { createAuditLog } from '@/lib/stockUtils';
import { generateRecipeCode } from '@/lib/sequence';

export default function Recipes() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [brands, setBrands] = useState([]);
  const [products, setProducts] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [calcResult, setCalcResult] = useState(null);
  const [form, setForm] = useState({
    code: '', name: '', brand_id: '', product_id: '',
    target_volume: 1000, target_nicotine: 3, target_pg: 40, target_vg: 60,
    status: 'draft', notes: '',
    ingredients: [],
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [items, brs, prods, mats] = await Promise.all([
        base44.entities.Recipe.list('-created_date', 200),
        base44.entities.Brand.filter({ is_active: true }),
        base44.entities.Product.filter({ is_active: true }),
        base44.entities.Material.filter({ is_active: true }),
      ]);
      setData(items);
      setBrands(brs);
      setProducts(prods);
      setMaterials(mats);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat data' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  // Live calculation
  useEffect(() => {
    if (form.ingredients.length === 0 || !form.target_volume) { setCalcResult(null); return; }
    const result = calculateRecipe({
      ingredients: form.ingredients.map(i => ({
        ...i,
        density: i.density || materials.find(m => m.id === i.material_id)?.density || 1.0,
        pg_content: i.pg_content ?? materials.find(m => m.id === i.material_id)?.pg_content ?? 0,
        vg_content: i.vg_content ?? materials.find(m => m.id === i.material_id)?.vg_content ?? 0,
        nicotine_strength: i.nicotine_strength ?? materials.find(m => m.id === i.material_id)?.nicotine_strength ?? 0,
      })),
      targetVolume: Number(form.target_volume),
      targetNicotine: Number(form.target_nicotine),
      targetPG: Number(form.target_pg),
      targetVG: Number(form.target_vg),
      nicotineBaseStrength: form.ingredients.find(i => i.material_type === 'nicotine')?.nicotine_strength || 100,
    });
    setCalcResult(result);
  }, [form.ingredients, form.target_volume, form.target_nicotine, form.target_pg, form.target_vg, materials]);

  const openAdd = () => {
    setEditing(null);
    setForm({
      code: '', name: '', brand_id: '', product_id: '',
      target_volume: 1000, target_nicotine: 3, target_pg: 40, target_vg: 60,
      status: 'draft', notes: '', ingredients: [],
    });
    setCalcResult(null);
    setModalOpen(true);
  };

  const openEdit = async (item) => {
    setEditing(item);
    const ingredients = await base44.entities.RecipeIngredient.filter({ recipe_id: item.id });
    setForm({
      code: item.code, name: item.name, brand_id: item.brand_id || '', product_id: item.product_id || '',
      target_volume: item.target_volume || 1000, target_nicotine: item.target_nicotine || 3,
      target_pg: item.target_pg || 40, target_vg: item.target_vg || 60,
      status: item.status, notes: item.notes || '',
      ingredients: ingredients.map(i => ({ id: i.id, material_id: i.material_id, material_name: i.material_name, material_type: i.material_type, percentage: i.percentage, density: i.density, pg_content: i.pg_content, vg_content: i.vg_content, nicotine_strength: i.nicotine_strength, mix_order: i.mix_order, notes: i.notes })),
    });
    setModalOpen(true);
  };

  const addIngredient = () => {
    setForm(f => ({ ...f, ingredients: [...f.ingredients, { material_id: '', material_name: '', material_type: 'flavor', percentage: 0, density: 0, pg_content: 0, vg_content: 0, nicotine_strength: 0, mix_order: f.ingredients.length + 1 }] }));
  };

  const updateIngredient = (idx, field, value) => {
    setForm(f => {
      const ings = [...f.ingredients];
      if (field === 'material_id') {
        const mat = materials.find(m => m.id === value);
        ings[idx] = { ...ings[idx], material_id: value, material_name: mat?.name || '', material_type: mat?.material_category || 'flavor', density: mat?.density || 0, pg_content: mat?.pg_content || 0, vg_content: mat?.vg_content || 0, nicotine_strength: mat?.nicotine_strength || 0 };
      } else {
        ings[idx] = { ...ings[idx], [field]: field === 'percentage' || field === 'density' || field === 'mix_order' ? Number(value) : value };
      }
      return { ...f, ingredients: ings };
    });
  };

  const removeIngredient = (idx) => {
    setForm(f => ({ ...f, ingredients: f.ingredients.filter((_, i) => i !== idx) }));
  };

  const handleSubmit = async () => {
    if (!form.name || !form.brand_id) { toast({ variant: 'destructive', title: 'Nama dan merk wajib diisi' }); return; }
    if (form.ingredients.length === 0) { toast({ variant: 'destructive', title: 'Resep harus memiliki minimal 1 bahan' }); return; }
    if (calcResult && !calcResult.validation.valid) {
      toast({ variant: 'destructive', title: 'Resep tidak valid', description: calcResult.validation.errors[0] });
      return;
    }
    setSubmitting(true);
    try {
      const brand = brands.find(b => b.id === form.brand_id);
      const product = products.find(p => p.id === form.product_id);
      const totalFlavor = form.ingredients.filter(i => i.material_type === 'flavor').reduce((s, i) => s + Number(i.percentage), 0);
      let recipeCode = form.code;
      if (!editing) recipeCode = await generateRecipeCode();
      const payload = {
        code: recipeCode, name: form.name,
        brand_id: form.brand_id, brand_name: brand?.name || '',
        product_id: form.product_id, product_name: product?.name || '',
        version: editing?.version || 1,
        target_volume: Number(form.target_volume),
        target_nicotine: Number(form.target_nicotine),
        target_pg: Number(form.target_pg),
        target_vg: Number(form.target_vg),
        total_flavor: totalFlavor,
        status: form.status, notes: form.notes,
      };
      let recipeId;
      if (editing) {
        await base44.entities.Recipe.update(editing.id, payload);
        recipeId = editing.id;
      } else {
        const created = await base44.entities.Recipe.create(payload);
        recipeId = created.id;
      }
      // Save ingredients
      if (editing) {
        const existing = await base44.entities.RecipeIngredient.filter({ recipe_id: recipeId });
        await base44.entities.RecipeIngredient.deleteMany({ id: { $in: existing.map(e => e.id) } });
      }
      await base44.entities.RecipeIngredient.bulkCreate(form.ingredients.map(i => ({
        recipe_id: recipeId,
        material_id: i.material_id, material_name: i.material_name, material_type: i.material_type,
        percentage: Number(i.percentage), density: Number(i.density), pg_content: Number(i.pg_content), vg_content: Number(i.vg_content),
        nicotine_strength: Number(i.nicotine_strength), mix_order: i.mix_order || 0, notes: i.notes || '',
      })));
      await createAuditLog({ module: 'Resep', action: editing ? 'Edit' : 'Tambah', entity_type: 'Recipe', entity_id: recipeId, reference_number: recipeCode });
      toast({ title: editing ? 'Resep diperbarui' : 'Resep dibuat' });
      setModalOpen(false); loadData();
    } catch (e) { toast({ variant: 'destructive', title: 'Gagal menyimpan', description: e.message }); }
    finally { setSubmitting(false); }
  };

  const handleApprove = async (item) => {
    if (!confirm(`Setujui resep "${item.name}"?`)) return;
    try {
      await base44.entities.Recipe.update(item.id, { status: 'approved', approval_date: new Date().toISOString(), approved_by: 'Admin' });
      await createAuditLog({ module: 'Resep', action: 'Approve', entity_type: 'Recipe', entity_id: item.id, reference_number: item.code });
      toast({ title: 'Resep disetujui' });
      loadData();
    } catch { toast({ variant: 'destructive', title: 'Gagal menyetujui' }); }
  };

  const handleDuplicate = async (item) => {
    try {
      const ingredients = await base44.entities.RecipeIngredient.filter({ recipe_id: item.id });
      const dupCode = await generateRecipeCode();
      const newRecipe = await base44.entities.Recipe.create({
        ...item, code: dupCode, name: `${item.name} (Copy)`,
        status: 'draft', version: 1, id: undefined, approved_by: '', approval_date: '',
      });
      await base44.entities.RecipeIngredient.bulkCreate(ingredients.map(i => ({ ...i, recipe_id: newRecipe.id, id: undefined })));
      toast({ title: 'Resep diduplikasi' });
      loadData();
    } catch { toast({ variant: 'destructive', title: 'Gagal menduplikasi' }); }
  };

  const columns = [
    { key: 'code', header: 'Kode', sortable: true, className: 'font-mono font-medium' },
    { key: 'name', header: 'Nama Resep', sortable: true, className: 'font-medium' },
    { key: 'brand_name', header: 'Merk', render: (row) => row.brand_name || '—' },
    { key: 'target_volume', header: 'Target', render: (row) => `${row.target_volume || 0} ml` },
    { key: 'target_nicotine', header: 'Nic', render: (row) => `${row.target_nicotine || 0} mg` },
    { key: 'version', header: 'Versi', render: (row) => `v${row.version || 1}` },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'actions', header: '', width: '120px',
      render: (row) => (
        <div className="flex items-center gap-1">
          <button onClick={() => openEdit(row)} className="p-1.5 hover:bg-muted rounded" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
          {row.status === 'approved' ? (
            <span className="p-1.5 text-emerald-500" title="Disetujui"><CheckCircle className="w-3.5 h-3.5" /></span>
          ) : (
            <button onClick={() => handleApprove(row)} className="p-1.5 hover:bg-emerald-50 rounded text-emerald-600" title="Setujui"><CheckCircle className="w-3.5 h-3.5" /></button>
          )}
          <button onClick={() => handleDuplicate(row)} className="p-1.5 hover:bg-muted rounded" title="Duplikasi"><Copy className="w-3.5 h-3.5" /></button>
        </div>
      )
    },
  ];

  const mcLabel = { flavor: 'Flavor', propylene_glycol: 'PG', vegetable_glycerin: 'VG', nicotine: 'Nicotine', sweetener: 'Sweetener', cooling: 'Cooling', additive: 'Additive', lainnya: 'Lainnya' };

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader title="Master Resep" description="Formulasi resep e-liquid dengan kalkulasi otomatis"
        actions={<Button onClick={openAdd} size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> Tambah Resep</Button>} />
      <DataTable columns={columns} data={data} loading={loading} emptyMessage="Belum ada resep" searchKeys={['code', 'name', 'brand_name']} searchPlaceholder="Cari resep..." />

      <FormModal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Resep' : 'Tambah Resep'} onSubmit={handleSubmit} submitting={submitting} submitLabel="Simpan Resep" size="xl">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2"><Label className="text-[12.5px] mb-1">Nama Resep *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Kode</Label><Input value={editing ? form.code : ''} placeholder="Otomatis" className="h-9 text-[13px] font-mono bg-muted/40" disabled readOnly /></div>
          <div>
            <Label className="text-[12.5px] mb-1">Merk *</Label>
            <Select value={form.brand_id} onValueChange={v => setForm({ ...form, brand_id: v })}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Pilih merk" /></SelectTrigger>
              <SelectContent>{brands.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[12.5px] mb-1">Produk Terkait</Label>
            <Select value={form.product_id} onValueChange={v => setForm({ ...form, product_id: v })}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Pilih produk" /></SelectTrigger>
              <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-[12.5px] mb-1">Target Volume (ml)</Label><Input type="number" value={form.target_volume} onChange={e => setForm({ ...form, target_volume: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Target Nicotine (mg/ml)</Label><Input type="number" step="0.5" value={form.target_nicotine} onChange={e => setForm({ ...form, target_nicotine: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Target PG (%)</Label><Input type="number" value={form.target_pg} onChange={e => setForm({ ...form, target_pg: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Target VG (%)</Label><Input type="number" value={form.target_vg} onChange={e => setForm({ ...form, target_vg: e.target.value })} className="h-9 text-[13px]" /></div>
        </div>

        {/* Ingredients */}
        <div className="border-t pt-3 mt-3">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-[12.5px] font-semibold flex items-center gap-1"><Calculator className="w-3.5 h-3.5" /> Bahan Resep</Label>
            <Button type="button" onClick={addIngredient} size="sm" variant="outline" className="h-7 text-[12px] gap-1"><Plus className="w-3.5 h-3.5" /> Tambah Bahan</Button>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {form.ingredients.length === 0 && <div className="text-center py-4 text-[12px] text-muted-foreground border border-dashed rounded">Belum ada bahan. Klik "Tambah Bahan" untuk mulai.</div>}
            {form.ingredients.map((ing, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_80px_80px_30px] gap-1.5 items-center">
                <Select value={ing.material_id} onValueChange={v => updateIngredient(idx, 'material_id', v)}>
                  <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Pilih bahan" /></SelectTrigger>
                  <SelectContent>{materials.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="number" placeholder="%" value={ing.percentage} onChange={e => updateIngredient(idx, 'percentage', e.target.value)} className="h-8 text-[12px]" />
                <span className="text-[10px] text-muted-foreground px-1">{mcLabel[ing.material_type] || ing.material_type}</span>
                <button type="button" onClick={() => removeIngredient(idx)} className="p-1 hover:bg-red-50 rounded text-red-500"><X className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        </div>

        {/* Calculation Preview */}
        {calcResult && (
          <div className="border-t pt-3 mt-3">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-[12.5px] font-semibold">Hasil Kalkulasi</Label>
              <span className={`text-[11px] px-2 py-0.5 rounded font-semibold ${calcResult.validation.valid ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                {calcResult.validation.valid ? 'Valid' : 'Tidak Valid'}
              </span>
            </div>
            {calcResult.validation.errors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded px-2 py-1.5 mb-2 text-[11px] text-red-700 space-y-0.5">
                {calcResult.validation.errors.map((err, i) => <div key={i}>⚠ {err}</div>)}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px]">
                <thead><tr className="bg-muted/40 text-muted-foreground">
                  <th className="px-2 py-1 text-left">Bahan</th>
                  <th className="px-2 py-1 text-right">Persentase</th>
                  <th className="px-2 py-1 text-right">Volume (ml)</th>
                  <th className="px-2 py-1 text-right">Berat (gram)</th>
                </tr></thead>
                <tbody>
                  {calcResult.items.map((item, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="px-2 py-1">{item.material_name || mcLabel[item.material_type] || item.material_type}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{item.percentage.toFixed(2)}%</td>
                      <td className="px-2 py-1 text-right tabular-nums">{item.volumeMl.toFixed(2)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{item.gram.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="font-semibold border-t">
                  <td className="px-2 py-1">Total</td>
                  <td className="px-2 py-1 text-right tabular-nums">{calcResult.totalPercent.toFixed(2)}%</td>
                  <td className="px-2 py-1 text-right tabular-nums">{calcResult.totalVolume.toFixed(2)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{calcResult.totalGram.toFixed(2)}</td>
                </tr></tfoot>
              </table>
            </div>
            <div className="grid grid-cols-4 gap-2 mt-2 text-[11px]">
              <div className="bg-muted/40 rounded px-2 py-1">Total Flavor: <b>{calcResult.totalFlavor.toFixed(1)}%</b></div>
              <div className="bg-muted/40 rounded px-2 py-1">PG: <b>{calcResult.totalPG.toFixed(1)}%</b></div>
              <div className="bg-muted/40 rounded px-2 py-1">VG: <b>{calcResult.totalVG.toFixed(1)}%</b></div>
              <div className="bg-muted/40 rounded px-2 py-1">Nicotine: <b>{calcResult.nicotineVolume.toFixed(1)} ml</b></div>
            </div>
          </div>
        )}
        <div><Label className="text-[12.5px] mb-1">Catatan</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="text-[13px]" /></div>
      </FormModal>
    </div>
  );
}