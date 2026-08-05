import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import FormModal from '@/components/FormModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import NumberInput from '@/components/NumberInput';
import SearchableSelect from '@/components/SearchableSelect';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { generateMaterialCode, generatePremixMaterialCode } from '@/lib/sequence';

const materialTypes = [
  { value: 'RAW_MATERIAL', label: 'Raw Material' },
  { value: 'PREMIX', label: 'Premix' },
  { value: 'PACKAGING', label: 'Packaging' },
  { value: 'BOTTLE', label: 'Botol' },
  { value: 'LABEL', label: 'Label' },
  { value: 'STICKER', label: 'Stiker' },
  { value: 'EXCISE', label: 'Pita Cukai' },
  { value: 'CONSUMABLE', label: 'Consumable' },
  { value: 'FINISHED_GOOD', label: 'Finished Good' },
];
const mtLabel = (v) => materialTypes.find(t => t.value === v)?.label || v;
const concentrationUnits = [
  { value: 'PERCENT_WW', label: '% w/w' },
  { value: 'PERCENT_WV', label: '% w/v' },
  { value: 'PERCENT_VV', label: '% v/v' },
];

const materialCategories = [
  { value: 'flavor', label: 'Flavor' },
  { value: 'propylene_glycol', label: 'Propylene Glycol' },
  { value: 'vegetable_glycerin', label: 'Vegetable Glycerin' },
  { value: 'nicotine', label: 'Nicotine' },
  { value: 'sweetener', label: 'Sweetener' },
  { value: 'cooling', label: 'Cooling' },
  { value: 'additive', label: 'Additive' },
  { value: 'lainnya', label: 'Lainnya' },
];
const mcLabel = (v) => materialCategories.find(t => t.value === v)?.label || v;
const units = [{ value: 'gram', label: 'Gram' }, { value: 'mililiter', label: 'Mililiter' }, { value: 'unit', label: 'Unit' }];

// Memetakan tipe bahan ke jenis kategori Master Kategori agar dropdown kategori
// menampilkan scope yang sesuai (mis. PACKAGING -> kemasan, LABEL -> label).
const CATEGORY_TYPE_BY_MATERIAL_TYPE = {
  RAW_MATERIAL: 'bahan',
  PREMIX: 'bahan',
  PACKAGING: 'kemasan',
  BOTTLE: 'kemasan',
  LABEL: 'label',
  STICKER: 'label',
  CONSUMABLE: 'barang',
  EXCISE: 'barang',
  FINISHED_GOOD: 'produk_jadi',
};
const catTypeLabel = (materialType) => {
  const t = CATEGORY_TYPE_BY_MATERIAL_TYPE[materialType] || 'bahan';
  return ({ bahan: 'bahan', kemasan: 'kemasan', label: 'label', barang: 'barang', produk_jadi: 'produk jadi' })[t] || t;
};

