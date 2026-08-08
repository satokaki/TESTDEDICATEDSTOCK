/**
 * HPP Product Calculator
 *
 * Priority:
 * 1. Actual StockLedger output.unit_cost
 * 2. Standard Recipe + ProductComponentMapping
 *
 * Recipe boleh berasal dari source product untuk kasus maklon.
 * Mapping selalu berasal dari final/result product.
 */

import { calculateRecipe } from './recipeCalculator';

function ingredientCost(item, material) {
  const price = Number(material?.last_purchase_price) || 0;
  const isMl = material?.unit === 'mililiter';
  const qty = isMl
    ? Number(item.volumeMl) || 0
    : Number(item.gram) || 0;

  return {
    qty,
    unitLabel: isMl ? 'ml' : 'g',
    unitCost: price,
    cost: qty * price,
  };
}

const STAGE_PRIORITY = {
  excise_output: 4,
  labeling_output: 3,
  bottling_output: 2,
  production_output: 1,
  premix_output: 1,
};

function ledgerTime(row) {
  return new Date(
    row?.transaction_date ||
    row?.created_date ||
    0
  ).getTime();
}

export function getActualHppFromLedger(stockLedger, productId) {
  if (!Array.isArray(stockLedger) || !productId) return null;

  const outputs = stockLedger
    .filter(row =>
      row?.item_id === productId &&
      String(row?.transaction_type || '').endsWith('_output') &&
      Number(row?.quantity_in) > 0 &&
      Number(row?.unit_cost) > 0
    )
    .sort((a, b) => {
      const stage =
        (STAGE_PRIORITY[b.transaction_type] || 0) -
        (STAGE_PRIORITY[a.transaction_type] || 0);

      return stage || ledgerTime(b) - ledgerTime(a);
    });

  if (!outputs.length) return null;

  const latest = outputs[0];
  const outputQty = Number(latest.quantity_in) || 1;

  const refs = latest.reference_id
    ? stockLedger.filter(
        row => row.reference_id === latest.reference_id
      )
    : [];

  let previousStagePerBottle = 0;
  let bottlePerBottle = 0;
  let labelPerBottle = 0;
  let excisePerBottle = 0;

  if (latest.transaction_type === 'bottling_output') {
    const input = refs.find(
      row => row.transaction_type === 'bottling_consumption'
    );

    if (input) {
      const total =
        (Number(input.unit_cost) || 0) *
        (Number(input.quantity_out) || 0);

      previousStagePerBottle = total / outputQty;
    }

    const cost = refs
      .filter(
        row =>
          row.transaction_type ===
          'bottling_bottle_consumption'
      )
      .reduce(
        (sum, row) =>
          sum +
          (Number(row.unit_cost) || 0) *
          (Number(row.quantity_out) || 0),
        0
      );

    bottlePerBottle = cost / outputQty;
  }

  if (latest.transaction_type === 'labeling_output') {
    const input = refs.find(
      row => row.transaction_type === 'labeling_consumption'
    );

    previousStagePerBottle =
      Number(input?.unit_cost) || 0;

    const cost = refs
      .filter(
        row => row.transaction_type === 'label_consumption'
      )
      .reduce(
        (sum, row) =>
          sum +
          (Number(row.unit_cost) || 0) *
          (Number(row.quantity_out) || 0),
        0
      );

    labelPerBottle = cost / outputQty;
  }

  if (latest.transaction_type === 'excise_output') {
    const input = refs.find(
      row =>
        row.transaction_type === 'excise_consumption' &&
        row.item_type === 'product'
    );

    previousStagePerBottle =
      Number(input?.unit_cost) || 0;

    const cost = refs
      .filter(
        row =>
          row.transaction_type === 'excise_consumption' &&
          row.item_type === 'material'
      )
      .reduce(
        (sum, row) =>
          sum +
          (Number(row.unit_cost) || 0) *
          (Number(row.quantity_out) || 0),
        0
      );

    excisePerBottle = cost / outputQty;
  }

  if (
    latest.transaction_type === 'production_output' ||
    latest.transaction_type === 'premix_output'
  ) {
    previousStagePerBottle =
      Number(latest.unit_cost) || 0;
  }

  return {
    actualHppPerUnit: Number(latest.unit_cost) || 0,
    previousStagePerBottle,
    bottlePerBottle,
    labelPerBottle,
    excisePerBottle,
    transactionType: latest.transaction_type,
    stage: latest.inventory_status || '',
    batchNumber: latest.batch_number || '',
    referenceId: latest.reference_id || '',
    outputQty,
  };
}

