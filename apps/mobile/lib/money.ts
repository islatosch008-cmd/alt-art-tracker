// USD formatting. Drops the cents on amounts >= $100 to save horizontal space
// in tight grid cells; keeps cents below that for readability.
export function formatUsd(amount: number | null | undefined): string {
  if (amount == null) return '—';
  const opts: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: amount >= 100 ? 0 : 2,
    minimumFractionDigits: amount >= 100 ? 0 : 2,
  };
  return new Intl.NumberFormat('en-US', opts).format(amount);
}