export default function Materials() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', material_type: 'RAW_MATERIAL', category_id: '', specification: '', material_category: 'flavor', supplier_id: '', unit: 'gram', density: '', pg_content: '', vg_content: '', nicotine_strength: '', min_stock: '', last_purchase_price: '', is_active: true, is_internally_produced: false, concentration_value: '', concentration_unit: 'PERCENT_WW', carrier_material_id: '', default_density: '', notes: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [items, cats, sups] = await Promise.all([
        base44.entities.Material.list('-created_date', 200),
        base44.entities.Category.filter({ category_type: 'bahan', is_active: true }),
        base44.entities.Supplier.filter({ is_active: true }),
      ]);
      setData(items);
      setCategories(cats);
      setSuppliers(sups);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat data' }); }
    finally { setLoading(false); }
  }, [toast]);

  // Refetch kategori bahan aktif tiap kali form dibuka agar kategori baru langsung muncul
  // tanpa hard refresh, dan tetap tampilkan kategori material yang sedang diedit walau nonaktif.
  const [catError, setCatError] = useState(false);
  const refreshCategories = useCallback(async (currentCategoryId, materialType) => {
    try {
      setCatError(false);
      const catType = CATEGORY_TYPE_BY_MATERIAL_TYPE[materialType] || 'bahan';
      let cats = await base44.entities.Category.filter({ category_type: catType, is_active: true });
      if (currentCategoryId && !cats.some(c => c.id === currentCategoryId)) {
        try {
          const cur = await base44.entities.Category.get(currentCategoryId);
          if (cur && cur.category_type === catType) cats = [cur, ...cats];
        } catch { /* kategori mungkin sudah dihapus; abaikan */ }
      }
      setCategories(cats);
    } catch {
      setCatError(true);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const openAdd = () => { setEditing(null); setForm({ code: '', name: '', material_type: 'RAW_MATERIAL', category_id: '', specification: '', material_category: 'flavor', supplier_id: '', unit: 'gram', density: '', pg_content: '', vg_content: '', nicotine_strength: '', min_stock: '', last_purchase_price: '', is_active: true, is_internally_produced: false, concentration_value: '', concentration_unit: 'PERCENT_WW', carrier_material_id: '', default_density: '', notes: '' });     refreshCategories(null, 'RAW_MATERIAL'); setModalOpen(true); };
  const openEdit = (item) => {
    setEditing(item);
    setForm({ code: item.code, name: item.name, material_type: item.material_type || 'RAW_MATERIAL', category_id: item.category_id || '', specification: item.specification || '', material_category: item.material_category, supplier_id: item.supplier_id || '', unit: item.unit, density: item.density ?? '', pg_content: item.pg_content ?? '', vg_content: item.vg_content ?? '', nicotine_strength: item.nicotine_strength ?? '', min_stock: item.min_stock ?? '', last_purchase_price: item.last_purchase_price ?? '', is_active: item.is_active, is_internally_produced: item.is_internally_produced ?? false, concentration_value: item.concentration_value ?? '', concentration_unit: item.concentration_unit || 'PERCENT_WW', carrier_material_id: item.carrier_material_id || '', default_density: item.default_density ?? '', notes: item.notes || '' });
    refreshCategories(item.category_id, item.material_type);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name) { toast({ variant: 'destructive', title: 'Nama wajib diisi' }); return; }
    setSubmitting(true);
    try {
      const cat = categories.find(c => c.id === form.category_id);
      const sup = suppliers.find(s => s.id === form.supplier_id);
      const carrier = data.find(m => m.id === form.carrier_material_id);
      const isPremix = form.material_type === 'PREMIX';
      const payload = {
        ...form,
        material_type: form.material_type,
        is_internally_produced: isPremix,
        material_category: isPremix ? 'premix' : form.material_category,
        concentration_value: Number(form.concentration_value),
        concentration_unit: form.concentration_unit,
        carrier_material_id: form.carrier_material_id,
        carrier_material_name: carrier?.name || '',
        default_density: Number(form.default_density),
        density: Number(form.density),
        pg_content: Number(form.pg_content),
        vg_content: Number(form.vg_content),
        nicotine_strength: Number(form.nicotine_strength),
        min_stock: Number(form.min_stock),
        last_purchase_price: Number(form.last_purchase_price),
        category_name: cat?.name || '',
        supplier_name: sup?.name || '',
      };
      if (editing) { await base44.entities.Material.update(editing.id, payload); toast({ title: 'Bahan diperbarui' }); }
      else {
        const code = isPremix
          ? await generatePremixMaterialCode((form.name || 'XX').substring(0, 4).toUpperCase(), Number(form.concentration_value) || 0)
          : await generateMaterialCode();
        await base44.entities.Material.create({ ...payload, code });
        toast({ title: 'Bahan ditambahkan' });
      }
      setModalOpen(false); loadData();
    } catch (e) { toast({ variant: 'destructive', title: 'Gagal menyimpan', description: e.message }); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (item) => {
    if (!confirm(`Nonaktifkan bahan "${item.name}"?`)) return;
    try { await base44.entities.Material.update(item.id, { is_active: false }); toast({ title: 'Bahan dinonaktifkan' }); loadData(); }
    catch { toast({ variant: 'destructive', title: 'Gagal' }); }
  };

  const columns = [
    { key: 'code', header: 'Kode', sortable: true, className: 'font-mono font-medium' },
    { key: 'name', header: 'Nama Bahan', sortable: true, className: 'font-medium' },
    { key: 'specification', header: 'Spesifikasi', render: (row) => row.specification || '—' },
    { key: 'material_type', header: 'Tipe', render: (row) => row.material_type === 'PREMIX'
      ? <span className="text-[11px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded font-semibold">Premix</span>
      : <span className="text-[11px] px-2 py-0.5 bg-slate-100 text-slate-500 rounded">{mtLabel(row.material_type)}</span> },
    { key: 'material_category', header: 'Jenis', render: (row) => <span className="text-[11px] px-2 py-0.5 bg-muted rounded">{mcLabel(row.material_category)}</span> },
    { key: 'unit', header: 'Satuan' },
    { key: 'density', header: 'Density', render: (row) => row.density ? `${row.density} g/ml` : '—' },
    { key: 'min_stock', header: 'Stok Min', render: (row) => <span className="tabular-nums">{row.min_stock}</span> },
    {
      key: 'is_active', header: 'Status',
      render: (row) => row.is_active
        ? <span className="text-[11px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded font-semibold">Aktif</span>
        : <span className="text-[11px] px-2 py-0.5 bg-slate-100 text-slate-400 rounded">Nonaktif</span>
    },
    {
      key: 'actions', header: '', width: '80px',
      render: (row) => (
        <div className="flex items-center gap-1">
          <button onClick={() => openEdit(row)} className="p-1.5 hover:bg-muted rounded"><Pencil className="w-3.5 h-3.5" /></button>
          <button onClick={() => handleDelete(row)} className="p-1.5 hover:bg-red-50 rounded text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      )
    },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader title="Master Bahan" description="Bahan baku e-liquid (flavor, PG, VG, nicotine, dll)"
        actions={<Button onClick={openAdd} size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> Tambah Bahan</Button>} />
      <DataTable columns={columns} data={data} loading={loading} emptyMessage="Belum ada bahan" searchKeys={['code', 'name']} searchPlaceholder="Cari bahan..." />
      <FormModal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Bahan' : 'Tambah Bahan'} onSubmit={handleSubmit} submitting={submitting} size="lg">
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-[12.5px] mb-1">Kode Bahan</Label><Input value={editing ? form.code : ''} placeholder="Otomatis" className="h-9 text-[13px] font-mono bg-muted/40" disabled readOnly /></div>
          <div><Label className="text-[12.5px] mb-1">Nama Bahan *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Spesifikasi</Label><Input value={form.specification} onChange={e => setForm({ ...form, specification: e.target.value })} placeholder="mis. Cair / 60ml / Premix" className="h-9 text-[13px]" /></div>
          <div>
            <Label className="text-[12.5px] mb-1">Kategori</Label>
            {catError ? (
              <div className="flex items-center gap-2 h-9">
                <span className="text-[12px] text-destructive">Daftar kategori gagal dimuat.</span>
                <Button type="button" variant="outline" size="sm" onClick={() => refreshCategories(editing?.category_id, form.material_type)}>Coba Lagi</Button>
              </div>
            ) : categories.length === 0 ? (
              <p className="text-[12px] text-muted-foreground italic">Belum ada kategori {catTypeLabel(form.material_type)}. Tambahkan kategori (Jenis: {catTypeLabel(form.material_type)}) pada Master Kategori.</p>
            ) : (
              <SearchableSelect
                value={form.category_id}
                onValueChange={v => setForm({ ...form, category_id: v })}
                options={categories.map(c => ({ value: c.id, label: c.is_active === false ? `${c.name} (Nonaktif)` : c.name, keywords: c.code }))}
                placeholder={`Cari kategori ${catTypeLabel(form.material_type)}...`}
                className="h-9"
              />
            )}
          </div>
          <div>
            <Label className="text-[12.5px] mb-1">Jenis Bahan</Label>
            <Select value={form.material_category} onValueChange={v => setForm({ ...form, material_category: v })}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>{materialCategories.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[12.5px] mb-1">Tipe Bahan</Label>
            <Select value={form.material_type} onValueChange={v => { setForm(f => ({ ...f, material_type: v, category_id: '' })); refreshCategories(null, v); }}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>{materialTypes.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[12.5px] mb-1">Supplier Utama</Label>
            <Select value={form.supplier_id} onValueChange={v => setForm({ ...form, supplier_id: v })}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Pilih supplier" /></SelectTrigger>
              <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[12.5px] mb-1">Satuan</Label>
            <Select value={form.unit} onValueChange={v => setForm({ ...form, unit: v })}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>{units.map(u => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-[12.5px] mb-1">Density (g/ml)</Label><NumberInput value={form.density} onChange={v => setForm({ ...form, density: v })} allowDecimal maxDecimals={3} min={0} step="0.001" className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Kandungan PG (%)</Label><NumberInput value={form.pg_content} onChange={v => setForm({ ...form, pg_content: v })} allowDecimal maxDecimals={2} min={0} max={100} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Kandungan VG (%)</Label><NumberInput value={form.vg_content} onChange={v => setForm({ ...form, vg_content: v })} allowDecimal maxDecimals={2} min={0} max={100} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Kekuatan Nicotine (mg/ml)</Label><NumberInput value={form.nicotine_strength} onChange={v => setForm({ ...form, nicotine_strength: v })} allowDecimal maxDecimals={2} min={0} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Stok Minimum</Label><NumberInput value={form.min_stock} onChange={v => setForm({ ...form, min_stock: v })} allowDecimal min={0} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Harga Beli Terakhir</Label><NumberInput value={form.last_purchase_price} onChange={v => setForm({ ...form, last_purchase_price: v })} allowDecimal min={0} className="h-9 text-[13px]" /></div>
        </div>
        {form.material_type === 'PREMIX' && (
          <div className="border rounded-md p-3 bg-amber-50/40 space-y-2">
            <div className="text-[12px] font-semibold text-amber-700">Properti Premix</div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-[12.5px] mb-1">Konsentrasi</Label><NumberInput value={form.concentration_value} onChange={v => setForm({ ...form, concentration_value: v })} allowDecimal maxDecimals={2} min={0} className="h-9 text-[13px]" /></div>
              <div>
                <Label className="text-[12.5px] mb-1">Satuan Konsentrasi</Label>
                <Select value={form.concentration_unit} onValueChange={v => setForm({ ...form, concentration_unit: v })}>
                  <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{concentrationUnits.map(u => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-[12.5px] mb-1">Density Default (g/ml)</Label><NumberInput value={form.default_density} onChange={v => setForm({ ...form, default_density: v })} allowDecimal maxDecimals={3} min={0} step="0.001" className="h-9 text-[13px]" /></div>
              <div className="col-span-3">
                <Label className="text-[12.5px] mb-1">Carrier</Label>
                <Select value={form.carrier_material_id} onValueChange={v => setForm({ ...form, carrier_material_id: v })}>
                  <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Pilih carrier (mis. PG)" /></SelectTrigger>
                  <SelectContent>{data.filter(m => (m.material_category === 'propylene_glycol' || m.material_category === 'vegetable_glycerin') && m.id !== editing?.id).map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="text-[11px] text-amber-700/80">Bahan premix otomatis ditandai "Diproduksi Internal". Kode dibuat otomatis format PMX-NAMA-KONS-NOMOR.</div>
          </div>
        )}
        <div><Label className="text-[12.5px] mb-1">Catatan</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="text-[13px]" /></div>
        <div className="flex items-center gap-2 pt-1"><Switch checked={form.is_active} onCheckedChange={v => setForm({ ...form, is_active: v })} /><Label className="text-[12.5px]">Aktif</Label></div>
      </FormModal>
    </div>
  );
}