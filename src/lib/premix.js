/**
 * Premix / Intermediate Material engine.
 *
 * Layer di atas recipeCalculator — tidak mengubah engine lama.
 * Bertanggung jawab atas:
 *  - perhitungan komponen premix berdasarkan basis (W_W / W_V / V_V)
 *  - resolusi komposisi premix secara rekursif (aktif + carrier)
 *  - deteksi circular dependency antar premix
 *  - validasi resep premix
 *  - pemilihan batch FEFO
 */

import { base44 } from '@/api/base44Client';

export const CALC_BASIS = {
  W_W: 'W_W', // gram terhadap total gram
  W_V: 'W_V', // gram terhadap total volume
  V_V: 'V_V', // ml terhadap total ml
};

export const MATERIAL_TYPE = {
  RAW_MATERIAL: 'RAW_MATERIAL',
  PREMIX: 'PREMIX',
  PACKAGING: 'PACKAGING',
  LABEL: 'LABEL',
  CONSUMABLE: 'CONSUMABLE',
  FINISHED_GOOD: 'FINISHED_GOOD',
};

export const BATCH_STATUS = {
  DRAFT: 'DRAFT',
  IN_PROCESS: 'IN_PROCESS',
  AVAILABLE: 'AVAILABLE',
  DEPLETED: 'DEPLETED',
  QUARANTINE: 'QUARANTINE',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
};

const densityOf = (m) => (m && (m.default_density || m.density)) || 1.0;

/**
 * Hitung kebutuhan komponen premix berdasarkan basis.
 * @param {Array} ingredients - [{ material_id, percentage, density }]
 * @param {number} targetQuantity - target output (gram untuk W_W, ml untuk W_V/V_V)
 * @param {string} basis - W_W | W_V | V_V
 * @returns {Array} [{ material_id, percentage, gram, ml, density }]
 */
export function calculatePremixQuantities({ ingredients, targetQuantity, basis = CALC_BASIS.W_W, materialsById }) {
  return (ingredients || []).map((ing) => {
    const mat = materialsById?.[ing.material_id];
    const density = ing.density || densityOf(mat);
    const pct = Number(ing.percentage || 0);
    let gram = 0;
    let ml = 0;
    if (basis === CALC_BASIS.W_W) {
      // total = target gram; component gram = pct/100 * target
      gram = (pct / 100) * targetQuantity;
      ml = density > 0 ? gram / density : 0;
    } else if (basis === CALC_BASIS.V_V) {
      // total = target ml; component ml = pct/100 * target; gram = ml * density
      ml = (pct / 100) * targetQuantity;
      gram = ml * density;
    } else {
      // W_V: total = target volume (ml); component gram = pct/100 * target ml
      gram = (pct / 100) * targetQuantity;
      ml = density > 0 ? gram / density : 0;
    }
    return { ...ing, gram, ml, density, percentage: pct };
  });
}

/**
 * Bangun peta komposisi premix: outputMaterialId -> { recipe, components: RecipeIngredient[] }
 * Membutuhkan daftar resep premix + ingredient-nya (preload untuk efisiensi).
 */
export function buildPremixCompositionMap(premixRecipes, allIngredients) {
  const map = {};
  for (const r of premixRecipes || []) {
    if (!r.output_material_id) continue;
    const components = (allIngredients || []).filter((i) => i.recipe_id === r.id);
    map[r.output_material_id] = { recipe: r, components };
  }
  return map;
}

/**
 * Deteksi circular dependency: apakah outputMaterial muncul di subtree komponennya sendiri.
 * DFS dengan visited set per cabang (path) untuk mendeteksi siklus.
 */
export function detectCircularDependency(outputMaterialId, premixMap, path = new Set()) {
  if (!outputMaterialId) return false;
  if (path.has(outputMaterialId)) return true;
  path.add(outputMaterialId);
  const node = premixMap[outputMaterialId];
  if (node && node.components) {
    for (const c of node.components) {
      if (detectCircularDependency(c.material_id, premixMap, path)) return true;
    }
  }
  path.delete(outputMaterialId);
  return false;
}

/**
 * Resolusi komposisi premix secara rekursif.
 * Untuk sejumlah gram premix, kembalikan kontribusi tiap bahan atom (aktif + carrier).
 * @returns { contributions: [{ material_id, name, grams, is_premix, depth }], circular: boolean }
 */
export function resolveCompositionContribution({ materialId, quantityGram, premixMap, materialsById, path = new Set() }) {
  const contributions = [];
  if (path.has(materialId)) return { contributions, circular: true };
  path.add(materialId);

  const node = premixMap?.[materialId];
  if (!node || !node.components || node.components.length === 0) {
    // Bahan atom — kontribusi penuh
    const mat = materialsById?.[materialId];
    contributions.push({ material_id: materialId, name: mat?.name || '', grams: quantityGram, is_premix: mat?.material_type === MATERIAL_TYPE.PREMIX, depth: path.size - 1 });
    path.delete(materialId);
    return { contributions, circular: false };
  }

  // Premix — pecah ke komponen berdasarkan persentase W_W
  const totalPct = node.components.reduce((s, c) => s + Number(c.percentage || 0), 0) || 100;
  let circular = false;
  for (const c of node.components) {
    const compGram = (Number(c.percentage || 0) / totalPct) * quantityGram;
    const sub = resolveCompositionContribution({
      materialId: c.material_id,
      quantityGram: compGram,
      premixMap,
      materialsById,
      path,
    });
    if (sub.circular) circular = true;
    contributions.push(...sub.contributions);
  }
  path.delete(materialId);
  return { contributions, circular };
}

