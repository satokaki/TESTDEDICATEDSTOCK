/**
 * Recipe Calculation Engine for E-Liquid
 * Based on standard e-liquid calculator logic (e-liquid-recipes.com style)
 *
 * Core formulas:
 * - volume_bahan_ml = persentase_bahan / 100 × total_volume_ml
 * - berat_bahan_gram = volume_bahan_ml × density_bahan
 * - volume_nicotine_base = target_nicotine / kekuatan_nicotine_base × total_volume
 */

/**
 * Calculate recipe composition for a given target volume.
 * @param {Object} params
 * @param {Array} params.ingredients - [{ material_type, percentage, density, pg_content, vg_content, nicotine_strength }]
 * @param {number} params.targetVolume - Total volume in ml
 * @param {number} params.targetNicotine - Target nicotine mg/ml
 * @param {number} params.targetPG - Target PG %
 * @param {number} params.targetVG - Target VG %
 * @param {number} params.nicotineBaseStrength - Nicotine base strength mg/ml
 * @param {number} params.nicotineBasePG - PG content of nicotine base %
 * @param {number} params.nicotineBaseVG - VG content of nicotine base %
 * @returns {Object} { items, totalFlavor, totalPG, totalVG, validation }
 */
export function calculateRecipe({
  ingredients,
  targetVolume,
  targetNicotine,
  targetPG,
  targetVG,
  nicotineBaseStrength = 100,
  nicotineBasePG = 100,
  nicotineBaseVG = 0,
}) {
  const items = [];
  let totalFlavorPercent = 0;
  let totalPercent = 0;

  // Group ingredients by type
  const nicotineIngredient = ingredients.find(i => i.material_type === 'nicotine');
  const flavors = ingredients.filter(i => i.material_type === 'flavor');
  const additives = ingredients.filter(i =>
    ['sweetener', 'cooling', 'additive'].includes(i.material_type)
  );
  const pgIngredients = ingredients.filter(i => i.material_type === 'propylene_glycol');
  const vgIngredients = ingredients.filter(i => i.material_type === 'vegetable_glycerin');

  // Calculate nicotine base volume
  let nicotineVolumeMl = 0;
  let nicotineGram = 0;
  let nicotinePgContribution = 0;
  let nicotineVgContribution = 0;

  if (nicotineIngredient && targetNicotine > 0) {
    nicotineVolumeMl = (targetNicotine / nicotineBaseStrength) * targetVolume;
    nicotineGram = nicotineVolumeMl * (nicotineIngredient.density || 1.03);
    nicotinePgContribution = (nicotineVolumeMl * nicotineBasePG) / 100;
    nicotineVgContribution = (nicotineVolumeMl * nicotineBaseVG) / 100;
  }

  // Calculate flavors and additives
  const flavorResults = [];
  let flavorPgContribution = 0;
  let flavorVgContribution = 0;

  [...flavors, ...additives].forEach(ing => {
    const volumeMl = (ing.percentage / 100) * targetVolume;
    const gram = volumeMl * (ing.density || 1.0);
    flavorResults.push({
      ...ing,
      volumeMl,
      gram,
      pgContribution: (volumeMl * (ing.pg_content || 0)) / 100,
      vgContribution: (volumeMl * (ing.vg_content || 0)) / 100,
    });
    if (ing.material_type === 'flavor') totalFlavorPercent += ing.percentage;
    flavorPgContribution += (volumeMl * (ing.pg_content || 0)) / 100;
    flavorVgContribution += (volumeMl * (ing.vg_content || 0)) / 100;
  });

  // Calculate total PG/VG needed
  const targetPgVolume = (targetPG / 100) * targetVolume;
  const targetVgVolume = (targetVG / 100) * targetVolume;

  // PG needed = targetPG - nicotinePG - flavorPG
  const pgNeeded = Math.max(0, targetPgVolume - nicotinePgContribution - flavorPgContribution);
  const vgNeeded = Math.max(0, targetVgVolume - nicotineVgContribution - flavorVgContribution);

  // Calculate PG/VG percentages
  const pgPercent = (pgNeeded / targetVolume) * 100;
  const vgPercent = (vgNeeded / targetVolume) * 100;

  // Build result items
  if (nicotineIngredient) {
    items.push({
      ...nicotineIngredient,
      volumeMl: nicotineVolumeMl,
      gram: nicotineGram,
      percentage: nicotineIngredient.percentage || (nicotineVolumeMl / targetVolume) * 100,
    });
  }

  flavorResults.forEach(r => {
    items.push({
      ...r,
      percentage: r.percentage,
    });
  });

  pgIngredients.forEach(ing => {
    items.push({
      ...ing,
      volumeMl: pgNeeded,
      gram: pgNeeded * (ing.density || 1.036),
      percentage: pgPercent,
    });
  });

  vgIngredients.forEach(ing => {
    items.push({
      ...ing,
      volumeMl: vgNeeded,
      gram: vgNeeded * (ing.density || 1.261),
      percentage: vgPercent,
    });
  });

  // Calculate totals
  const totalVolume = items.reduce((sum, i) => sum + i.volumeMl, 0);
  const totalGram = items.reduce((sum, i) => sum + i.gram, 0);
  const totalPercentCalculated = items.reduce((sum, i) => sum + i.percentage, 0);
  const totalPg = nicotinePgContribution + flavorPgContribution + pgNeeded;
  const totalVg = nicotineVgContribution + flavorVgContribution + vgNeeded;

  // Validation
  const validation = {
    valid: true,
    errors: [],
    warnings: [],
  };

  if (Math.abs(totalPercentCalculated - 100) > 0.1) {
    validation.errors.push(`Total komposisi ${totalPercentCalculated.toFixed(2)}%, harus 100%`);
    validation.valid = false;
  }

  if (Math.abs(totalPg + totalVg - targetVolume) > 1) {
    validation.warnings.push(`Total PG+VG (${(totalPg + totalVg).toFixed(1)}ml) tidak sesuai target volume`);
  }

  if (pgNeeded < 0 || vgNeeded < 0) {
    validation.errors.push('Nilai PG/VG negatif — periksa persentase flavor atau target PG/VG');
    validation.valid = false;
  }

  items.forEach(i => {
    if (i.volumeMl < 0 || i.gram < 0) {
      validation.errors.push('Nilai negatif terdeteksi pada bahan');
      validation.valid = false;
    }
    if (['propylene_glycol', 'vegetable_glycerin', 'nicotine', 'flavor'].includes(i.material_type) && !i.density) {
      validation.errors.push(`Bahan cair "${i.material_name || i.material_type}" tidak memiliki density`);
      validation.valid = false;
    }
  });

  if (nicotineIngredient && !nicotineIngredient.nicotine_strength && targetNicotine > 0) {
    validation.errors.push('Bahan nicotine tidak memiliki kekuatan nicotine');
    validation.valid = false;
  }

  return {
    items,
    totalFlavor: totalFlavorPercent,
    totalPG: (totalPg / targetVolume) * 100,
    totalVG: (totalVg / targetVolume) * 100,
    totalVolume,
    totalGram,
    totalPercent: totalPercentCalculated,
    nicotineVolume: nicotineVolumeMl,
    pgNeeded,
    vgNeeded,
    validation,
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