import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import FormModal from '@/components/FormModal';
import StatusBadge from '@/components/StatusBadge';
import NumberInput from '@/components/NumberInput';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Pencil, Trash2, Eye, CheckCircle2, XCircle, Download } from 'lucide-react';
import { postPurchase, cancelPurchase, snapshotItem } from '@/lib/purchaseUtils';
import { generatePurchaseNumber } from '@/lib/sequence';

const itemTypes = [
  { value: 'material', label: 'Bahan Produksi' },
  { value: 'packaging', label: 'Kemasan' },
  { value: 'label', label: 'Labeling' },
  { value: 'excise_material', label: 'Cukai' },
  { value: 'consumable', label: 'Consumable' },
  { value: 'supporting_item', label: 'Barang Pendukung' },
];
const itLabel = (v) => itemTypes.find(t => t.value === v)?.label || v;

const paymentMethods = [
  { value: 'cash', label: 'Tunai' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'tempo', label: 'Tempo' },
];
const pmLabel = (v) => paymentMethods.find(t => t.value === v)?.label || v;

const fmtMoney = (v) => 'Rp ' + (Number(v) || 0).toLocaleString('id-ID');
const toNum = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

const emptyItem = () => ({
  item_type: 'material', item_id: '', item_code: '', item_name: '', category_name: '',
  batch_supplier: '', lot_number: '', production_date: '', expiry_date: '',
  quantity: '', unit: '', conversion_factor: '1', base_unit: '', base_quantity: '',
  unit_price: '', discount: '', tax: '', subtotal: '', notes: '',
});

