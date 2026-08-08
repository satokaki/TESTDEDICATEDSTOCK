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

// Priority 1: Find actual HPP from StockLedger output entries.
// Returns null if no actual transaction output exists (fallback to standard cost).
// Stage priority: excise_output > labeling_output > bottling_output > production_output.
// Within the same stage, the newest transaction wins.
const STAGE_PRIORITY = {
  excise_output: 4,
  labeling_output: 3,
  bottling_output: 2,
  production_output: 1,
  premix_output: 1,
};
export function getActualHppFromLedger(stockLedger, productId) {
  if (!stockLedger || !productId) return null;
  const outputs = stockLedger
    .filter((l) => l.item_id === productId && l.transaction_type.endsWith('_output') && Number(l.quantity_in) > 0)
    .sort((a, b) => {
      const pa = STAGE_PRIORITY[a.transaction_type] || 0;
      const pb = STAGE_PRIORITY[b.transaction_type] || 0;
      if (pa !== pb) return pb - pa;
      return new Date(b.transaction_date || 0) - new Date(a.transaction_date || 0);
    });
  if (outputs.length === 0) return null;
  const latest = outputs[0];
  const outputQty = Number(latest.quantity_in) || 1;
  const actualHppPerUnit = Number(latest.unit_cost) || 0;
  const batchNumber = latest.batch_number;
  const batchEntries = batchNumber
    ? stockLedger.filter((l) => l.batch_number === batchNumber)
    : stockLedger.filter((l) => l.reference_id === latest.reference_id);
  let bottlePerBottle = 0, labelPerBottle = 0, excisePerBottle = 0;
  for (const e of batchEntries) {
    const total = (Number(e.unit_cost) || 0) * (Number(e.quantity_out) || 0);
    if (e.transaction_type === 'bottling_bottle_consumption') bottlePerBottle += total / outputQty;
    else if (e.transaction_type === 'label_consumption') labelPerBottle += total / outputQty;
    else if (e.transaction_type === 'excise_consumption') excisePerBottle += total / outputQty;
  }
  const bulkPerBottle = Math.max(0, actualHppPerUnit - bottlePerBottle - labelPerBottle - excisePerBottle);
  return { actualHppPerUnit, bulkPerBottle, bottlePerBottle, labelPerBottle, excisePerBottle, stage: latest.inventory_status, transactionType: latest.transaction_type, batchNumber, outputQty };
}

export function computeProductHpp({ product, recipe, ingredients, materials, mappings, pgMaterial, vgMaterial, stockLedger }) {
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
    boxRows: [],
    boxTotal: 0,
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
  result.boxRows = buildComp('box');
  result.labelRows = buildComp('label');
  result.exciseRows = buildComp('excise');
  result.bottleTotal = result.bottleRows.reduce((s, r) => s + r.cost, 0);
  result.boxTotal = result.boxRows.reduce((s, r) => s + r.cost, 0);
  result.labelTotal = result.labelRows.reduce((s, r) => s + r.cost, 0);
  result.exciseTotal = result.exciseRows.reduce((s, r) => s + r.cost, 0);

  // Priority 1: Actual transaction cost from StockLedger (overrides standard)
  const actual = getActualHppFromLedger(stockLedger, product?.id);
  if (actual) {
    result.useActual = true;
    result.actualHpp = actual;
    result.bulkPerBottle = actual.bulkPerBottle;
    result.bottleTotal = actual.bottlePerBottle;
    result.labelTotal = actual.labelPerBottle;
    result.exciseTotal = actual.excisePerBottle;
    result.boxTotal = 0;
    if (actual.bottlePerBottle > 0) {
      result.bottleRows = [{ materialName: 'Botol (aktual)', materialCode: actual.batchNumber || '', qty: 1, unitLabel: 'pcs', unitCost: actual.bottlePerBottle, cost: actual.bottlePerBottle }];
    }
    if (actual.labelPerBottle > 0) {
      result.labelRows = [{ materialName: 'Label (aktual)', materialCode: actual.batchNumber || '', qty: 1, unitLabel: 'pcs', unitCost: actual.labelPerBottle, cost: actual.labelPerBottle }];
    }
    if (actual.excisePerBottle > 0) {
      result.exciseRows = [{ materialName: 'Pita Cukai (aktual)', materialCode: actual.batchNumber || '', qty: 1, unitLabel: 'pcs', unitCost: actual.excisePerBottle, cost: actual.excisePerBottle }];
    }
    result.hppPerBottle = actual.actualHppPerUnit;
  } else {
    result.hppPerBottle = result.bulkPerBottle + result.bottleTotal + result.boxTotal + result.labelTotal + result.exciseTotal;
  }
  result.margin = result.salePrice - result.hppPerBottle;
  result.marginPct = result.salePrice > 0 ? (result.margin / result.salePrice) * 100 : 0;

  return result;
}