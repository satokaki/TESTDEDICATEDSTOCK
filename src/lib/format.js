/**
 * Shared currency/number formatters for LAB PRO.
 * Semua tampilan mata uang di seluruh app melewati formatCurrency agar
 * format (prefix Rp, grouping id-ID, presisi 2 desimal) konsisten.
 */

/** Format angka sebagai mata uang IDR: "Rp 5.878,67". Null/NaN/undefined → 0. */
export const formatCurrency = (v) =>
  'Rp ' + (Number(v) || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Format angka polos dengan grouping id-ID dan presisi yang dapat dikonfigurasi. */
export const formatNumber = (v, maximumFractionDigits = 2) =>
  (Number(v) || 0).toLocaleString('id-ID', { maximumFractionDigits });