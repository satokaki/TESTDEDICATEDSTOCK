import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  FlaskConical, Factory, Package, Tag, Stamp, ShoppingCart, Wallet,
  ClipboardList, AlertTriangle, TrendingUp, Users, Boxes, Activity
} from 'lucide-react';
import { loadInventoryCostContext, resolveBalanceUnitCost } from '@/lib/inventoryCost';
import { formatCurrency as fmtMoney } from '@/lib/format';
import { useAuth } from '@/lib/AuthContext';

function KpiCard({ icon: Icon, label, value, color, onClick }) {
  return (
    <div
      onClick={onClick}
      className={`bg-white border border-border rounded-lg p-3.5 ${onClick ? 'cursor-pointer hover:border-primary/40 hover:shadow-sm transition-all' : ''}`}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{label}</div>
          <div className="text-xl font-bold mt-1 tabular-nums">{value}</div>
        </div>
        <div className={`w-9 h-9 rounded-md flex items-center justify-center ${color}`}>
          <Icon className="w-4.5 h-4.5" />
        </div>
      </div>
    </div>
  );
}

function QuickAction({ icon: Icon, label, path, color }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(path)}
      className="flex items-center gap-2.5 px-3 py-2.5 bg-white border border-border rounded-lg hover:border-primary/40 hover:shadow-sm transition-all text-left w-full"
    >
      <div className={`w-8 h-8 rounded-md flex items-center justify-center ${color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <span className="text-[12.5px] font-semibold">{label}</span>
    </button>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [stats, setStats] = useState({
    activeMaterials: 0,
    lowStockMaterials: 0,
    activeProduction: 0,
    waitingMaterials: 0,
    siapBottling: 0,
    siapLabeling: 0,
    belumCukai: 0,
    siapJual: 0,
    salesToday: 0,
    salesMonth: 0,
    totalPiutang: 0,
    piutangJatuhTempo: 0,
  });
  const [recentActivity, setRecentActivity] = useState([]);
  const [inventoryValue, setInventoryValue] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, currentUser?.role]);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const isAdmin = currentUser?.role === 'admin';
      const auditQuery = isAdmin
        ? base44.entities.AuditLog.list('-created_date', 10)
        : base44.entities.AuditLog.filter({ created_by_id: currentUser?.id }, '-created_date', 10);
      const [materials, productions, bottling, labeling, excise, products, sales, audit, balances, costCtx] = await Promise.all([
        base44.entities.Material.list(),
        base44.entities.ProductionOrder.list(),
        base44.entities.BottlingOrder.list(),
        base44.entities.LabelingOrder.list(),
        base44.entities.ExciseOrder.list(),
        base44.entities.Product.list(),
        base44.entities.Sale.list('-created_date', 50),
        auditQuery.catch(() => []),
        base44.entities.StockBalance.list('-updated_date', 1000).catch(() => []),
        loadInventoryCostContext().catch(() => null),
      ]);

      const today = new Date().toISOString().slice(0, 10);
      const monthPrefix = today.slice(0, 7);

      const salesToday = sales.filter(s => s.transaction_date?.startsWith(today) && s.transaction_status === 'posted').reduce((sum, s) => sum + (s.total || 0), 0);
      const salesMonth = sales.filter(s => s.transaction_date?.startsWith(monthPrefix) && s.transaction_status === 'posted').reduce((sum, s) => sum + (s.total || 0), 0);
      const totalPiutang = sales.filter(s => s.transaction_status === 'posted').reduce((sum, s) => sum + (s.remaining_receivable || 0), 0);

      setStats({
        activeMaterials: materials.filter(m => m.is_active).length,
        lowStockMaterials: 0,
        activeProduction: productions.filter(p => ['sedang_diproses', 'siap_produksi'].includes(p.status)).length,
        waitingMaterials: productions.filter(p => p.status === 'menunggu_bahan').length,
        siapBottling: productions.filter(p => p.status === 'siap_bottling').length,
        siapLabeling: labeling.filter(l => l.status === 'siap_labeling').length,
        belumCukai: labeling.filter(l => l.status === 'belum_cukai').length,
        siapJual: products.filter(p => p.product_type === 'barang_siap_jual').length,
        salesToday,
        salesMonth,
        totalPiutang,
        piutangJatuhTempo: 0,
      });
      if (costCtx) {
        const invVal = balances.reduce(
          (s, b) => s + (Number(b.quantity) || 0) * resolveBalanceUnitCost(b, { materialById: costCtx.materialById, stageCostIndex: costCtx.stageCostIndex }),
          0
        );
        setInventoryValue(invVal);
      }
      setRecentActivity(audit);
    } catch (e) {
      console.error('Dashboard load error', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <div className="mb-5">
        <h1 className="font-heading text-xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-[13px] text-muted-foreground mt-0.5">Ringkasan operasional LAB PRO</p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-5">
        <KpiCard icon={Boxes} label="Bahan Aktif" value={stats.activeMaterials} color="bg-blue-50 text-blue-600" onClick={() => navigate('/master/materials')} />
        <KpiCard icon={AlertTriangle} label="Stok Minimum" value={stats.lowStockMaterials} color="bg-red-50 text-red-600" />
        <KpiCard icon={Factory} label="Produksi Aktif" value={stats.activeProduction} color="bg-indigo-50 text-indigo-600" onClick={() => navigate('/production')} />
        <KpiCard icon={AlertTriangle} label="Menunggu Bahan" value={stats.waitingMaterials} color="bg-amber-50 text-amber-600" />
        <KpiCard icon={Package} label="Siap Bottling" value={stats.siapBottling} color="bg-violet-50 text-violet-600" onClick={() => navigate('/bottling')} />
        <KpiCard icon={Tag} label="Siap Labeling" value={stats.siapLabeling} color="bg-purple-50 text-purple-600" onClick={() => navigate('/labeling')} />
        <KpiCard icon={Stamp} label="Belum Cukai" value={stats.belumCukai} color="bg-orange-50 text-orange-600" onClick={() => navigate('/excise')} />
        <KpiCard icon={TrendingUp} label="Siap Jual" value={stats.siapJual} color="bg-emerald-50 text-emerald-600" />
        <KpiCard icon={Wallet} label="Nilai Persediaan" value={fmtMoney(inventoryValue)} color="bg-emerald-50 text-emerald-600" onClick={() => navigate('/reports/inventory')} />
      </div>

      {/* Sales KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiCard icon={ShoppingCart} label="Penjualan Hari Ini" value={fmtMoney(stats.salesToday)} color="bg-emerald-50 text-emerald-600" onClick={() => navigate('/sales')} />
        <KpiCard icon={TrendingUp} label="Penjualan Bulan Ini" value={fmtMoney(stats.salesMonth)} color="bg-teal-50 text-teal-600" />
        <KpiCard icon={Wallet} label="Total Piutang" value={fmtMoney(stats.totalPiutang)} color="bg-cyan-50 text-cyan-600" onClick={() => navigate('/reports/receivables')} />
        <KpiCard icon={AlertTriangle} label="Piutang Jatuh Tempo" value={fmtMoney(stats.piutangJatuhTempo)} color="bg-red-50 text-red-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Quick Actions */}
        <div className="lg:col-span-2">
          <div className="bg-white border border-border rounded-lg p-4">
            <h2 className="text-[13px] font-bold mb-3 flex items-center gap-1.5">
              <Activity className="w-4 h-4" /> Shortcut Operasional
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <QuickAction icon={Factory} label="Produksi Baru" path="/production" color="bg-indigo-50 text-indigo-600" />
              <QuickAction icon={Package} label="Bottling" path="/bottling" color="bg-violet-50 text-violet-600" />
              <QuickAction icon={Tag} label="Labeling" path="/labeling" color="bg-purple-50 text-purple-600" />
              <QuickAction icon={Stamp} label="Proses Cukai" path="/excise" color="bg-orange-50 text-orange-600" />
              <QuickAction icon={ShoppingCart} label="Penjualan Baru" path="/sales" color="bg-emerald-50 text-emerald-600" />
              <QuickAction icon={Wallet} label="Pembayaran Piutang" path="/payments" color="bg-cyan-50 text-cyan-600" />
              <QuickAction icon={ClipboardList} label="Kartu Stok" path="/stock-card" color="bg-slate-100 text-slate-600" />
              <QuickAction icon={FlaskConical} label="Resep" path="/recipes" color="bg-blue-50 text-blue-600" />
            </div>
          </div>

          {/* Recent Activity */}
          <div className="bg-white border border-border rounded-lg p-4 mt-4">
            <h2 className="text-[13px] font-bold mb-3 flex items-center gap-1.5">
              <Activity className="w-4 h-4" /> Aktivitas Terbaru
            </h2>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-8 bg-muted/50 rounded animate-pulse" />
                ))}
              </div>
            ) : recentActivity.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-[13px]">Belum ada aktivitas terbaru</div>
            ) : (
              <div className="space-y-1.5">
                {recentActivity.map(log => (
                  <div key={log.id} className="flex items-center gap-2.5 px-2 py-2 hover:bg-muted/30 rounded text-[12px]">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{log.action}</span>
                      <span className="text-muted-foreground"> · {log.module}</span>
                      {log.reference_number && <span className="text-muted-foreground"> · {log.reference_number}</span>}
                    </div>
                    <span className="text-muted-foreground text-[11px] whitespace-nowrap">{log.user_name || '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Side stats */}
        <div className="space-y-4">
          <div className="bg-white border border-border rounded-lg p-4">
            <h2 className="text-[13px] font-bold mb-3">Status Operasional</h2>
            <div className="space-y-2.5">
              {[
                { label: 'Siap Bottling', value: stats.siapBottling, color: 'bg-violet-500' },
                { label: 'Siap Labeling', value: stats.siapLabeling, color: 'bg-purple-500' },
                { label: 'Belum Cukai', value: stats.belumCukai, color: 'bg-orange-500' },
                { label: 'Siap Jual', value: stats.siapJual, color: 'bg-emerald-500' },
              ].map(item => (
                <div key={item.label} className="flex items-center justify-between text-[12.5px]">
                  <span className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${item.color}`} />
                    {item.label}
                  </span>
                  <span className="font-bold tabular-nums">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-border rounded-lg p-4">
            <h2 className="text-[13px] font-bold mb-3 flex items-center gap-1.5">
              <Users className="w-4 h-4" /> Quick Info
            </h2>
            <div className="space-y-2 text-[12px] text-muted-foreground">
              <p>Sistem: LAB PRO v1.0</p>
              <p>Mode: Industrial Operations</p>
              <p>Tanggal: {new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}