export function computeProductHpp({
  product,
  recipe,
  ingredients,
  materials,
  mappings,
  pgMaterial,
  vgMaterial,
  stockLedger,
}) {
  if (!product) return null;

  const bottleSize = Number(product.bottle_size) || 0;
  const volume =
    Number(recipe?.target_volume) ||
    bottleSize ||
    0;

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
    useActual: false,
    actualHpp: null,
  };

  const matById = id =>
    (materials || []).find(m => m.id === id);

  /*
   * RECIPE / BULK
   * Optional.
   * Produk maklon boleh memakai recipe source product.
   */
  if (recipe) {
    const calc = calculateRecipe({
      ingredients: (ingredients || []).map(item => ({
        ...item,
        percentage: Number(item.percentage) || 0,
      })),
      targetVolume: volume,
      targetNicotine: recipe.target_nicotine,
      targetPG: recipe.target_pg,
      targetVG: recipe.target_vg,
      pgMaterial,
      vgMaterial,
    });

    result.validation = calc.validation;

    result.bulkRows = calc.items.map(item => {
      const mat = matById(item.material_id);

      return {
        ...ingredientCost(item, mat),
        materialId: item.material_id,
        materialName:
          item.material_name ||
          mat?.name ||
          (item.isAuto ? 'Auto' : '—'),
        materialCode: mat?.code || '',
        materialType: item.material_type,
        isPremix: !!item.is_premix,
        isAuto: !!item.isAuto,
        percentage: item.percentage,
      };
    });

    result.bulkTotal = result.bulkRows.reduce(
      (sum, row) => sum + row.cost,
      0
    );

    result.costPerMl =
      volume > 0
        ? result.bulkTotal / volume
        : 0;

    result.bulkPerBottle =
      bottleSize > 0
        ? result.costPerMl * bottleSize
        : 0;
  }

  /*
   * PRODUCT COMPONENT MAPPING
   *
   * PENTING:
   * Tidak tergantung Recipe.
   *
   * Jadi produk maklon tanpa resep sendiri
   * tetap membaca mapping botol/box/label/cukai.
   */
  const activeMappings = (mappings || []).filter(
    mapping => mapping.is_active !== false
  );

  const buildComp = type =>
    activeMappings
      .filter(
        mapping =>
          mapping.component_type === type
      )
      .map(mapping => {
        const mat =
          matById(mapping.material_id);

        const price =
          Number(mat?.last_purchase_price) || 0;

        const qty =
          Number(mapping.quantity_per_unit) || 1;

        return {
          materialId: mapping.material_id,
          materialName:
            mapping.material_name ||
            mat?.name ||
            '—',
          materialCode:
            mapping.material_code ||
            mat?.code ||
            '',
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

  result.bottleTotal =
    result.bottleRows.reduce(
      (sum, row) => sum + row.cost,
      0
    );

  result.boxTotal =
    result.boxRows.reduce(
      (sum, row) => sum + row.cost,
      0
    );

  result.labelTotal =
    result.labelRows.reduce(
      (sum, row) => sum + row.cost,
      0
    );

  result.exciseTotal =
    result.exciseRows.reduce(
      (sum, row) => sum + row.cost,
      0
    );

  /*
   * ACTUAL HPP
   */
  const actual =
    getActualHppFromLedger(
      stockLedger,
      product.id
    );

  if (actual) {
    result.useActual = true;
    result.actualHpp = actual;
    result.hppPerBottle =
      actual.actualHppPerUnit;

    if (
      actual.transactionType === 'production_output' ||
      actual.transactionType === 'premix_output'
    ) {
      result.bulkPerBottle =
        actual.actualHppPerUnit;
    }

    if (actual.transactionType === 'bottling_output') {
      result.bulkPerBottle =
        actual.previousStagePerBottle ||
        Math.max(
          0,
          actual.actualHppPerUnit -
          actual.bottlePerBottle
        );

      result.bottleTotal =
        actual.bottlePerBottle;
    }

    if (actual.transactionType === 'labeling_output') {
      /*
       * Previous stage sudah mengandung
       * bulk + bottling.
       */
      result.bulkPerBottle =
        actual.previousStagePerBottle;

      result.labelTotal =
        actual.labelPerBottle;
    }

    if (actual.transactionType === 'excise_output') {
      /*
       * Previous stage sudah mengandung
       * bulk + bottle + label.
       */
      result.bulkPerBottle =
        actual.previousStagePerBottle;

      result.exciseTotal =
        actual.excisePerBottle;
    }
  } else {
    result.hppPerBottle =
      result.bulkPerBottle +
      result.bottleTotal +
      result.boxTotal +
      result.labelTotal +
      result.exciseTotal;
  }

  result.margin =
    result.salePrice -
    result.hppPerBottle;

  result.marginPct =
    result.salePrice > 0
      ? (
          result.margin /
          result.salePrice
        ) * 100
      : 0;

  return result;
}