import React, { useState } from 'react';
import { Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  LayoutDashboard, FlaskConical, Factory, Package, Tag, Stamp,
  ShoppingCart, Wallet, ClipboardList, FileBarChart, Database,
  Settings, ChevronDown, Menu, X, LogOut, Bell, Search, UserCog
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/permissions';
import { roleLabel } from '@/lib/roles';

const menuItems = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/', group: 'utama', perm: 'dashboard' },
  { label: 'Resep', icon: FlaskConical, path: '/recipes', group: 'operasional', perm: 'recipes' },
  { label: 'Produksi', icon: Factory, path: '/production', group: 'operasional', perm: 'production' },
  { label: 'Bottling', icon: Package, path: '/bottling', group: 'operasional', perm: 'bottling' },
  { label: 'Labeling', icon: Tag, path: '/labeling', group: 'operasional', perm: 'labeling' },
  { label: 'Proses Cukai', icon: Stamp, path: '/excise', group: 'operasional', perm: 'excise' },
  { label: 'Pembelian', icon: Package, path: '/purchases', group: 'operasional', perm: 'purchases' },
  { label: 'Penjualan', icon: ShoppingCart, path: '/sales', group: 'operasional', perm: 'sales' },
  { label: 'Pembayaran Piutang', icon: Wallet, path: '/payments', group: 'operasional', perm: 'payments' },
  { label: 'Kartu Stok', icon: ClipboardList, path: '/stock-card', group: 'operasional', perm: 'stock_card' },
  { label: 'Laporan Penjualan', icon: FileBarChart, path: '/reports/sales', group: 'laporan', perm: 'report_sales' },
  { label: 'Laporan Piutang', icon: FileBarChart, path: '/reports/receivables', group: 'laporan', perm: 'report_receivables' },
  { label: 'Traceability Batch', icon: Search, path: '/traceability', group: 'laporan', perm: 'traceability' },
];

const masterItems = [
  { label: 'Merk', path: '/master/brands' },
  { label: 'Kategori', path: '/master/categories' },
  { label: 'Supplier', path: '/master/suppliers' },
  { label: 'Customer', path: '/master/customers' },
  { label: 'Bahan', path: '/master/materials' },
  { label: 'Barang', path: '/master/products' },
  { label: 'Gudang', path: '/master/warehouses' },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [masterOpen, setMasterOpen] = useState(
    location.pathname.startsWith('/master')
  );

  const handleLogout = async () => {
    await base44.auth.logout();
  };

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const canSee = (perm) => hasPermission(user, perm, 'view');
  const filteredMenu = (group) => menuItems.filter((i) => i.group === group && canSee(i.perm));

  const NavLink = ({ item }) => {
    const Icon = item.icon;
    return (
      <Link
        to={item.path}
        onClick={() => setSidebarOpen(false)}
        className={cn(
          'flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-colors',
          isActive(item.path)
            ? 'bg-primary text-primary-foreground'
            : 'text-sidebar-foreground hover:bg-sidebar-accent'
        )}
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span>{item.label}</span>
      </Link>
    );
  };

  const initial = (user?.full_name || user?.email || 'A').charAt(0).toUpperCase();

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed lg:static inset-y-0 left-0 z-50 w-60 bg-sidebar border-r border-sidebar-border flex flex-col transition-transform duration-200',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className="h-14 flex items-center px-4 border-b border-sidebar-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <FlaskConical className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <div className="font-heading font-bold text-[15px] leading-none tracking-tight">LAB PRO</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">E-Liquid Management</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-0.5">
          {filteredMenu('utama').map((item) => <NavLink key={item.path} item={item} />)}

          {filteredMenu('operasional').length > 0 && (
            <>
              <div className="pt-3 pb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Operasional</div>
              {filteredMenu('operasional').map((item) => <NavLink key={item.path} item={item} />)}
            </>
          )}

          {filteredMenu('laporan').length > 0 && (
            <>
              <div className="pt-3 pb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Laporan</div>
              {filteredMenu('laporan').map((item) => <NavLink key={item.path} item={item} />)}
            </>
          )}

          {canSee('master') && (
            <>
              <div className="pt-3 pb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Master Data</div>
              <button
                onClick={() => setMasterOpen(!masterOpen)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
              >
                <Database className="w-4 h-4 shrink-0" />
                <span className="flex-1 text-left">Master Data</span>
                <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', masterOpen && 'rotate-180')} />
              </button>
              {masterOpen && (
                <div className="space-y-0.5 pl-4">
                  {masterItems.map((item) => (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setSidebarOpen(false)}
                      className={cn(
                        'flex items-center gap-2 px-3 py-1.5 rounded-md text-[12.5px] transition-colors',
                        isActive(item.path)
                          ? 'bg-primary/10 text-primary font-semibold'
                          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent'
                      )}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="pt-3 pb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Sistem</div>
          {canSee('users') && (
            <Link
              to="/users"
              onClick={() => setSidebarOpen(false)}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-colors',
                isActive('/users') ? 'bg-primary text-primary-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent'
              )}
            >
              <UserCog className="w-4 h-4 shrink-0" />
              <span>Pengguna & Akses</span>
            </Link>
          )}
          {canSee('settings') && (
            <Link
              to="/settings"
              onClick={() => setSidebarOpen(false)}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-colors',
                isActive('/settings') ? 'bg-primary text-primary-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent'
              )}
            >
              <Settings className="w-4 h-4 shrink-0" />
              <span>Pengaturan</span>
            </Link>
          )}
        </nav>
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-14 border-b border-border bg-white flex items-center px-4 gap-3 shrink-0">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-1.5 hover:bg-muted rounded-md"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <div className="flex-1 max-w-md">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Cari..."
                className="w-full h-9 pl-9 pr-3 text-[13px] bg-muted/60 border border-transparent rounded-md focus:bg-white focus:border-border outline-none transition-colors"
              />
            </div>
          </div>

          <button className="p-2 hover:bg-muted rounded-md relative">
            <Bell className="w-4 h-4 text-muted-foreground" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
          </button>

          <div className="flex items-center gap-2.5 pl-3 border-l border-border">
            <div className="text-right hidden sm:block">
              <div className="text-[12.5px] font-semibold leading-none">{user?.full_name || 'Pengguna'}</div>
              <div className="text-[10.5px] text-muted-foreground mt-0.5">{roleLabel(user?.role)}</div>
            </div>
            <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[12px] font-bold">{initial}</div>
            <button onClick={handleLogout} className="p-2 hover:bg-muted rounded-md" title="Logout">
              <LogOut className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}