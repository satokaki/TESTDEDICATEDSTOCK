/**
 * Standard HPP (Harga Pokok Produksi) calculator for a finished product.
 *
 * Computes the theoretical/standard cost per bottle by tracing the cumulative
 * cost flow from raw components to the final product:
 *   Stage 1 (Bulk) : recipe ingredients (essence, nicotine, PG/VG, premix) → cost per ml → per bottle
 *   Stage 2 (Botol): bottle component mapping(s) → per bottle
 *   Stage 3 (Label): label/sticker mapping(s) → per bottle
 *   Stage 4 (Cukai): excise mapping(s) → per bottle
 *   Total HPP per bottle = bulk_per_bottle + bottle + label + excise
 *
 * Material cost basis follows the material's unit:
 *   - mililiter → volumeMl × last_purchase_price
 *   - gram     → gram × last_purchase_price
 * Premix materials already carry their computed HPP in last_purchase_price
 * (set during premix production posting), so the cumulative cost stays intact.
 */
import { calculateRecipe } from './recipeCalculator';

function ingredientCost(item, material) {
  const price = Number(material?.last_purchase_price) || 0;
  const unit = material?.unit;
  let qty, unitLabel;
  if (unit === 'mililiter') { qty = Number(item.volumeMl) || 0; unitLabel = 'ml'; }
  else if (unit === 'gram') { qty = Number(item.gram) || 0; unitLabel = 'g'; }
  else { qty = Number(item.gram) || 0; unitLabel = 'g'; }
  return { qty, unitLabel, unitCost: price, cost: qty * price };
}

export function computeProductHpp({ product, recipe, ingredients, materials, mappings, pgMaterial, vgMaterial }) {
  if (!product) return null;

  const bottleSize = Number(product.bottle_size) || 0;
  const volume = Number(recipe?.target_volume) || bottleSize || 0;

  const result = {
    product,
    recipe: recipe || null,
    volume,
    bottleSize,
    bulkRows: [],
    bulkTotal: 0,
    costPerMl: 0,
    bulkPerBottle: 0,
    bottleRows: [],
    bottleTotal: 0,
    labelRows: [],
    labelTotal: 0,
    exciseRows: [],
    exciseTotal: 0,
    hppPerBottle: 0,
    salePrice: Number(product.sale_price) || 0,
    margin: 0,
    marginPct: 0,
    hasRecipe: !!recipe,
    validation: null,
  };

  if (!recipe) return result;

  const calc = calculateRecipe({
    ingredients: (ingredients || []).map((i) => ({ ...i, percentage: Number(i.percentage) || 0 })),
    targetVolume: volume,
    targetNicotine: recipe.target_nicotine,
    targetPG: recipe.target_pg,
    targetVG: recipe.target_vg,
    pgMaterial,
    vgMaterial,
  });
  result.validation = calc.validation;

  const matById = (id) => (materials || []).find((m) => m.id === id);

  result.bulkRows = calc.items.map((it) => {
    const mat = matById(it.material_id);
    const c = ingredientCost(it, mat);
    return {
      ...c,
      materialId: it.material_id,
      materialName: it.material_name || mat?.name || (it.isAuto ? 'Auto' : '—'),
      materialCode: mat?.code || '',
      materialType: it.material_type,
      isPremix: !!it.is_premix,
      isAuto: !!it.isAuto,
      percentage: it.percentage,
    };
  });
  result.bulkTotal = result.bulkRows.reduce((s, r) => s + r.cost, 0);
  result.costPerMl = volume > 0 ? result.bulkTotal / volume : 0;
  result.bulkPerBottle = bottleSize > 0 ? result.costPerMl * bottleSize : 0;

  const activeMappings = (mappings || []).filter((m) => m.is_active !== false);
  const buildComp = (type) =>
    activeMappings
      .filter((m) => m.component_type === type)
      .map((m) => {
        const mat = matById(m.material_id);
        const price = Number(mat?.last_purchase_price) || 0;
        const qty = Number(m.quantity_per_unit) || 1;
        return {
          materialId: m.material_id,
          materialName: m.material_name || mat?.name || '—',
          materialCode: m.material_code || mat?.code || '',
          qty,
          unitLabel: 'pcs',
          unitCost: price,
          cost: qty * price,
        };
      });

  result.bottleRows = buildComp('bottle');
  result.labelRows = buildComp('label');
  result.exciseRows = buildComp('excise');
  result.bottleTotal = result.bottleRows.reduce((s, r) => s + r.cost, 0);
  result.labelTotal = result.labelRows.reduce((s, r) => s + r.cost, 0);
  result.exciseTotal = result.exciseRows.reduce((s, r) => s + r.cost, 0);

  result.hppPerBottle = result.bulkPerBottle + result.bottleTotal + result.labelTotal + result.exciseTotal;
  result.margin = result.salePrice - result.hppPerBottle;
  result.marginPct = result.salePrice > 0 ? (result.margin / result.salePrice) * 100 : 0;

  return result;
}