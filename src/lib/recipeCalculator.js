/**
 * Recipe Calculation Engine for E-Liquid
 *
 * Integrated PG/VG balancing model (minor patch):
 * - PREMIX ingredients count as PG 100% / VG 0% for finished-product balancing
 *   (internal premix composition is NOT decomposed here — HPP/traceability stay intact).
 * - Non-premix ingredients contribute via carrier (pg_content / vg_content), defaulting
 *   to PG 100% for flavor/sweetener/cooling/additive/nicotine when carrier unset.
 * - Plain PG and VG are computed automatically as balancers (target - ingredient
 *   contribution) and injected as auto rows with REAL PG/VG material ids so production
 *   stock consumption keeps working.
 * - Total formula must equal 100%; plain PG/VG must not be negative.
 *
 * Backward compatible: `items` (manual + auto rows), `totalFlavor`, `totalPG`,
 * `totalVG`, `totalVolume`, `totalGram`, `totalPercent`, `nicotineVolume`,
 * `pgNeeded`/`vgNeeded` (aliases), `validation` are still returned.
 */

/**
 * @param {Object} params
 * @param {Array} params.ingredients - [{ material_type, is_premix, percentage, density, pg_content, vg_content, nicotine_strength }]
 * @param {number} params.targetVolume - Total volume in ml
 * @param {number} params.targetNicotine - Target nicotine mg/ml
 * @param {number} params.targetPG - Target PG %
 * @param {number} params.targetVG - Target VG %
 * @param {number} params.nicotineBaseStrength - (legacy) nicotine base strength mg/ml
 * @param {Object} params.pgMaterial - PG material (real) used for the auto balancer row
 * @param {Object} params.vgMaterial - VG material (real) used for the auto balancer row
 * @returns {Object} { items, totalFlavor, totalIngredientPg, totalIngredientVg, plainPg, plainVg, totalPG, totalVG, totalVolume, totalGram, totalPercent, nicotineVolume, breakdown, validation }
 */