/**
 * Agregasi kontribusi PG/VG dari sejumlah premix untuk resep produk akhir.
 * Mis. 20 gram Sucralose 10% (carrier PG) -> 18 gram PG, 2 gram aktif.
 * @returns { pgGram, vgGram, activeGram, components: [{ material_id, name, grams }] }
 */
export function premixContributionForFinishedRecipe({ materialId, quantityGram, premixMap, materialsById }) {
  const { contributions, circular } = resolveCompositionContribution({ materialId, quantityGram, premixMap, materialsById });
  let pgGram = 0;
  let vgGram = 0;
  const active = [];
  for (const c of contributions) {
    const mat = materialsById?.[c.material_id];
    const pgPct = mat?.pg_content || (mat?.material_category === 'propylene_glycol' ? 100 : 0);
    const vgPct = mat?.vg_content || (mat?.material_category === 'vegetable_glycerin' ? 100 : 0);
    pgGram += (c.grams * pgPct) / 100;
    vgGram += (c.grams * vgPct) / 100;
    active.push({ material_id: c.material_id, name: c.name, grams: c.grams, is_premix: c.is_premix });
  }
  return { pgGram, vgGram, activeGram: active, circular };
}

/**
 * Validasi resep premix.
 */
export function validatePremixRecipe({ recipe, ingredients, outputMaterial, materialsById, premixMap }) {
  const errors = [];
  if (!recipe.recipe_type || recipe.recipe_type !== 'PREMIX') {
    // non-premix tidak divalidasi di sini
    return { valid: true, errors };
  }
  if (!recipe.output_material_id) {
    errors.push('Resep PREMIX wajib memiliki Output Material');
  } else {
    if (!outputMaterial) {
      errors.push('Output material tidak ditemukan');
    } else if (outputMaterial.material_type !== MATERIAL_TYPE.PREMIX) {
      errors.push('Output material wajib bertipe PREMIX');
    }
    // Output tidak boleh menjadi komponen resepnya sendiri
    if (ingredients.some((i) => i.material_id === recipe.output_material_id)) {
      errors.push('Output material tidak boleh menjadi komponen resepnya sendiri');
    }
    // Circular dependency
    if (premixMap && detectCircularDependency(recipe.output_material_id, premixMap, new Set())) {
      errors.push('Circular dependency terdeteksi pada formula premix');
    }
  }
  // Total sesuai basis
  const total = (ingredients || []).reduce((s, i) => s + Number(i.percentage || 0), 0);
  if (Math.abs(total - 100) > 0.1) {
    errors.push(`Total komposisi ${total.toFixed(2)}%, harus 100%`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Ambil batch premix yang tersedia (status AVAILABLE, tidak expired) untuk material.
 * Diurutkan FEFO (expiry paling dekat dulu).
 */
export async function getAvailablePremixBatches(materialId) {
  const today = new Date().toISOString().slice(0, 10);
  const batches = await base44.entities.PremixBatch.filter({
    material_id: materialId,
    status: BATCH_STATUS.AVAILABLE,
  });
  return batches
    .filter((b) => !b.expiry_date || b.expiry_date >= today)
    .filter((b) => (b.quantity_remaining || 0) > 0)
    .sort((a, b) => {
      const ea = a.expiry_date || '9999-12-31';
      const eb = b.expiry_date || '9999-12-31';
      return ea.localeCompare(eb);
    });
}

/**
 * Pilih batch FEFO untuk memenuhi quantity dibutuhkan.
 * @returns { allocations: [{ batch_id, batch_code, quantity, expiry_date }], fulfilled: boolean, remaining }
 */
export function pickBatchFEFO(batches, neededQty) {
  const allocations = [];
  let remaining = neededQty;
  for (const b of batches) {
    if (remaining <= 0) break;
    const avail = b.quantity_remaining || 0;
    if (avail <= 0) continue;
    const take = Math.min(avail, remaining);
    allocations.push({ batch_id: b.id, batch_code: b.batch_code, quantity: take, expiry_date: b.expiry_date });
    remaining -= take;
  }
  return { allocations, fulfilled: remaining <= 0.0001, remaining: Math.max(0, remaining) };
}

/**
 * Apakah batch boleh dipakai (tidak expired / quarantine).
 */
export function isBatchUsable(batch) {
  if (!batch) return false;
  if (batch.status !== BATCH_STATUS.AVAILABLE) return false;
  if (batch.expiry_date) {
    const today = new Date().toISOString().slice(0, 10);
    if (batch.expiry_date < today) return false;
  }
  return true;
}

/**
 * Ambil batch premix untuk suatu produk jadi (traceability downstream).
 */
export async function getBatchesUsedByProduction(productionId) {
  return base44.entities.PremixBatchComponent.filter({ premix_batch_id_reference: productionId });
}

/**
 * Ambil produk jadi yang menggunakan batch premix tertentu (traceability upstream).
 * Mencari ProductionMaterial yang memakai material premix lalu mencocokkan via resep produk.
 */
export async function getProductsUsingPremixBatch(premixBatchId) {
  // Batch premix -> material_id -> digunakan di RecipeIngredient premix -> resep -> produksi
  const batch = await base44.entities.PremixBatch.get(premixBatchId).catch(() => null);
  if (!batch) return [];
  const ingredients = await base44.entities.RecipeIngredient.filter({ material_id: batch.material_id, is_premix: true });
  const recipeIds = [...new Set(ingredients.map((i) => i.recipe_id))];
  if (recipeIds.length === 0) return [];
  const productions = [];
  for (const rid of recipeIds) {
    const prods = await base44.entities.ProductionOrder.filter({ recipe_id: rid, production_type: 'FINISHED_PRODUCT' });
    productions.push(...prods);
  }
  return productions;
}