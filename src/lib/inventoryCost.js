/**
 * Inventory cost-resolution layer for reporting.
 *
 * Lab PRO's posting engine moves quantity per stage but does not yet freeze a
 * unit_cost onto StockBalance / StockLedger. Agar nominal persediaan tampil di
 * SEMUA tahap (bukan hanya READY_FOR_SALE), modul ini menurunkan HPP standar
 * per tahap dari costing engine yang sudah berjalan (computeProductHpp) +
 * last_purchase_price bahan, TANPA merubah mesin transaksi/produksi.
 *
 * Sumber cost (prioritas frozen):
 *   1. HPP standar per stage dari computeProductHpp (resep aktif + mapping) — produk
 *   2. material.last_purchase_price (termasuk premix yg HPP-nya sudah di-post) — bahan
 *   3. 0 bila tidak ada resep/mapping (tidak pernah memakai harga jual)
 *
 * Unit cost per stage (menyesuaikan satuan balance):
 *   RAW_MATERIAL / PREMIX (material)  : material.last_purchase_price
 *   BULK               (product, ml)  : costPerMl
 *   READY_FOR_LABELING (product, pcs) : bulkPerBottle + bottle + box
 *   UNEXCISED          (product, pcs) : + label
 *   READY_FOR_SALE     (product, pcs) : hppPerBottle (penuh)
 */
import { base44 } from '@/api/base44Client';
import { computeProductHpp } from './hppCalculator';

export const INVENTORY_COST_RUNTIME_VERSION = 'COST_FIX_20260806_V2';

export function resolvePgVgMaterials(materials) {
  const list = materials || [];
  return {
    pgMaterial: list.find((m) => m.material_category === 'propylene_glycol') || null,
    vgMaterial: list.find((m) => m.material_category === 'vegetable_glycerin') || null,
  };
}

/**
 * Bangun index: productId -> { BULK, READY_FOR_LABELING, UNEXCISED, READY_FOR_SALE }
 * berisi unit cost standar per tahap.
 */
export function buildStageCostIndex({ products, recipes, ingredients, materials, mappings, pgMaterial, vgMaterial }) {
  const index = {};
  const finishedRecipes = (recipes || []).filter((r) => r.recipe_type === 'FINISHED_PRODUCT');
  const matList = materials || [];
  for (const p of products || []) {
    const recs = finishedRecipes.filter((r) => r.product_id === p.id);
    const approved = recs.filter((r) => r.status === 'approved').sort((a, b) => (b.version || 0) - (a.version || 0));
    const recipe = approved[0] || recs.sort((a, b) => (b.version || 0) - (a.version || 0))[0] || null;
    const ings = (ingredients || []).filter((i) => i.recipe_id === recipe?.id);
    const maps = (mappings || []).filter((m) => m.product_id === p.id);
    const hpp = computeProductHpp({ product: p, recipe, ingredients: ings, materials: matList, mappings: maps, pgMaterial, vgMaterial });
    if (!hpp) continue;
    if (p.name === 'IZZI Taro 3mg' || p.id === '6a734c20f2f6babf7768fbb7') {
      console.log('[COST_TRACE][buildStageCostIndex] INVENTORY_COST_RUNTIME_VERSION=' + INVENTORY_COST_RUNTIME_VERSION, {
        productId: p.id, productName: p.name, bottleSize: p.bottle_size,
        recipeId: recipe?.id, recipeCode: recipe?.code,
        bulkRows: hpp.bulkRows.map(r => ({ materialId: r.materialId, name: r.materialName, unitCost: r.unitCost, qty: r.qty, cost: r.cost })),
        bulkTotal: hpp.bulkTotal, costPerMl: hpp.costPerMl, bulkPerBottle: hpp.bulkPerBottle,
        bottleTotal: hpp.bottleTotal, boxTotal: hpp.boxTotal,
        READY_FOR_LABELING_unit_cost: hpp.bulkPerBottle + hpp.bottleTotal + hpp.boxTotal,
      });
    }
    index[p.id] = {
      BULK: hpp.costPerMl || 0,
      READY_FOR_LABELING: (hpp.bulkPerBottle + hpp.bottleTotal + hpp.boxTotal) || 0,
      UNEXCISED: (hpp.bulkPerBottle + hpp.bottleTotal + hpp.boxTotal + hpp.labelTotal) || 0,
      READY_FOR_SALE: hpp.hppPerBottle || 0,
    };
  }
  return index;
}

/**
 * Resolve unit cost untuk sebuah baris StockBalance ATAU StockLedger
 * (keduanya punya item_type, item_id, inventory_status).
 */
export function resolveBalanceUnitCost(row, { materialById, stageCostIndex }) {
  if (!row || !row.item_id) return 0;
  if (row.item_type === 'material') {
    return Number(materialById?.[row.item_id]?.last_purchase_price) || 0;
  }
  const status = row.inventory_status || '';
  const stage = stageCostIndex?.[row.item_id];
  if (stage && stage[status] != null) return stage[status];
  return 0;
}

/**
 * Muat seluruh konteks cost sekali: products, materials, recipes, ingredients,
 * mappings, plus stageCostIndex & materialById siap pakai.
 */
export async function loadInventoryCostContext() {
  const [products, materials, recipes, ingredients, mappings] = await Promise.all([
    base44.entities.Product.list('-created_date', 500),
    base44.entities.Material.list('-created_date', 500),
    base44.entities.Recipe.list('-created_date', 500),
    base44.entities.RecipeIngredient.list('-created_date', 3000),
    base44.entities.ProductComponentMapping.list('-created_date', 3000),
  ]);
  const { pgMaterial, vgMaterial } = resolvePgVgMaterials(materials);
  const stageCostIndex = buildStageCostIndex({ products, recipes, ingredients, materials, mappings, pgMaterial, vgMaterial });
  const materialById = Object.fromEntries((materials || []).map((m) => [m.id, m]));
  return { products, materials, recipes, ingredients, mappings, stageCostIndex, materialById };
}