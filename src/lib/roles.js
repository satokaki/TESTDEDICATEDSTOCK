export const ROLES = [
  { value: 'admin', label: 'Administrator' },
  { value: 'user', label: 'Operator' },
];

export const roleLabel = (r) => ROLES.find((x) => x.value === r)?.label || (r || '—');