export function calculateRecipe({
  ingredients,
  targetVolume,
  targetNicotine,
  targetPG,
  targetVG,
  nicotineBaseStrength = 100,
  pgMaterial = null,
  vgMaterial = null,
}) {
  const targetPg = Number(targetPG) || 0;
  const targetVg = Number(targetVG) || 0;
  const volume = Number(targetVolume) || 0;
  const targetNic = Number(targetNicotine) || 0;

  // Normalize: percentage may be a raw string ('') while typing in NumberInput.
  ingredients = (ingredients || []).map(i => ({ ...i, percentage: Number(i.percentage) || 0 }));

  const isPremixIng = (ing) => ing.is_premix || ing.material_type === 'premix' || ing.material_type === 'PREMIX';

  // Default carrier when pg_content/vg_content unset on master bahan.
  const defaultCarrier = (ing) => {
    const cat = ing.material_type;
    if (cat === 'propylene_glycol') return { pg: 100, vg: 0 };
    if (cat === 'vegetable_glycerin') return { pg: 0, vg: 100 };
    if (['flavor', 'sweetener', 'cooling', 'additive', 'nicotine'].includes(cat)) return { pg: 100, vg: 0 };
    return { pg: 0, vg: 0 };
  };

  const items = [];
  let totalIngredientPg = 0;
  let totalIngredientVg = 0;
  let totalFlavorPercent = 0;
  let nicotineVolume = 0;
  const breakdown = { flavor: 0, nicotine: 0, sweetener: 0, premix: 0, otherVg: 0 };

  ingredients.forEach(ing => {
    const pct = ing.percentage;
    const premix = isPremixIng(ing);
    let pgContrib, vgContrib;
    if (premix) {
      // PREMIX counts as PG 100% for finished-product balancing.
      pgContrib = pct;
      vgContrib = 0;
    } else {
      const carrier = defaultCarrier(ing);
      const pgc = (Number(ing.pg_content) || 0) || carrier.pg;
      const vgc = (Number(ing.vg_content) || 0) || carrier.vg;
      pgContrib = (pct * pgc) / 100;
      vgContrib = (pct * vgc) / 100;
    }

    totalIngredientPg += pgContrib;
    totalIngredientVg += vgContrib;
    if (ing.material_type === 'flavor') totalFlavorPercent += pct;

    if (ing.material_type === 'nicotine') {
      breakdown.nicotine += pgContrib;
      if (pct > 0 && volume > 0) nicotineVolume = (pct / 100) * volume;
    } else if (ing.material_type === 'flavor') {
      breakdown.flavor += pgContrib;
    } else if (ing.material_type === 'sweetener') {
      breakdown.sweetener += pgContrib;
    } else if (premix) {
      breakdown.premix += pgContrib;
    }
    if (vgContrib > 0) breakdown.otherVg += vgContrib;

    const volumeMl = (pct / 100) * volume;
    const density = Number(ing.density) || (premix ? 1.04 : ing.material_type === 'vegetable_glycerin' ? 1.261 : 1.036);
    items.push({
      ...ing, percentage: pct, pgContribution: pgContrib, vgContribution: vgContrib,
      volumeMl, gram: volumeMl * density, isAuto: false,
    });
  });

  // Plain PG / VG balancers
  const plainPg = targetPg - totalIngredientPg;
  const plainVg = targetVg - totalIngredientVg;

  if (plainPg > 0.0001) {
    const mat = pgMaterial || {};
    const volumeMl = (plainPg / 100) * volume;
    items.push({
      material_id: mat.id || null, material_name: mat.name || 'PG (Auto)',
      material_type: 'propylene_glycol', isAuto: true,
      percentage: plainPg, pgContribution: plainPg, vgContribution: 0,
      density: mat.density || 1.036, volumeMl, gram: volumeMl * (mat.density || 1.036),
    });
  }
  if (plainVg > 0.0001) {
    const mat = vgMaterial || {};
    const volumeMl = (plainVg / 100) * volume;
    items.push({
      material_id: mat.id || null, material_name: mat.name || 'VG (Auto)',
      material_type: 'vegetable_glycerin', isAuto: true,
      percentage: plainVg, pgContribution: 0, vgContribution: plainVg,
      density: mat.density || 1.261, volumeMl, gram: volumeMl * (mat.density || 1.261),
    });
  }

  const totalPercent = items.reduce((s, i) => s + i.percentage, 0);
  const totalVolume = items.reduce((s, i) => s + i.volumeMl, 0);
  const totalGram = items.reduce((s, i) => s + i.gram, 0);
  const totalPg = totalIngredientPg + Math.max(0, plainPg);
  const totalVg = totalIngredientVg + Math.max(0, plainVg);

  const validation = { valid: true, errors: [], warnings: [] };

  if (Math.abs(targetPg + targetVg - 100) > 0.0001) {
    validation.errors.push(`Target PG + VG = ${(targetPg + targetVg).toFixed(2)}%, harus 100%`);
    validation.valid = false;
  }
  if (plainPg < -0.0001) {
    validation.errors.push(`Total bahan berbasis PG sebesar ${totalIngredientPg.toFixed(2)}%, melebihi Target PG ${targetPg.toFixed(2)}%. Kurangi bahan berbasis PG atau naikkan Target PG.`);
    validation.valid = false;
  }
  if (plainVg < -0.0001) {
    validation.errors.push(`Total bahan berbasis VG sebesar ${totalIngredientVg.toFixed(2)}%, melebihi Target VG ${targetVg.toFixed(2)}%. Kurangi bahan berbasis VG atau naikkan Target VG.`);
    validation.valid = false;
  }
  if (plainPg >= -0.0001 && plainVg >= -0.0001 && Math.abs(totalPercent - 100) > 0.0001) {
    validation.errors.push(`Total formula ${totalPercent.toFixed(2)}%, harus 100%`);
    validation.valid = false;
  }

  const nicotineIng = ingredients.find(i => i.material_type === 'nicotine' && !isPremixIng(i));
  if (nicotineIng && targetNic > 0 && !(Number(nicotineIng.nicotine_strength) > 0)) {
    validation.errors.push('Target nicotine tidak dapat dihitung karena nicotine strength tidak tersedia');
    validation.valid = false;
  }

  return {
    items,
    totalFlavor: totalFlavorPercent,
    totalIngredientPg, totalIngredientVg, plainPg, plainVg,
    totalPG: totalPg, totalVG: totalVg,
    totalVolume, totalGram, totalPercent, nicotineVolume,
    pgNeeded: plainPg, vgNeeded: plainVg, // backward compat aliases
    breakdown, validation,
  };
}

/**
 * Check stock availability for production materials
 */
export function checkStockAvailability(calculatedItems, stockBalances) {
  return calculatedItems.map(item => {
    const balance = stockBalances.find(
      b => b.item_id === item.material_id && b.item_type === 'material'
    );
    const available = balance?.available_quantity || 0;
    const required = item.gram || item.volumeMl || 0;
    return {
      ...item,
      stockAvailable: available,
      stockSufficient: available >= required,
    };
  });
}