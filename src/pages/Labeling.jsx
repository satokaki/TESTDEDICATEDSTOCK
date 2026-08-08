import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import FormModal from '@/components/FormModal';
import StatusBadge from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import NumberInput from '@/components/NumberInput';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus } from 'lucide-react';
import { generateOrderNumber } from '@/lib/sequence';
import {
  recordStockMovement,
  getAllStockBalances,
  createAuditLog,
} from '@/lib/stockUtils';
import { getInventoryDisplayName } from '@/lib/inventoryDisplay';

const emptyForm = () => ({
  stock_id: '',

  source_product_id: '',
  source_product_name: '',

  result_brand_id: '',
  result_brand_name: '',
  result_product_id: '',
  result_product_name: '',

  batch_id: '',
  batch_number: '',
  bottle_size: '',
  available_qty: '',
  quantity: '',

  labeling_date: new Date().toISOString().slice(0, 10),
  operator: '',
  notes: '',
  labels: [],
});

export default function Labeling() {
  const { toast } = useToast();

  const [data, setData] = useState([]);
  const [siapLabelStock, setSiapLabelStock] = useState([]);

  const [products, setProducts] = useState([]);
  const [brands, setBrands] = useState([]);

  const [labelMaterials, setLabelMaterials] = useState([]);
  const [labelStocks, setLabelStocks] = useState({});

  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState(emptyForm());
  const [labelSearch, setLabelSearch] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);

    try {
      const [
        orders,
        productBalances,
        productRows,
        brandRows,
        materials,
        materialBalances,
        labelProducts,
      ] = await Promise.all([
        base44.entities.LabelingOrder.list('-created_date', 100),
        getAllStockBalances('product'),
        base44.entities.Product.filter({ is_active: true }),
        base44.entities.Brand.filter({ is_active: true }),
        base44.entities.Material.filter(
          { is_active: true },
          '-created_date',
          500
        ),
        getAllStockBalances('material'),
        base44.entities.Product.filter({
          is_active: true,
          product_type: 'label',
        }),
      ]);

      setData(orders);

      setSiapLabelStock(
        productBalances.filter(
          b =>
            b.inventory_status === 'READY_FOR_LABELING' &&
            Number(b.quantity) > 0
        )
      );

      setProducts(productRows);
      setBrands(brandRows);

      const materialLabels = materials.filter(
        m =>
          m.material_type === 'LABEL' ||
          m.material_type === 'STICKER'
      );

      const combinedLabels = [
        ...materialLabels,
        ...labelProducts,
      ];

      setLabelMaterials(combinedLabels);

      const labelIds = new Set(
        combinedLabels.map(item => item.id)
      );

      const stockMap = {};

      [...materialBalances, ...productBalances].forEach(balance => {
        if (!labelIds.has(balance.item_id)) return;

        stockMap[balance.item_id] =
          (stockMap[balance.item_id] || 0) +
          (Number(balance.available_quantity) || 0);
      });

      setLabelStocks(stockMap);
    } catch {
      toast({
        variant: 'destructive',
        title: 'Gagal memuat data',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const buildLabels = useCallback(
    () =>
      labelMaterials.map(item => ({
        material_id: item.id,
        material_name: item.name,
        material_code: item.code || '',
        unit: item.unit || 'unit',
        quantity_per_unit: '1',
        stock: labelStocks[item.id] || 0,
        checked: false,
      })),
    [labelMaterials, labelStocks]
  );

  const openAdd = () => {
    setForm({
      ...emptyForm(),
      labels: buildLabels(),
    });

    setLabelSearch('');
    setModalOpen(true);
  };

  const onStockChange = stockId => {
    const stock = siapLabelStock.find(
      item => item.id === stockId
    );

    const sourceProduct = products.find(
      item => item.id === stock?.item_id
    );

    const sourceBrand = brands.find(
      item => item.id === sourceProduct?.brand_id
    );

    setForm(current => ({
      ...current,

      stock_id: stockId,

      source_product_id: stock?.item_id || '',
      source_product_name:
        sourceProduct?.name ||
        stock?.item_name ||
        '',

      /*
       * Default:
       * hasil labeling tetap produk/brand asal.
       *
       * Jika maklon, user cukup mengganti
       * Merk Hasil + Produk Hasil Labeling.
       */
      result_brand_id:
        sourceProduct?.brand_id || '',

      result_brand_name:
        sourceBrand?.name ||
        sourceProduct?.brand_name ||
        '',

      result_product_id:
        sourceProduct?.id || '',

      result_product_name:
        sourceProduct?.name || '',

      batch_id:
        stock?.batch_id || '',

      batch_number:
        stock?.batch_number || '',

      bottle_size:
        sourceProduct?.bottle_size ?? '',

      available_qty:
        stock?.available_quantity || '',

      quantity:
        String(stock?.available_quantity || ''),
    }));
  };

  /*
   * IDENTITY GATE
   *
   * Dropdown produk hasil HANYA bergantung
   * pada selected result brand.
   *
   * Tidak bergantung nama produk sumber.
   * Tidak memaksa brand asal.
   *
   * product_type label dikeluarkan karena
   * bukan finished product.
   */
  const resultProducts = useMemo(() => {
    if (!form.result_brand_id) return [];

    return products
      .filter(
        product =>
          product.brand_id === form.result_brand_id &&
          product.product_type !== 'label' &&
          product.is_active !== false
      )
      .sort((a, b) =>
        String(a.name || '').localeCompare(
          String(b.name || '')
        )
      );
  }, [products, form.result_brand_id]);

  const onResultBrandChange = brandId => {
    const brand = brands.find(
      item => item.id === brandId
    );

    const sourceProduct = products.find(
      item => item.id === form.source_product_id
    );

    /*
     * Kalau brand hasil = brand sumber,
     * source product boleh otomatis dipakai.
     *
     * Kalau berbeda brand (maklon),
     * product hasil WAJIB dipilih ulang.
     */
    const sameBrand =
      sourceProduct?.brand_id === brandId;

    setForm(current => ({
      ...current,

      result_brand_id: brandId,
      result_brand_name: brand?.name || '',

      result_product_id:
        sameBrand
          ? sourceProduct?.id || ''
          : '',

      result_product_name:
        sameBrand
          ? sourceProduct?.name || ''
          : '',
    }));
  };

  const onResultProductChange = productId => {
    const product = products.find(
      item => item.id === productId
    );

    setForm(current => ({
      ...current,

      result_product_id:
        product?.id || '',

      result_product_name:
        product?.name || '',

      /*
       * Output mengikuti bottle_size
       * product hasil bila tersedia.
       */
      bottle_size:
        product?.bottle_size ??
        current.bottle_size,
    }));
  };

  const updateLabel = (index, patch) => {
    setForm(current => ({
      ...current,
      labels: current.labels.map(
        (label, i) =>
          i === index
            ? { ...label, ...patch }
            : label
      ),
    }));
  };

  const handleSubmit = async () => {
    if (
      !form.stock_id ||
      !form.quantity ||
      !form.operator
    ) {
      toast({
        variant: 'destructive',
        title:
          'Batch, jumlah, operator wajib',
      });
      return;
    }

    if (
      !form.result_brand_id ||
      !form.result_product_id
    ) {
      toast({
        variant: 'destructive',
        title:
          'Merk hasil dan produk hasil labeling wajib dipilih',
      });
      return;
    }

    const qty = Number(form.quantity) || 0;
    const available =
      Number(form.available_qty) || 0;

    if (qty <= 0) {
      toast({
        variant: 'destructive',
        title: 'Jumlah labeling harus lebih dari 0',
      });
      return;
    }

    if (qty > available) {
      toast({
        variant: 'destructive',
        title:
          'Jumlah melebihi stok siap labeling',
        description:
          `Tersedia: ${available}`,
      });
      return;
    }

    const usedLabels = form.labels.filter(
      label => label.checked
    );

    if (!usedLabels.length) {
      toast({
        variant: 'destructive',
        title:
          'Pilih minimal satu label/stiker',
      });
      return;
    }

    for (const label of usedLabels) {
      const required =
        qty *
        (Number(label.quantity_per_unit) || 0);

      if (required > Number(label.stock || 0)) {
        toast({
          variant: 'destructive',
          title:
            `Stok "${label.material_name}" tidak cukup`,
          description:
            `Butuh ${required}, stok ${label.stock}`,
        });
        return;
      }
    }

    const sourceProduct = products.find(
      item =>
        item.id === form.source_product_id
    );

    const resultProduct = products.find(
      item =>
        item.id === form.result_product_id
    );

    const resultBrand = brands.find(
      item =>
        item.id === form.result_brand_id
    );

    if (!sourceProduct || !resultProduct) {
      toast({
        variant: 'destructive',
        title:
          'Produk sumber / produk hasil tidak valid',
      });
      return;
    }

    /*
     * Guard:
     * product hasil HARUS milik brand hasil.
     */
    if (
      resultProduct.brand_id !==
      form.result_brand_id
    ) {
      toast({
        variant: 'destructive',
        title:
          'Produk hasil tidak sesuai dengan merk hasil',
      });
      return;
    }

    setSubmitting(true);

    try {
      const labelingNumber =
        await generateOrderNumber(
          'LBL',
          'LabelingOrder'
        );

      const defaultLabel = usedLabels[0];

      /*
       * LabelingOrder menggunakan
       * IDENTITAS HASIL.
       */
      const order =
        await base44.entities.LabelingOrder.create({
          labeling_number:
            labelingNumber,

          brand_id:
            resultBrand?.id ||
            form.result_brand_id,

          brand_name:
            resultBrand?.name ||
            form.result_brand_name,

          product_id:
            resultProduct.id,

          product_name:
            resultProduct.name,

          batch_id:
            form.batch_id,

          batch_number:
            form.batch_number,

          bottle_size:
            Number(
              resultProduct.bottle_size ||
              form.bottle_size
            ) || 0,

          quantity: qty,

          label_type:
            defaultLabel.material_name,

          label_item_id:
            defaultLabel.material_id,

          label_item_code:
            defaultLabel.material_code,

          label_item_name:
            defaultLabel.material_name,

          label_quantity_per_unit:
            Number(
              defaultLabel.quantity_per_unit
            ) || 1,

          label_total_required:
            qty *
            (Number(
              defaultLabel.quantity_per_unit
            ) || 1),

          labeling_date:
            form.labeling_date,

          operator:
            form.operator,

          status:
            'belum_cukai',

          notes:
            form.notes,
        });

      /*
       * HPP INPUT SELALU dari product SOURCE
       * bottling_output.
       */
      const bottlingLedgers =
        await base44.entities.StockLedger.filter({
          batch_id:
            form.batch_id,

          item_id:
            sourceProduct.id,

          inventory_status:
            'READY_FOR_LABELING',

          transaction_type:
            'bottling_output',
        });

      const hppBottlingPerBottle =
        Number(
          bottlingLedgers[0]?.unit_cost
        ) || 0;

      if (hppBottlingPerBottle <= 0) {
        throw new Error(
          'HPP Bottling tidak ditemukan pada StockLedger.'
        );
      }

      const previousProductCost =
        qty * hppBottlingPerBottle;

      let totalLabelCost = 0;

      for (const label of usedLabels) {
        const quantityPerUnit =
          Number(label.quantity_per_unit) || 1;

        const totalRequired =
          qty * quantityPerUnit;

        const labelItem =
          labelMaterials.find(
            item =>
              item.id === label.material_id
          );

        const labelHpp =
          Number(
            labelItem?.last_purchase_price
          ) || 0;

        totalLabelCost +=
          totalRequired * labelHpp;

        await base44.entities.LabelingMaterial.create({
          labeling_id:
            order.id,

          labeling_number:
            labelingNumber,

          label_item_id:
            label.material_id,

          label_item_code:
            label.material_code,

          label_item_name:
            label.material_name,

          quantity_per_unit:
            quantityPerUnit,

          total_quantity_required:
            totalRequired,

          stock_before:
            Number(label.stock) || 0,

          stock_after:
            (Number(label.stock) || 0) -
            totalRequired,

          unit:
            label.unit,
        });

        await recordStockMovement({
          item_type: 'material',

          item_id:
            label.material_id,

          item_name:
            label.material_name,

          item_code:
            label.material_code,

          inventory_status: '',

          quantity_out:
            totalRequired,

          unit:
            label.unit,

          unit_cost:
            labelHpp,

          transaction_type:
            'label_consumption',

          transaction_number:
            labelingNumber,

          reference_type:
            'labeling',

          reference_id:
            order.id,

          notes:
            `Label untuk ${labelingNumber}`,
        });
      }

      const totalLabelingCost =
        previousProductCost +
        totalLabelCost;

      const hppLabelingPerBottle =
        qty > 0
          ? totalLabelingCost / qty
          : 0;

      const safeHppLabeling =
        Number.isFinite(
          hppLabelingPerBottle
        )
          ? hppLabelingPerBottle
          : 0;

      /*
       * SOURCE OUT
       *
       * Selalu mengurangi produk hasil Bottling.
       */
      await recordStockMovement({
        item_type: 'product',

        item_id:
          sourceProduct.id,

        item_name:
          sourceProduct.name,

        item_code:
          sourceProduct.code || '',

        batch_id:
          form.batch_id,

        batch_number:
          form.batch_number,

        inventory_status:
          'READY_FOR_LABELING',

        quantity_out:
          qty,

        unit:
          'unit',

        unit_cost:
          hppBottlingPerBottle,

        transaction_type:
          'labeling_consumption',

        transaction_number:
          labelingNumber,

        reference_type:
          'labeling',

        reference_id:
          order.id,

        notes:
          `Labeling ${labelingNumber}`,
      });

      /*
       * IDENTITY GATE OUTPUT
       *
       * Ini titik utama rebrand/maklon.
       *
       * SOURCE:
       * IZZI Mango
       *
       * RESULT:
       * JUCY Mango
       *
       * Stock UNEXCISED sekarang menjadi
       * product hasil labeling.
       */
      await recordStockMovement({
        item_type: 'product',

        item_id:
          resultProduct.id,

        item_name:
          resultProduct.name,

        item_code:
          resultProduct.code || '',

        batch_id:
          form.batch_id,

        batch_number:
          form.batch_number,

        inventory_status:
          'UNEXCISED',

        quantity_in:
          qty,

        unit:
          'unit',

        unit_cost:
          safeHppLabeling,

        transaction_type:
          'labeling_output',

        transaction_number:
          labelingNumber,

        reference_type:
          'labeling',

        reference_id:
          order.id,

        notes:
          sourceProduct.id === resultProduct.id
            ? `Output labeling ${labelingNumber}`
            : `Output maklon ${sourceProduct.name} → ${resultProduct.name}`,
      });

      await createAuditLog({
        module:
          'Labeling',

        action:
          sourceProduct.id === resultProduct.id
            ? 'Selesai'
            : 'Selesai Maklon',

        entity_type:
          'LabelingOrder',

        entity_id:
          order.id,

        reference_number:
          labelingNumber,
      });

      toast({
        title: 'Labeling selesai',
        description:
          sourceProduct.id === resultProduct.id
            ? labelingNumber
            : `${labelingNumber} · ${sourceProduct.name} → ${resultProduct.name}`,
      });

      setModalOpen(false);
      await loadData();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Gagal menyimpan',
        description:
          error?.message ||
          'Terjadi kesalahan',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    {
      key: 'labeling_number',
      header: 'No. Labeling',
      sortable: true,
      className:
        'font-mono font-medium',
    },
    {
      key: 'product_name',
      header: 'Produk Hasil',
      sortable: true,
      className: 'font-medium',
    },
    {
      key: 'brand_name',
      header: 'Merk Hasil',
      render: row =>
        row.brand_name || '—',
    },
    {
      key: 'batch_number',
      header: 'Batch',
      className: 'font-mono',
    },
    {
      key: 'quantity',
      header: 'Jumlah',
      render: row => (
        <span className="tabular-nums">
          {row.quantity}
        </span>
      ),
    },
    {
      key: 'labeling_date',
      header: 'Tanggal',
      sortable: true,
    },
    {
      key: 'status',
      header: 'Status',
      render: row => (
        <StatusBadge status={row.status} />
      ),
    },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader
        title="Labeling"
        description="Labeling = identity gate. Produk sumber READY_FOR_LABELING dapat tetap menjadi produk asal atau berubah menjadi produk/merk lain untuk maklon."
        actions={
          <Button
            onClick={openAdd}
            size="sm"
            className="gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Labeling Baru
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        emptyMessage="Belum ada labeling"
        searchKeys={[
          'labeling_number',
          'product_name',
          'brand_name',
          'batch_number',
        ]}
        searchPlaceholder="Cari labeling..."
      />

      <FormModal
        open={modalOpen}
        onClose={() =>
          setModalOpen(false)
        }
        title="Labeling Baru"
        onSubmit={handleSubmit}
        submitting={submitting}
        submitLabel="Proses Labeling"
        size="lg"
      >
        <div>
          <Label className="text-[12.5px] mb-1">
            Batch Siap Labeling *
          </Label>

          <Select
            value={form.stock_id}
            onValueChange={onStockChange}
          >
            <SelectTrigger className="h-9 text-[13px]">
              <SelectValue placeholder="Pilih batch siap labeling" />
            </SelectTrigger>

            <SelectContent>
              {siapLabelStock.map(stock => {
                const product =
                  products.find(
                    item =>
                      item.id === stock.item_id
                  );

                return (
                  <SelectItem
                    key={stock.id}
                    value={stock.id}
                  >
                    {getInventoryDisplayName(
                      product?.name ||
                        stock.item_name,
                      'READY_FOR_LABELING'
                    )}
                    {' '}
                    ({stock.available_quantity} unit)
                    {stock.batch_number
                      ? ` · ${stock.batch_number}`
                      : ''}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[12.5px] mb-1">
              Produk Sumber
            </Label>

            <Input
              value={
                form.source_product_name
              }
              disabled
              className="h-9 text-[13px] bg-muted/40"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Merk Hasil *
            </Label>

            <Select
              value={
                form.result_brand_id
              }
              onValueChange={
                onResultBrandChange
              }
            >
              <SelectTrigger className="h-9 text-[13px]">
                <SelectValue placeholder="Pilih merk hasil" />
              </SelectTrigger>

              <SelectContent>
                {brands.map(brand => (
                  <SelectItem
                    key={brand.id}
                    value={brand.id}
                  >
                    {brand.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Produk Hasil Labeling *
            </Label>

            <Select
              value={
                form.result_product_id
              }
              onValueChange={
                onResultProductChange
              }
              disabled={
                !form.result_brand_id
              }
            >
              <SelectTrigger className="h-9 text-[13px]">
                <SelectValue
                  placeholder={
                    form.result_brand_id
                      ? 'Pilih produk hasil'
                      : 'Pilih merk hasil dulu'
                  }
                />
              </SelectTrigger>

              <SelectContent>
                {resultProducts.map(product => (
                  <SelectItem
                    key={product.id}
                    value={product.id}
                  >
                    {product.name}
                    {product.bottle_size
                      ? ` · ${product.bottle_size}ml`
                      : ''}
                  </SelectItem>
                ))}

                {form.result_brand_id &&
                  resultProducts.length === 0 && (
                    <div className="px-2 py-2 text-[11px] text-amber-600">
                      Tidak ada Product aktif yang memiliki brand_id merk ini.
                      Periksa relasi Brand → Product di Master Barang.
                    </div>
                  )}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Batch
            </Label>

            <Input
              value={form.batch_number}
              disabled
              className="h-9 text-[13px] bg-muted/40"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Stok Tersedia (unit)
            </Label>

            <Input
              value={form.available_qty}
              disabled
              className="h-9 text-[13px] bg-muted/40"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Jumlah Dilabeli *
            </Label>

            <NumberInput
              value={form.quantity}
              onChange={value =>
                setForm(current => ({
                  ...current,
                  quantity: value,
                }))
              }
              allowDecimal={false}
              min={0}
              className="h-9 text-[13px]"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Tanggal
            </Label>

            <Input
              type="date"
              value={form.labeling_date}
              onChange={event =>
                setForm(current => ({
                  ...current,
                  labeling_date:
                    event.target.value,
                }))
              }
              className="h-9 text-[13px]"
            />
          </div>
        </div>

        <div>
          <Label className="text-[12.5px] mb-1">
            Label / Stiker
          </Label>

          {form.labels.length === 0 && (
            <p className="text-[11px] text-amber-600">
              Belum ada barang tipe Label/Stiker.
              Tambahkan di Master Barang.
            </p>
          )}

          <Input
            value={labelSearch}
            onChange={event =>
              setLabelSearch(
                event.target.value
              )
            }
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
              }
            }}
            placeholder="Cari nama/kode label/stiker..."
            className="h-8 text-[12px] mb-2"
          />

          <div className="space-y-1.5 max-h-52 overflow-auto border border-border rounded p-2">
            {(() => {
              const query =
                labelSearch
                  .trim()
                  .toLowerCase();

              const filtered =
                form.labels.filter(label =>
                  !query ||
                  String(
                    label.material_name || ''
                  )
                    .toLowerCase()
                    .includes(query) ||
                  String(
                    label.material_code || ''
                  )
                    .toLowerCase()
                    .includes(query)
                );

              if (!filtered.length) {
                return (
                  <p className="text-[11px] text-muted-foreground text-center py-3">
                    {form.labels.length
                      ? 'Tidak ditemukan.'
                      : 'Belum ada data.'}
                  </p>
                );
              }

              return filtered.map(label => {
                const index =
                  form.labels.findIndex(
                    item =>
                      item.material_id ===
                      label.material_id
                  );

                return (
                  <div
                    key={label.material_id}
                    className="flex items-center gap-2 border border-border rounded px-2 py-1.5 bg-muted/10"
                  >
                    <Checkbox
                      checked={
                        label.checked
                      }
                      onCheckedChange={value =>
                        updateLabel(index, {
                          checked: value,
                        })
                      }
                    />

                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-medium truncate">
                        {label.material_name}
                      </div>

                      <div className="text-[11px] text-muted-foreground">
                        Stok: {label.stock}{' '}
                        {label.unit}
                      </div>
                    </div>

                    <div className="w-24">
                      <NumberInput
                        value={
                          label.quantity_per_unit
                        }
                        onChange={value =>
                          updateLabel(index, {
                            quantity_per_unit:
                              value,
                          })
                        }
                        allowDecimal
                        min={0}
                        disabled={
                          !label.checked
                        }
                        className="h-8 text-[12px]"
                      />
                    </div>

                    <span className="text-[11px] text-muted-foreground">
                      /unit
                    </span>

                    <span className="text-[11px] tabular-nums w-20 text-right">
                      Butuh:{' '}
                      {label.checked
                        ? (Number(
                            form.quantity
                          ) || 0) *
                          (Number(
                            label.quantity_per_unit
                          ) || 0)
                        : 0}
                    </span>
                  </div>
                );
              });
            })()}
          </div>
        </div>

        <div>
          <Label className="text-[12.5px] mb-1">
            Operator *
          </Label>

          <Input
            value={form.operator}
            onChange={event =>
              setForm(current => ({
                ...current,
                operator:
                  event.target.value,
              }))
            }
            className="h-9 text-[13px]"
          />
        </div>

        <div>
          <Label className="text-[12.5px] mb-1">
            Catatan
          </Label>

          <Textarea
            value={form.notes}
            onChange={event =>
              setForm(current => ({
                ...current,
                notes:
                  event.target.value,
              }))
            }
            rows={2}
            className="text-[13px]"
          />
        </div>
      </FormModal>
    </div>
  );
}