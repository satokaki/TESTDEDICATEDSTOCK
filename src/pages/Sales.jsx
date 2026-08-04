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
import { Plus, X, CheckCircle } from 'lucide-react';
import { generateInvoiceNumber } from '@/lib/sequence';
import { recordStockMovement, getAllStockBalances, createAuditLog } from '@/lib/stockUtils';
import NumberInput from '@/components/NumberInput';

export default function Sales() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [siapJualStock, setSiapJualStock] = useState([]);
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ customer_id: '', transaction_date: new Date().toISOString().slice(0, 10), payment_method: 'cash', payment_terms: 0, warehouse_id: '', sales_person: '', notes: '', items: [] });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [items, custs, balances, prods, whs] = await Promise.all([
        base44.entities.Sale.list('-created_date', 100),
        base44.entities.Customer.filter({ is_active: true }),
        getAllStockBalances('product'),
        base44.entities.Product.filter({ is_active: true }),
        base44.entities.Warehouse.filter({ is_active: true }),
      ]);
      setData(items);
      setCustomers(custs);
      setSiapJualStock(balances.filter(b => b.quantity > 0));
      setProducts(prods);
      setWarehouses(whs);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat data' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const subtotal = form.items.reduce((sum, i) => sum + (Number(i.quantity) * Number(i.price) - Number(i.discount || 0)), 0);
  const totalDiscount = form.items.reduce((sum, i) => sum + Number(i.discount || 0), 0);

  const openAdd = () => {
    const emptyCust = customers.length > 0 ? customers[0] : null;
    setForm({ customer_id: emptyCust?.id || '', transaction_date: new Date().toISOString().slice(0, 10), payment_method: 'cash', payment_terms: emptyCust?.default_payment_terms || 0, warehouse_id: '', sales_person: emptyCust?.sales_person || '', notes: '', items: [] });
    setModalOpen(true);
  };

  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { product_id: '', product_name: '', batch_number: '', quantity: 1, unit: 'unit', price: 0, discount: 0 }] }));
  const updateItem = (idx, field, value) => setForm(f => { const items = [...f.items]; if (field === 'product_id') { const p = products.find(x => x.id === value); const s = siapJualStock.find(x => x.item_id === value); items[idx] = { ...items[idx], product_id: value, product_name: p?.name || '', batch_number: s?.batch_number || '', price: p?.sale_price || 0 }; } else { items[idx] = { ...items[idx], [field]: value }; } return { ...f, items }; });
  const removeItem = (idx) => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  const handleSubmit = async () => {
    if (!form.customer_id || form.items.length === 0) { toast({ variant: 'destructive', title: 'Customer dan item wajib diisi' }); return; }
    // Check stock
    for (const item of form.items) {
      const stock = siapJualStock.find(s => s.item_id === item.product_id);
      if (stock && Number(item.quantity) > stock.available_quantity) {
        toast({ variant: 'destructive', title: `Stok ${item.product_name} tidak mencukupi`, description: `Tersedia: ${stock.available_quantity}` });
        return;
      }
    }
    setSubmitting(true);
    try {
      const customer = customers.find(c => c.id === form.customer_id);
      const invNumber = await generateInvoiceNumber();
      const dueDate = form.payment_method === 'tempo'
        ? new Date(new Date(form.transaction_date).getTime() + Number(form.payment_terms) * 86400000).toISOString().slice(0, 10)
        : '';
      const total = subtotal;
      const remaining = form.payment_method === 'tempo' ? total : 0;
      const sale = await base44.entities.Sale.create({
        invoice_number: invNumber,
        transaction_date: form.transaction_date,
        customer_id: form.customer_id, customer_name: customer?.name || '',
        sales_person: form.sales_person,
        warehouse_id: form.warehouse_id, warehouse_name: warehouses.find(w => w.id === form.warehouse_id)?.name || '',
        payment_method: form.payment_method, payment_terms: Number(form.payment_terms),
        due_date: dueDate,
        subtotal, discount: totalDiscount, tax: 0, total, total_payment: total - remaining,
        remaining_receivable: remaining,
        transaction_status: 'posted',
        payment_status: form.payment_method === 'tempo' ? 'belum_dibayar' : 'lunas',
        notes: form.notes,
      });
      // Create sale items
      await base44.entities.SaleItem.bulkCreate(form.items.map(i => ({
        sale_id: sale.id, product_id: i.product_id, product_name: i.product_name,
        batch_number: i.batch_number, quantity: Number(i.quantity), unit: i.unit,
        price: Number(i.price), discount: Number(i.discount || 0),
        subtotal: Number(i.quantity) * Number(i.price) - Number(i.discount || 0),
      })));
      // Reduce stock for each item
      for (const item of form.items) {
        const stock = siapJualStock.find(s => s.item_id === item.product_id);
        const prod = products.find(p => p.id === item.product_id);
        await recordStockMovement({
          item_type: 'product', item_id: item.product_id, item_name: item.product_name, item_code: prod?.code || '',
          batch_id: stock?.batch_id || '', batch_number: stock?.batch_number || '',
          quantity_out: Number(item.quantity), unit: 'unit',
          transaction_type: 'sales', transaction_number: invNumber,
          reference_type: 'sale', reference_id: sale.id,
          notes: `Penjualan ${invNumber}`,
        });
      }
      await createAuditLog({ module: 'Penjualan', action: 'Posting', entity_type: 'Sale', entity_id: sale.id, reference_number: invNumber });
      toast({ title: 'Penjualan berhasil diposting', description: invNumber });
      setModalOpen(false); loadData();
    } catch (e) { toast({ variant: 'destructive', title: 'Gagal menyimpan', description: e.message }); }
    finally { setSubmitting(false); }
  };

  const fmtMoney = (v) => 'Rp ' + (v || 0).toLocaleString('id-ID');

  const columns = [
    { key: 'invoice_number', header: 'No. Invoice', sortable: true, className: 'font-mono font-medium' },
    { key: 'transaction_date', header: 'Tanggal', sortable: true },
    { key: 'customer_name', header: 'Customer', sortable: true, className: 'font-medium' },
    { key: 'payment_method', header: 'Metode', render: (row) => <span className="text-[11px] px-2 py-0.5 bg-muted rounded uppercase">{row.payment_method}</span> },
    { key: 'total', header: 'Total', render: (row) => <span className="tabular-nums">{fmtMoney(row.total)}</span> },
    { key: 'remaining_receivable', header: 'Sisa Piutang', render: (row) => row.remaining_receivable > 0 ? <span className="text-red-600 tabular-nums">{fmtMoney(row.remaining_receivable)}</span> : <span className="text-emerald-600">Lunas</span> },
    { key: 'transaction_status', header: 'Status', render: (row) => <StatusBadge status={row.transaction_status} /> },
    { key: 'payment_status', header: 'Pembayaran', render: (row) => <StatusBadge status={row.payment_status} /> },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader title="Penjualan" description="Penjualan barang siap jual"
        actions={<Button onClick={openAdd} size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> Penjualan Baru</Button>} />
      <DataTable columns={columns} data={data} loading={loading} emptyMessage="Belum ada penjualan" searchKeys={['invoice_number', 'customer_name']} searchPlaceholder="Cari penjualan..." />

      <FormModal open={modalOpen} onClose={() => setModalOpen(false)} title="Penjualan Baru" onSubmit={handleSubmit} submitting={submitting} submitLabel="Posting Penjualan" size="xl">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-[12.5px] mb-1">Customer *</Label>
            <Select value={form.customer_id} onValueChange={v => { const c = customers.find(x => x.id === v); setForm({ ...form, customer_id: v, sales_person: c?.sales_person || '', payment_terms: c?.default_payment_terms || 0 }); }}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Pilih customer" /></SelectTrigger>
              <SelectContent>{customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-[12.5px] mb-1">Tanggal</Label><Input type="date" value={form.transaction_date} onChange={e => setForm({ ...form, transaction_date: e.target.value })} className="h-9 text-[13px]" /></div>
          <div>
            <Label className="text-[12.5px] mb-1">Metode Pembayaran</Label>
            <Select value={form.payment_method} onValueChange={v => setForm({ ...form, payment_method: v })}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="transfer">Transfer</SelectItem>
                <SelectItem value="tempo">Tempo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-[12.5px] mb-1">Sales</Label><Input value={form.sales_person} onChange={e => setForm({ ...form, sales_person: e.target.value })} className="h-9 text-[13px]" /></div>
          <div>
            <Label className="text-[12.5px] mb-1">Gudang</Label>
            <Select value={form.warehouse_id} onValueChange={v => setForm({ ...form, warehouse_id: v })}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Pilih gudang" /></SelectTrigger>
              <SelectContent>{warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {form.payment_method === 'tempo' && (
            <div><Label className="text-[12.5px] mb-1">Termin (hari)</Label><NumberInput value={form.payment_terms} onChange={v => setForm({ ...form, payment_terms: v })} allowDecimal={false} min={0} className="h-9 text-[13px]" /></div>
          )}
        </div>

        <div className="border-t pt-3">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-[12.5px] font-semibold">Detail Penjualan</Label>
            <Button type="button" onClick={addItem} size="sm" variant="outline" className="h-7 text-[12px] gap-1"><Plus className="w-3.5 h-3.5" /> Tambah Item</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11.5px]">
              <thead><tr className="bg-muted/40 text-muted-foreground">
                <th className="px-2 py-1 text-left">Produk</th>
                <th className="px-2 py-1 text-right w-20">Jumlah</th>
                <th className="px-2 py-1 text-right w-28">Harga</th>
                <th className="px-2 py-1 text-right w-24">Diskon</th>
                <th className="px-2 py-1 text-right w-28">Subtotal</th>
                <th className="w-8"></th>
              </tr></thead>
              <tbody>
                {form.items.length === 0 && <tr><td colSpan={6} className="text-center py-3 text-muted-foreground">Belum ada item</td></tr>}
                {form.items.map((item, idx) => (
                  <tr key={idx} className="border-b border-border/30">
                    <td className="px-2 py-1">
                      <Select value={item.product_id} onValueChange={v => updateItem(idx, 'product_id', v)}>
                        <SelectTrigger className="h-7 text-[11.5px]"><SelectValue placeholder="Pilih produk" /></SelectTrigger>
                        <SelectContent>
                          {siapJualStock.map(s => { const p = products.find(p => p.id === s.item_id); return <SelectItem key={s.item_id} value={s.item_id}>{s.item_name} ({s.available_quantity})</SelectItem>; })}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1"><NumberInput value={item.quantity} onChange={v => updateItem(idx, 'quantity', v)} allowDecimal={false} min={0} className="h-7 text-[11.5px] text-right" /></td>
                    <td className="px-2 py-1"><NumberInput value={item.price} onChange={v => updateItem(idx, 'price', v)} allowDecimal min={0} className="h-7 text-[11.5px] text-right" /></td>
                    <td className="px-2 py-1"><NumberInput value={item.discount} onChange={v => updateItem(idx, 'discount', v)} allowDecimal min={0} className="h-7 text-[11.5px] text-right" /></td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(Number(item.quantity) * Number(item.price) - Number(item.discount || 0))}</td>
                    <td className="px-1 py-1"><button type="button" onClick={() => removeItem(idx)} className="p-0.5 hover:bg-red-50 rounded text-red-500"><X className="w-3.5 h-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-4 mt-2 text-[12px]">
            <span>Subtotal: <b>{fmtMoney(subtotal)}</b></span>
            <span>Diskon: <b>{fmtMoney(totalDiscount)}</b></span>
            <span className="text-primary">Total: <b>{fmtMoney(subtotal)}</b></span>
          </div>
        </div>
        <div><Label className="text-[12.5px] mb-1">Catatan</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="text-[13px]" /></div>
      </FormModal>
    </div>
  );
}