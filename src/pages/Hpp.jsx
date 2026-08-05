import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import SearchableSelect from '@/components/SearchableSelect';
import { Label } from '@/components/ui/label';
import { Calculator, AlertTriangle, FlaskConical, Package, Tag, Stamp, TrendingUp, Box } from 'lucide-react';
import { computeProductHpp } from '@/lib/hppCalculator';
import { formatCurrency as fmtMoney } from '@/lib/format';

const FINISHED_TYPES = ['barang_siap_jual', 'barang_belum_cukai', 'barang_siap_labeling', 'barang_siap_bottling'];

const fmtQty = (n, u) => `${(Number(n) || 0).toLocaleString('id-ID', { maximumFractionDigits: 3 })}${u ? ' ' + u : ''}`;

function StageCard({ icon: Icon, title, subtitle, rows, subtotal, perBottleNote, color }) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border bg-muted/40">
        <Icon className={`w-4 h-4 ${color}`} />
        <div className="flex-1">
          <div className="text-[13px] font-semibold leading-tight">{title}</div>
          {subtitle && <div className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</div>}
        </div>
        <div className="text-right">
          <div className="text-[12px] text-muted-foreground">Subtotal</div>
          <div className="text-[13px] font-semibold tabular-nums">{fmtMoney(subtotal)}</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="px-3.5 py-3 text-[12px] text-muted-foreground italic">Belum ada komponen terpetakan.</div>
      ) : (
        <table className="w-full text-[12.5px]">
          <thead className="text-[11px] text-muted-foreground bg-muted/20">
            <tr>
              <th className="text-left font-medium px-3.5 py-1.5">Komponen</th>
              <th className="text-right font-medium px-2 py-1.5">Qty</th>
              <th className="text-right font-medium px-2 py-1.5">Harga Satuan</th>
              <th className="text-right font-medium px-3.5 py-1.5">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border/60">
                <td className="px-3.5 py-1.5">
                  <div className="font-medium leading-tight">{r.materialName}</div>
                  <div className="text-[10.5px] text-muted-foreground font-mono">{r.materialCode || '—'}{r.isAuto && ' · auto'}</div>
                </td>
                <td className="text-right px-2 py-1.5 tabular-nums">{fmtQty(r.qty, r.unitLabel)}</td>
                <td className="text-right px-2 py-1.5 tabular-nums text-muted-foreground">{fmtMoney(r.unitCost)}</td>
                <td className="text-right px-3.5 py-1.5 tabular-nums font-medium">{fmtMoney(r.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {perBottleNote && (
        <div className="px-3.5 py-1.5 border-t border-border/60 bg-muted/20 text-[11.5px] text-muted-foreground">{perBottleNote}</div>
      )}
    </div>
  );
}

export default function Hpp() {
  const { toast } = useToast();
  const [products, setProducts] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [recipe, setRecipe] = useState(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [productId, setProductId] = useState('');

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    try {
      const [prods, mats, recs] = await Promise.all([
        base44.entities.Product.list('-created_date', 500),
        base44.entities.Material.list('-created_date', 500),
        base44.entities.Recipe.list('-created_date', 500),
      ]);
      setProducts(prods);
      setMaterials(mats);
      setRecipes(recs.filter((r) => r.recipe_type === 'FINISHED_PRODUCT'));
    } catch {
      toast({ variant: 'destructive', title: 'Gagal memuat data' });
    } finally {
      setLoadingMeta(false);
    }
  }, [toast]);

  useEffect(() => { loadMeta(); }, [loadMeta]);

  const product = products.find((p) => p.id === productId);

  useEffect(() => {
    if (!product) { setRecipe(null); setIngredients([]); setMappings([]); return; }
    let alive = true;
    (async () => {
      const recs = recipes.filter((r) => r.product_id === product.id);
      const approved = recs.filter((r) => r.status === 'approved').sort((a, b) => (b.version || 0) - (a.version || 0));
      const rec = approved[0] || recs.sort((a, b) => (b.version || 0) - (a.version || 0))[0] || null;
      if (!alive) return;
      setRecipe(rec);
      if (!rec) { setIngredients([]); setMappings([]); return; }
      try {
        const [ings, maps] = await Promise.all([
          base44.entities.RecipeIngredient.filter({ recipe_id: rec.id }),
          base44.entities.ProductComponentMapping.filter({ product_id: product.id }),
        ]);
        if (!alive) return;
        setIngredients(ings);
        setMappings(maps);
      } catch {
        if (!alive) return;
        setIngredients([]); setMappings([]);
      }
    })();
    return () => { alive = false; };
  }, [productId, recipes, product]);

  const pgMaterial = useMemo(() => materials.find((m) => m.material_category === 'propylene_glycol'), [materials]);
  const vgMaterial = useMemo(() => materials.find((m) => m.material_category === 'vegetable_glycerin'), [materials]);

  const hpp = useMemo(
    () => computeProductHpp({ product, recipe, ingredients, materials, mappings, pgMaterial, vgMaterial }),
    [product, recipe, ingredients, materials, mappings, pgMaterial, vgMaterial]
  );

  const productOptions = useMemo(() => {
    const list = products.filter((p) => FINISHED_TYPES.includes(p.product_type));
    const pool = list.length > 0 ? list : products;
    return pool.map((p) => ({
      value: p.id,
      label: `${p.name}${p.brand_name ? ' · ' + p.brand_name : ''}${p.bottle_size ? ' (' + p.bottle_size + 'ml)' : ''}`,
      keywords: p.code,
    }));
  }, [products]);

  return (
    <div className="p-5 max-w-[1100px] mx-auto">
      <PageHeader
        title="HPP Produk"
        description="Rincian Harga Pokok Produksi per botol — dari komponen bahan sampai produk akhir."
      />

      <div className="rounded-lg border border-border bg-card p-4 mb-4">
        <Label className="text-[12.5px] mb-1.5">Pilih Produk</Label>
        {loadingMeta ? (
          <div className="h-9 bg-muted/40 rounded animate-pulse" />
        ) : (
          <SearchableSelect
            value={productId}
            onValueChange={setProductId}
            options={productOptions}
            placeholder="Cari produk jadi (barang siap jual / belum cukai / siap labeling)..."
            className="h-9"
          />
        )}
      </div>

      {!product && !loadingMeta && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground text-[13px]">
          Pilih produk untuk melihat rincian HPP.
        </div>
      )}

      {product && hpp && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="text-[11px] text-muted-foreground">Ukuran Botol</div>
              <div className="text-[16px] font-semibold tabular-nums mt-0.5">{hpp.bottleSize || '—'}{hpp.bottleSize ? ' ml' : ''}</div>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="text-[11px] text-muted-foreground">HPP / Botol</div>
              <div className="text-[16px] font-semibold tabular-nums mt-0.5 text-primary">{fmtMoney(hpp.hppPerBottle)}</div>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="text-[11px] text-muted-foreground">Harga Jual</div>
              <div className="text-[16px] font-semibold tabular-nums mt-0.5">{fmtMoney(hpp.salePrice)}</div>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="text-[11px] text-muted-foreground">Margin / Botol</div>
              <div className={`text-[16px] font-semibold tabular-nums mt-0.5 ${hpp.margin >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                {fmtMoney(hpp.margin)}
                {hpp.salePrice > 0 && <span className="text-[11px] font-normal text-muted-foreground ml-1">({hpp.marginPct.toFixed(1)}%)</span>}
              </div>
            </div>
          </div>

          {!hpp.hasRecipe && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 mb-4 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-[12px] text-amber-700">
                Produk ini belum memiliki resep. HPP komponen kemasan/botol/cukai tetap dihitung, namun biaya bulk tidak dapat dihitung tanpa resep. <span className="font-semibold">Buat resep FINISHED_PRODUCT</span> untuk produk ini di menu Resep.
              </div>
            </div>
          )}

          {hpp.hasRecipe && hpp.validation && !hpp.validation.valid && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 mb-4 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-[12px] text-amber-700">
                Resep memiliki validasi yang belum lolos: {hpp.validation.errors.join('; ')}
              </div>
            </div>
          )}

          {/* Stage 1: Bulk */}
          <div className="mb-3">
            <StageCard
              icon={FlaskConical}
              color="text-blue-600"
              title="1. Bahan Bulk (Mixing)"
              subtitle={
                hpp.hasRecipe
                  ? `Resep ${recipe?.code || ''} v${recipe?.version || 1} · target ${hpp.volume} ml`
                  : 'Tanpa resep'
              }
              rows={hpp.bulkRows}
              subtotal={hpp.bulkTotal}
              perBottleNote={hpp.hasRecipe ? `Biaya per ml: ${fmtMoney(hpp.costPerMl)} · per botol (${hpp.bottleSize} ml): ${fmtMoney(hpp.bulkPerBottle)}` : undefined}
            />
          </div>

          {/* Stage 2: Bottling */}
          <div className="mb-3">
            <StageCard
              icon={Package}
              color="text-violet-600"
              title="2. Botol (Bottling)"
              subtitle="Komponen botol dari mapping produk"
              rows={hpp.bottleRows}
              subtotal={hpp.bottleTotal}
              perBottleNote={`Per botol: ${fmtMoney(hpp.bottleTotal)}`}
            />
          </div>

          {/* Stage 2b: Box */}
          <div className="mb-3">
            <StageCard
              icon={Box}
              color="text-orange-600"
              title="3. Box (Kemasan Luar)"
              subtitle="Komponen box/kemasan dari mapping produk"
              rows={hpp.boxRows}
              subtotal={hpp.boxTotal}
              perBottleNote={`Per botol: ${fmtMoney(hpp.boxTotal)}`}
            />
          </div>

          {/* Stage 3: Labeling */}
          <div className="mb-3">
            <StageCard
              icon={Tag}
              color="text-pink-600"
              title="4. Label / Stiker (Labeling)"
              subtitle="Komponen label dari mapping produk"
              rows={hpp.labelRows}
              subtotal={hpp.labelTotal}
              perBottleNote={`Per botol: ${fmtMoney(hpp.labelTotal)}`}
            />
          </div>

          {/* Stage 4: Excise */}
          <div className="mb-3">
            <StageCard
              icon={Stamp}
              color="text-amber-600"
              title="5. Pita Cukai (Cukai)"
              subtitle="Komponen pita cukai dari mapping produk"
              rows={hpp.exciseRows}
              subtotal={hpp.exciseTotal}
              perBottleNote={`Per botol: ${fmtMoney(hpp.exciseTotal)}`}
            />
          </div>

          {/* Grand total */}
          <div className="rounded-lg border-2 border-primary bg-primary/5 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Calculator className="w-4 h-4 text-primary" />
              <div className="text-[13px] font-semibold">Akumulasi HPP per Botol</div>
            </div>
            <div className="space-y-1.5 text-[12.5px]">
              <div className="flex justify-between"><span className="text-muted-foreground">Bulk ({hpp.bottleSize} ml)</span><span className="tabular-nums">{fmtMoney(hpp.bulkPerBottle)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Botol</span><span className="tabular-nums">{fmtMoney(hpp.bottleTotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Box</span><span className="tabular-nums">{fmtMoney(hpp.boxTotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Label / Stiker</span><span className="tabular-nums">{fmtMoney(hpp.labelTotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Pita Cukai</span><span className="tabular-nums">{fmtMoney(hpp.exciseTotal)}</span></div>
              <div className="border-t border-primary/20 pt-1.5 flex justify-between items-center">
                <span className="font-semibold">Total HPP / Botol</span>
                <span className="text-[16px] font-bold tabular-nums text-primary">{fmtMoney(hpp.hppPerBottle)}</span>
              </div>
              {hpp.salePrice > 0 && (
                <div className="flex justify-between items-center pt-1">
                  <span className="flex items-center gap-1 text-muted-foreground"><TrendingUp className="w-3.5 h-3.5" /> Margin</span>
                  <span className={`tabular-nums font-semibold ${hpp.margin >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                    {fmtMoney(hpp.margin)} ({hpp.marginPct.toFixed(1)}%)
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 text-[11px] text-muted-foreground">
            HPP dihitung berdasarkan resep aktif dan <span className="font-medium">harga beli terakhir</span> (last_purchase_price) tiap bahan di Master Bahan, serta mapping komponen produk. Premix menggunakan HPP hasil posting produksi premix.
          </div>
        </>
      )}
    </div>
  );
}