export default function Purchases() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [detailItem, setDetailItem] = useState(null);
  const [detailItems, setDetailItems] = useState([]);
  const [filters, setFilters] = useState({ supplier: 'all', payment_method: 'all', status: 'all' });

  const [form, setForm] = useState({
    supplier_invoice_number: '', purchase_date: new Date().toISOString().slice(0, 10),
    supplier_id: '', supplier_name: '', warehouse_id: '', warehouse_name: '',
    payment_method: 'cash', payment_terms: '', due_date: '',
    discount: '', tax: '', additional_cost: '', notes: '',
    items: [emptyItem()],
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [items, sups, whs, mats, prods] = await Promise.all([
        base44.entities.Purchase.list('-created_date', 200),
        base44.entities.Supplier.filter({ is_active: true }),
        base44.entities.Warehouse.filter({ is_active: true }),
        base44.entities.Material.filter({ is_active: true }),
        base44.entities.Product.filter({ is_active: true }),
      ]);
      setData(items);
      setSuppliers(sups); setWarehouses(whs); setMaterials(mats); setProducts(prods);
    } catch { toast({ type: 'error', title: 'Gagal memuat data' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const getMaster = (itemType, id) => {
    if (itemType === 'material') return materials.find(m => m.id === id);
    return products.find(p => p.id === id);
  };

  const computeSubtotal = (it) => {
    const qty = toNum(it.quantity) || 0;
    const price = toNum(it.unit_price) || 0;
    const disc = toNum(it.discount) || 0;
    const tax = toNum(it.tax) || 0;
    const lineGross = qty * price;
    return Math.max(0, lineGross - disc) + tax;
  };

  const totals = useMemo(() => {
    const subtotal = form.items.reduce((s, it) => s + computeSubtotal(it), 0);
    const discount = toNum(form.discount) || 0;
    const tax = toNum(form.tax) || 0;
    const addCost = toNum(form.additional_cost) || 0;
    const total = Math.max(0, subtotal - discount) + tax + addCost;
    return { subtotal, total };
  }, [form.items, form.discount, form.tax, form.additional_cost]);

  // recompute base_quantity on the fly
  const recalcItem = (it) => {
    const qty = toNum(it.quantity);
    const cf = toNum(it.conversion_factor) ?? 1;
    return { ...it, base_quantity: (qty === null ? '' : String(qty * cf)) };
  };

  const openAdd = () => {
    setEditing(null);
    setForm({
      supplier_invoice_number: '', purchase_date: new Date().toISOString().slice(0, 10),
      supplier_id: '', supplier_name: '', warehouse_id: '', warehouse_name: '',
      payment_method: 'cash', payment_terms: '', due_date: '',
      discount: '', tax: '', additional_cost: '', notes: '',
      items: [emptyItem()],
    });
    setModalOpen(true);
  };

  const openEdit = async (row) => {
    setEditing(row);
    const items = await base44.entities.PurchaseItem.filter({ purchase_id: row.id });
    setForm({
      supplier_invoice_number: row.supplier_invoice_number || '',
      purchase_date: row.purchase_date || new Date().toISOString().slice(0, 10),
      supplier_id: row.supplier_id || '', supplier_name: row.supplier_name || '',
      warehouse_id: row.warehouse_id || '', warehouse_name: row.warehouse_name || '',
      payment_method: row.payment_method || 'cash',
      payment_terms: row.payment_terms ?? '',
      due_date: row.due_date || '',
      discount: row.discount ?? '', tax: row.tax ?? '',
      additional_cost: row.additional_cost ?? '', notes: row.notes || '',
      items: (items.length ? items : [emptyItem()]).map(it => ({
        item_type: it.item_type, item_id: it.item_id, item_code: it.item_code, item_name: it.item_name,
        category_name: it.category_name || '', batch_supplier: it.batch_supplier || '', lot_number: it.lot_number || '',
        production_date: it.production_date || '', expiry_date: it.expiry_date || '',
        quantity: it.quantity ?? '', unit: it.unit || '', conversion_factor: it.conversion_factor ?? '1',
        base_unit: it.base_unit || '', base_quantity: it.base_quantity ?? '',
        unit_price: it.unit_price ?? '', discount: it.discount ?? '', tax: it.tax ?? '',
        subtotal: it.subtotal ?? '', notes: it.notes || '',
      })),
    });
    setModalOpen(true);
  };

  const onSupplierChange = (v) => {
    const sup = suppliers.find(s => s.id === v);
    setForm(prev => ({ ...prev, supplier_id: v, supplier_name: sup?.name || '', payment_terms: prev.payment_terms || '' }));
  };

  const onWarehouseChange = (v) => {
    const wh = warehouses.find(w => w.id === v);
    setForm(prev => ({ ...prev, warehouse_id: v, warehouse_name: wh?.name || '' }));
  };

  const onPaymentMethod = (v) => {
    setForm(prev => {
      const next = { ...prev, payment_method: v };
      if (v === 'tempo') {
        const terms = toNum(prev.payment_terms);
        const days = terms && terms > 0 ? terms : 30;
        const due = new Date(prev.purchase_date || new Date());
        due.setDate(due.getDate() + days);
        next.payment_terms = String(days);
        next.due_date = due.toISOString().slice(0, 10);
      } else {
        next.due_date = '';
      }
      return next;
    });
  };

  const onPurchaseDate = (d) => {
    setForm(prev => {
      if (prev.payment_method !== 'tempo') return { ...prev, purchase_date: d };
      const days = toNum(prev.payment_terms) || 30;
      const due = new Date(d); due.setDate(due.getDate() + days);
      return { ...prev, purchase_date: d, due_date: due.toISOString().slice(0, 10) };
    });
  };

  const onTermsChange = (val) => {
    setForm(prev => {
      const days = toNum(val) || 0;
      const due = new Date(prev.purchase_date || new Date());
      due.setDate(due.getDate() + days);
      return { ...prev, payment_terms: val, due_date: due.toISOString().slice(0, 10) };
    });
  };

  const updateItem = (idx, patch) => {
    setForm(prev => {
      const items = [...prev.items];
      items[idx] = recalcItem({ ...items[idx], ...patch });
      items[idx].subtotal = computeSubtotal(items[idx]);
      return { ...prev, items };
    });
  };

  const onSelectItem = (idx, itemType, id) => {
    const master = getMaster(itemType, id);
    const snap = snapshotItem(itemType, master);
    updateItem(idx, { item_type: itemType, item_id: id, ...snap, unit: snap.base_unit });
  };

  const addItemRow = () => setForm(prev => ({ ...prev, items: [...prev.items, emptyItem()] }));
  const duplicateRow = (idx) => setForm(prev => ({ ...prev, items: [...prev.items, { ...prev.items[idx] }] }));
  const removeItemRow = (idx) => setForm(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!form.supplier_id) { toast({ type: 'warning', title: 'Supplier wajib dipilih' }); return; }
    if (!form.warehouse_id) { toast({ type: 'warning', title: 'Gudang tujuan wajib dipilih' }); return; }
    const validItems = form.items.filter(it => it.item_id && toNum(it.quantity) > 0);
    if (validItems.length === 0) { toast({ type: 'warning', title: 'Minimal satu item dengan quantity > 0' }); return; }
    for (const it of validItems) {
      if (toNum(it.unit_price) === null || toNum(it.unit_price) < 0) { toast({ type: 'warning', title: `Harga ${it.item_name} tidak valid` }); return; }
    }
    setSubmitting(true);
    try {
      const payload = {
        supplier_invoice_number: form.supplier_invoice_number,
        purchase_date: form.purchase_date,
        supplier_id: form.supplier_id, supplier_name: form.supplier_name,
        warehouse_id: form.warehouse_id, warehouse_name: form.warehouse_name,
        payment_method: form.payment_method,
        payment_terms: toNum(form.payment_terms) ?? 0,
        due_date: form.due_date || null,
        subtotal: totals.subtotal,
        discount: toNum(form.discount) ?? 0,
        tax: toNum(form.tax) ?? 0,
        additional_cost: toNum(form.additional_cost) ?? 0,
        total: totals.total,
        total_paid: 0,
        remaining_payable: form.payment_method === 'tempo' ? totals.total : 0,
        purchase_status: 'draft',
        payment_status: 'belum_dibayar',
        notes: form.notes,
      };
      let purchaseId;
      let purchaseNumber;
      if (editing) {
        purchaseId = editing.id;
        purchaseNumber = editing.purchase_number;
        await base44.entities.Purchase.update(editing.id, payload);
        // Replace items
        const oldItems = await base44.entities.PurchaseItem.filter({ purchase_id: editing.id });
        await Promise.all(oldItems.map(it => base44.entities.PurchaseItem.delete(it.id)));
      } else {
        purchaseNumber = await generatePurchaseNumber();
        const created = await base44.entities.Purchase.create({ ...payload, purchase_number: purchaseNumber });
        purchaseId = created.id;
      }
      await base44.entities.PurchaseItem.bulkCreate(
        validItems.map(it => {
          const qty = toNum(it.quantity) || 0;
          const cf = toNum(it.conversion_factor) || 1;
          return {
            purchase_id: purchaseId,
            item_type: it.item_type, item_id: it.item_id,
            item_code: it.item_code, item_name: it.item_name, category_name: it.category_name,
            batch_supplier: it.batch_supplier, lot_number: it.lot_number,
            production_date: it.production_date || null, expiry_date: it.expiry_date || null,
            quantity: qty, unit: it.unit, conversion_factor: cf,
            base_unit: it.base_unit, base_quantity: qty * cf,
            unit_price: toNum(it.unit_price) || 0,
            discount: toNum(it.discount) ?? 0, tax: toNum(it.tax) ?? 0,
            subtotal: computeSubtotal(it),
            warehouse_id: form.warehouse_id, warehouse_name: form.warehouse_name,
            notes: it.notes,
          };
        })
      );
      toast({ type: 'success', title: editing ? 'Pembelian diperbarui' : 'Pembelian dibuat', description: purchaseNumber });
      setModalOpen(false);
      loadData();
    } catch (e2) { toast({ type: 'error', title: 'Gagal menyimpan', description: e2.message }); }
    finally { setSubmitting(false); }
  };

  const handlePost = async (row) => {
    if (!confirm(`Posting pembelian ${row.purchase_number}? Stok akan bertambah dan tidak dapat diubah.`)) return;
    try {
      await postPurchase(row.id);
      toast({ type: 'success', title: 'Pembelian diposting', description: row.purchase_number });
      loadData();
    } catch (e) { toast({ type: 'error', title: 'Gagal posting', description: e.message }); }
  };

  const handleCancel = async (row) => {
    const reason = prompt(`Alasan pembatalan ${row.purchase_number}:`);
    if (reason === null) return;
    try {
      await cancelPurchase(row.id, reason || 'tanpa alasan');
      toast({ type: 'success', title: 'Pembelian dibatalkan', description: row.purchase_number });
      loadData();
    } catch (e) { toast({ type: 'error', title: 'Gagal membatalkan', description: e.message }); }
  };

  const openDetail = async (row) => {
    setDetailItem(row);
    const items = await base44.entities.PurchaseItem.filter({ purchase_id: row.id });
    setDetailItems(items);
  };

  const handleExport = () => {
    const rows = filteredData.map(r => ({
      'No Pembelian': r.purchase_number, 'Tanggal': r.purchase_date, 'Supplier': r.supplier_name,
      'Invoice Supplier': r.supplier_invoice_number || '', 'Jumlah Item': r.item_count || 0,
      'Total': r.total || 0, 'Metode': pmLabel(r.payment_method), 'Jatuh Tempo': r.due_date || '',
      'Status': r.purchase_status, 'Pembayaran': r.payment_status,
    }));
    const headers = Object.keys(rows[0] || {});
    const csv = [headers.join(','), ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `pembelian-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast({ type: 'success', title: 'Export berhasil' });
  };

  const filteredData = useMemo(() => {
    return data.filter(r => {
      if (filters.supplier !== 'all' && r.supplier_id !== filters.supplier) return false;
      if (filters.payment_method !== 'all' && r.payment_method !== filters.payment_method) return false;
      if (filters.status !== 'all' && r.purchase_status !== filters.status) return false;
      return true;
    });
  }, [data, filters]);

  const columns = [
    { key: 'purchase_number', header: 'No. Pembelian', sortable: true, className: 'font-mono font-medium' },
    { key: 'purchase_date', header: 'Tanggal', sortable: true },
    { key: 'supplier_name', header: 'Supplier', sortable: true, className: 'font-medium' },
    { key: 'supplier_invoice_number', header: 'Inv. Supplier', render: (r) => r.supplier_invoice_number || '—' },
    { key: 'total', header: 'Total', sortable: true, render: (r) => <span className="tabular-nums">{fmtMoney(r.total)}</span> },
    { key: 'payment_method', header: 'Metode', render: (r) => <span className="text-[11px] px-2 py-0.5 bg-muted rounded">{pmLabel(r.payment_method)}</span> },
    { key: 'due_date', header: 'Jatuh Tempo', render: (r) => r.due_date || '—' },
    { key: 'purchase_status', header: 'Status', render: (r) => <StatusBadge status={r.purchase_status} /> },
    { key: 'payment_status', header: 'Pembayaran', render: (r) => <StatusBadge status={r.payment_status} /> },
    {
      key: 'actions', header: '', width: '150px',
      render: (row) => (
        <div className="flex items-center gap-1">
          <button onClick={() => openDetail(row)} className="p-1.5 hover:bg-muted rounded" title="Detail"><Eye className="w-3.5 h-3.5" /></button>
          {row.purchase_status === 'draft' && (
            <>
              <button onClick={() => openEdit(row)} className="p-1.5 hover:bg-muted rounded" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
              <button onClick={() => handlePost(row)} className="p-1.5 hover:bg-emerald-50 rounded text-emerald-600" title="Posting"><CheckCircle2 className="w-3.5 h-3.5" /></button>
            </>
          )}
          {(row.purchase_status === 'draft' || row.purchase_status === 'posted') && (
            <button onClick={() => handleCancel(row)} className="p-1.5 hover:bg-red-50 rounded text-red-500" title="Batal"><XCircle className="w-3.5 h-3.5" /></button>
          )}
        </div>
      )
    },
  ];

  const detailColumns = [
    { key: 'item_code', header: 'Kode', className: 'font-mono' },
    { key: 'item_name', header: 'Nama Item', className: 'font-medium' },
    { key: 'item_type', header: 'Jenis', render: (r) => <span className="text-[10.5px] px-1.5 py-0.5 bg-muted rounded">{itLabel(r.item_type)}</span> },
    { key: 'quantity', header: 'Qty Beli', render: (r) => `${r.quantity} ${r.unit || ''}` },
    { key: 'conversion_factor', header: 'Konversi', render: (r) => `x ${r.conversion_factor || 1}` },
    { key: 'base_quantity', header: 'Qty Dasar', render: (r) => `${r.base_quantity} ${r.base_unit || ''}` },
    { key: 'unit_price', header: 'Harga', render: (r) => fmtMoney(r.unit_price) },
    { key: 'batch_supplier', header: 'Batch', render: (r) => r.batch_supplier || '—' },
    { key: 'expiry_date', header: 'Exp', render: (r) => r.expiry_date || '—' },
    { key: 'subtotal', header: 'Subtotal', render: (r) => fmtMoney(r.subtotal) },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader title="Pembelian" description="Pencatatan pembelian bahan, kemasan, label, dan barang pendukung"
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={handleExport} size="sm" variant="outline" className="gap-1.5"><Download className="w-4 h-4" /> Export</Button>
            <Button onClick={openAdd} size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> Pembelian Baru</Button>
          </div>
        } />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Select value={filters.supplier} onValueChange={v => setFilters(f => ({ ...f, supplier: v }))}>
          <SelectTrigger className="h-8 w-48 text-[12px]"><SelectValue placeholder="Semua Supplier" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Supplier</SelectItem>
            {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.payment_method} onValueChange={v => setFilters(f => ({ ...f, payment_method: v }))}>
          <SelectTrigger className="h-8 w-36 text-[12px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Metode</SelectItem>
            {paymentMethods.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.status} onValueChange={v => setFilters(f => ({ ...f, status: v }))}>
          <SelectTrigger className="h-8 w-40 text-[12px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="posted">Posted</SelectItem>
            <SelectItem value="received">Diterima</SelectItem>
            <SelectItem value="cancelled">Dibatalkan</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable columns={columns} data={filteredData} loading={loading} emptyMessage="Belum ada pembelian" searchKeys={['purchase_number', 'supplier_name', 'supplier_invoice_number']} searchPlaceholder="Cari pembelian..." />

      {/* Form modal */}
      <FormModal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Pembelian' : 'Pembelian Baru'} onSubmit={handleSubmit} submitting={submitting} size="xl" submitLabel="Simpan Draft">
        {/* Header fields */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <Label className="text-[12.5px] mb-1">Supplier *</Label>
            <Select value={form.supplier_id} onValueChange={onSupplierChange}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Pilih supplier" /></SelectTrigger>
              <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-[12.5px] mb-1">Tanggal Pembelian *</Label><Input type="date" value={form.purchase_date} onChange={e => onPurchaseDate(e.target.value)} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">No. Invoice Supplier</Label><Input value={form.supplier_invoice_number} onChange={e => setForm({ ...form, supplier_invoice_number: e.target.value })} className="h-9 text-[13px]" /></div>
          <div>
            <Label className="text-[12.5px] mb-1">Gudang Tujuan *</Label>
            <Select value={form.warehouse_id} onValueChange={onWarehouseChange}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Pilih gudang" /></SelectTrigger>
              <SelectContent>{warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[12.5px] mb-1">Metode Pembayaran</Label>
            <Select value={form.payment_method} onValueChange={onPaymentMethod}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>{paymentMethods.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {form.payment_method === 'tempo' && (
            <>
              <div><Label className="text-[12.5px] mb-1">Termin (hari)</Label><NumberInput value={form.payment_terms} onChange={v => onTermsChange(v)} allowDecimal={false} min={0} className="h-9 text-[13px]" /></div>
              <div><Label className="text-[12.5px] mb-1">Jatuh Tempo</Label><Input type="date" value={form.due_date} disabled className="h-9 text-[13px] bg-muted/40" /></div>
            </>
          )}
        </div>

        {/* Items */}
        <div className="pt-2">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-[12.5px] font-semibold">Item Pembelian</Label>
            <Button type="button" size="sm" variant="outline" onClick={addItemRow} className="gap-1.5 h-7 text-[12px]"><Plus className="w-3.5 h-3.5" /> Tambah Baris</Button>
          </div>
          <div className="border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left font-semibold">Jenis</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Item</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Batch/Lot</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Exp</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Qty</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Unit</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Konversi</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Qty Dasar</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Harga</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Diskon</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Subtotal</th>
                  <th className="px-2 py-1.5 text-center font-semibold w-16">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {form.items.map((it, idx) => (
                  <tr key={idx} className="border-t border-border/50 align-top">
                    <td className="px-1 py-1">
                      <Select value={it.item_type} onValueChange={v => { const m = getMaster(v, it.item_id); updateItem(idx, { item_type: v, item_id: '', ...snapshotItem(v, m) }); }}>
                        <SelectTrigger className="h-8 w-32 text-[11.5px]"><SelectValue /></SelectTrigger>
                        <SelectContent>{itemTypes.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="px-1 py-1">
                      {it.item_type === 'material' ? (
                        <Select value={it.item_id} onValueChange={v => onSelectItem(idx, 'material', v)}>
                          <SelectTrigger className="h-8 w-44 text-[11.5px]"><SelectValue placeholder="Pilih bahan" /></SelectTrigger>
                          <SelectContent className="max-h-60">{materials.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                        </Select>
                      ) : (
                        <Select value={it.item_id} onValueChange={v => onSelectItem(idx, it.item_type, v)}>
                          <SelectTrigger className="h-8 w-44 text-[11.5px]"><SelectValue placeholder="Pilih barang" /></SelectTrigger>
                          <SelectContent className="max-h-60">{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className="px-1 py-1"><Input value={it.batch_supplier} onChange={e => updateItem(idx, { batch_supplier: e.target.value })} placeholder="Batch" className="h-8 w-24 text-[11.5px]" /></td>
                    <td className="px-1 py-1"><Input type="date" value={it.expiry_date} onChange={e => updateItem(idx, { expiry_date: e.target.value })} className="h-8 w-32 text-[11.5px]" /></td>
                    <td className="px-1 py-1"><NumberInput value={it.quantity} onChange={v => updateItem(idx, { quantity: v })} allowDecimal min={0} className="h-8 w-16 text-right text-[11.5px]" /></td>
                    <td className="px-1 py-1"><Input value={it.unit} onChange={e => updateItem(idx, { unit: e.target.value })} placeholder="unit" className="h-8 w-16 text-[11.5px]" /></td>
                    <td className="px-1 py-1"><NumberInput value={it.conversion_factor} onChange={v => updateItem(idx, { conversion_factor: v })} allowDecimal min={0} className="h-8 w-16 text-right text-[11.5px]" /></td>
                    <td className="px-1 py-1 text-right tabular-nums text-[11.5px] text-muted-foreground">{(() => { const q = toNum(it.quantity); const c = toNum(it.conversion_factor) || 1; return q === null ? '—' : (q * c); })()}</td>
                    <td className="px-1 py-1"><NumberInput value={it.unit_price} onChange={v => updateItem(idx, { unit_price: v })} allowDecimal min={0} className="h-8 w-24 text-right text-[11.5px]" /></td>
                    <td className="px-1 py-1"><NumberInput value={it.discount} onChange={v => updateItem(idx, { discount: v })} allowDecimal min={0} className="h-8 w-20 text-right text-[11.5px]" /></td>
                    <td className="px-1 py-1 text-right tabular-nums font-medium text-[11.5px]">{fmtMoney(computeSubtotal(it))}</td>
                    <td className="px-1 py-1">
                      <div className="flex items-center justify-center gap-0.5">
                        <button type="button" onClick={() => duplicateRow(idx)} className="p-1 hover:bg-muted rounded" title="Duplikasi"><Plus className="w-3 h-3" /></button>
                        <button type="button" onClick={() => removeItemRow(idx)} className="p-1 hover:bg-red-50 rounded text-red-500" title="Hapus"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totals */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t border-border">
          <div><Label className="text-[12.5px] mb-1">Subtotal</Label><div className="text-[13px] font-semibold tabular-nums">{fmtMoney(totals.subtotal)}</div></div>
          <div><Label className="text-[12.5px] mb-1">Diskon Total</Label><NumberInput value={form.discount} onChange={v => setForm({ ...form, discount: v })} allowDecimal min={0} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Pajak</Label><NumberInput value={form.tax} onChange={v => setForm({ ...form, tax: v })} allowDecimal min={0} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Biaya Tambahan</Label><NumberInput value={form.additional_cost} onChange={v => setForm({ ...form, additional_cost: v })} allowDecimal min={0} className="h-9 text-[13px]" /></div>
        </div>
        <div className="flex items-center justify-between pt-2">
          <div className="text-[12.5px] text-muted-foreground">Grand Total</div>
          <div className="text-[16px] font-bold tabular-nums">{fmtMoney(totals.total)}</div>
        </div>
        <div><Label className="text-[12.5px] mb-1">Catatan</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="text-[13px]" /></div>
      </FormModal>

      {/* Detail modal */}
      <FormModal open={!!detailItem} onClose={() => setDetailItem(null)} title={detailItem ? `Detail ${detailItem.purchase_number}` : ''} onSubmit={() => setDetailItem(null)} submitLabel="Tutup">
        {detailItem && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-[12.5px]">
              <div><span className="text-muted-foreground">Supplier</span><div className="font-medium">{detailItem.supplier_name}</div></div>
              <div><span className="text-muted-foreground">Tanggal</span><div>{detailItem.purchase_date}</div></div>
              <div><span className="text-muted-foreground">Invoice Supplier</span><div>{detailItem.supplier_invoice_number || '—'}</div></div>
              <div><span className="text-muted-foreground">Gudang</span><div>{detailItem.warehouse_name}</div></div>
              <div><span className="text-muted-foreground">Metode</span><div>{pmLabel(detailItem.payment_method)}</div></div>
              <div><span className="text-muted-foreground">Jatuh Tempo</span><div>{detailItem.due_date || '—'}</div></div>
              <div><span className="text-muted-foreground">Status</span><div><StatusBadge status={detailItem.purchase_status} /></div></div>
              <div><span className="text-muted-foreground">Pembayaran</span><div><StatusBadge status={detailItem.payment_status} /></div></div>
              <div><span className="text-muted-foreground">Diposting oleh</span><div>{detailItem.posted_by || '—'}</div></div>
            </div>
            <DataTable columns={detailColumns} data={detailItems} searchable={false} pageSize={50} emptyMessage="Tidak ada item" />
            <div className="flex items-center justify-between border-t border-border pt-3">
              <div className="text-[12.5px] text-muted-foreground">Grand Total</div>
              <div className="text-[16px] font-bold tabular-nums">{fmtMoney(detailItem.total)}</div>
            </div>
            {detailItem.notes && <div className="text-[12px] text-muted-foreground bg-muted/30 rounded p-2"><span className="font-medium">Catatan: </span>{detailItem.notes}</div>}
          </div>
        )}
      </FormModal>
    </div>
  );
}