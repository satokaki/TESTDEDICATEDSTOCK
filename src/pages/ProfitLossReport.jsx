import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TrendingUp, Wallet, Receipt, Percent, Download } from 'lucide-react';
import { computeProductHpp } from '@/lib/hppCalculator';
import { formatCurrency as fmtMoney } from '@/lib/format';

const fmtPct = (v) => (Number(v) || 0).toFixed(1) + '%';

function MiniKpi({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-white border border-border rounded-lg p-3.5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{label}</div>
          <div className="text-lg font-bold mt-1 tabular-nums">{value}</div>
        </div>
        <div className={`w-9 h-9 rounded-md flex items-center justify-center ${color}`}>
          <Icon className="w-4.5 h-4.5" />
        </div>
      </div>
    </div>
  );
}

export default function ProfitLossReport() {
  const { toast } = useToast();
  const [sales, setSales] = useState([]);
  const [saleItems, setSaleItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [allIngredients, setAllIngredients] = useState([]);
  const [allMappings, setAllMappings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ date_from: '', date_to: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, si, p, m, r, ri, pm] = await Promise.all([
        base44.entities.Sale.list('-created_date', 1000),
        base44.entities.SaleItem.list('-created_date', 2000),
        base44.entities.Product.list('-created_date', 500),
        base44.entities.Material.list('-created_date', 500),
        base44.entities.Recipe.list('-created_date', 500),
        base44.entities.RecipeIngredient.list('-created_date', 2000),
        base44.entities.ProductComponentMapping.list('-created_date', 1000),
      ]);
      setSales(s);
      setSaleItems(si);
      setProducts(p);
      setMaterials(m);
      setRecipes(r);
      setAllIngredients(ri);
      setAllMappings(pm);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat data laporan' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const hppByProduct = useMemo(() => {
    const pgMaterial = materials.find((m) => m.material_category === 'propylene_glycol');
    const vgMaterial = materials.find((m) => m.material_category === 'vegetable_glycerin');
    const map = {};
    const finishedRecipes = recipes.filter((r) => r.recipe_type === 'FINISHED_PRODUCT');
    products.forEach((product) => {
      const recs = finishedRecipes.filter((r) => r.product_id === product.id);
      const approved = recs.filter((r) => r.status === 'approved').sort((a, b) => (b.version || 0) - (a.version || 0));
      const rec = approved[0] || recs.sort((a, b) => (b.version || 0) - (a.version || 0))[0] || null;
      const ings = rec ? allIngredients.filter((i) => i.recipe_id === rec.id) : [];
      const maps = allMappings.filter((mm) => mm.product_id === product.id && mm.is_active !== false);
      const hpp = computeProductHpp({ product, recipe: rec, ingredients: ings, materials, mappings: maps, pgMaterial, vgMaterial });
      map[product.id] = hpp ? hpp.hppPerBottle : 0;
    });
    return map;
  }, [products, materials, recipes, allIngredients, allMappings]);

  const rows = useMemo(() => {
    const itemsBySale = {};
    saleItems.forEach((it) => {
      if (!itemsBySale[it.sale_id]) itemsBySale[it.sale_id] = [];
      itemsBySale[it.sale_id].push(it);
    });
    return sales
      .filter((s) => s.transaction_status !== 'draft' && s.transaction_status !== 'cancelled')
      .filter((s) => {
        if (filters.date_from && s.transaction_date < filters.date_from) return false;
        if (filters.date_to && s.transaction_date > filters.date_to) return false;
        return true;
      })
      .map((s) => {
        const items = itemsBySale[s.id] || [];
        const qty = items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
        const hpp = items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (hppByProduct[it.product_id] || 0), 0);
        const revenue = Number(s.total) || 0;
        const laba = revenue - hpp;
        const margin = revenue > 0 ? (laba / revenue) * 100 : 0;
        return {
          invoice_number: s.invoice_number,
          transaction_date: s.transaction_date,
          customer_name: s.customer_name,
          qty,
          revenue,
          hpp,
          laba,
          margin,
          payment_status: s.payment_status,
        };
      });
  }, [sales, saleItems, hppByProduct, filters]);

  const summary = useMemo(() => {
    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    const hpp = rows.reduce((s, r) => s + r.hpp, 0);
    const laba = revenue - hpp;
    const margin = revenue > 0 ? (laba / revenue) * 100 : 0;
    return { revenue, hpp, laba, margin, count: rows.length };
  }, [rows]);

  const exportCSV = () => {
    const headers = ['No. Invoice', 'Tanggal', 'Customer', 'Qty', 'Pendapatan', 'HPP', 'Laba Kotor', 'Margin %', 'Status'];
    const csv = [headers, ...rows.map((r) => [
      r.invoice_number, r.transaction_date, r.customer_name, r.qty,
      r.revenue, r.hpp, r.laba, r.margin.toFixed(1), r.payment_status,
    ])].map((row) => row.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `laporan-laba-rugi-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Laporan laba rugi diexport' });
  };

  const columns = [
    { key: 'invoice_number', header: 'No. Invoice', sortable: true, className: 'font-mono font-medium' },
    { key: 'transaction_date', header: 'Tanggal', sortable: true },
    { key: 'customer_name', header: 'Customer', sortable: true, className: 'font-medium' },
    { key: 'qty', header: 'Qty', sortable: true, render: (r) => <span className="tabular-nums">{r.qty}</span> },
    { key: 'revenue', header: 'Pendapatan', sortable: true, render: (r) => <span className="tabular-nums">{fmtMoney(r.revenue)}</span> },
    { key: 'hpp', header: 'HPP', render: (r) => <span className="tabular-nums text-amber-600">{fmtMoney(r.hpp)}</span> },
    { key: 'laba', header: 'Laba Kotor', sortable: true, render: (r) => <span className={`tabular-nums font-medium ${r.laba >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtMoney(r.laba)}</span> },
    { key: 'margin', header: 'Margin', render: (r) => <span className="tabular-nums">{fmtPct(r.margin)}</span> },
    { key: 'payment_status', header: 'Status', render: (r) => <span className="text-[11.5px] px-2 py-0.5 rounded bg-muted">{r.payment_status}</span> },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader
        title="Laporan Laba Rugi"
        description="Pendapatan vs HPP per invoice dengan ringkasan laba kotor (admin only)"
        actions={<Button onClick={exportCSV} size="sm" variant="outline" className="gap-1.5"><Download className="w-4 h-4" /> Export CSV</Button>}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <MiniKpi icon={Receipt} label="Pendapatan" value={fmtMoney(summary.revenue)} color="bg-emerald-50 text-emerald-600" />
        <MiniKpi icon={Wallet} label="Total HPP" value={fmtMoney(summary.hpp)} color="bg-amber-50 text-amber-600" />
        <MiniKpi icon={TrendingUp} label="Laba Kotor" value={fmtMoney(summary.laba)} color={summary.laba >= 0 ? 'bg-teal-50 text-teal-600' : 'bg-red-50 text-red-600'} />
        <MiniKpi icon={Percent} label="Margin" value={fmtPct(summary.margin)} color="bg-indigo-50 text-indigo-600" />
      </div>

      <div className="bg-white border border-border rounded-lg p-3 mb-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div>
          <Label className="text-[11px] mb-1">Dari Tanggal</Label>
          <Input type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} className="h-8 text-[12px]" />
        </div>
        <div>
          <Label className="text-[11px] mb-1">Sampai Tanggal</Label>
          <Input type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} className="h-8 text-[12px]" />
        </div>
        <div className="flex items-end">
          <div className="text-[12px] text-muted-foreground">{summary.count} invoice</div>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        emptyMessage="Belum ada data penjualan"
        searchKeys={['invoice_number', 'customer_name']}
        searchPlaceholder="Cari invoice / customer..."
      />
    </div>
  );
}