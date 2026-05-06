// US-first phone normalization. Phase 1 is US-only per spec; international
// users can still type a full +CC… number explicitly and it passes through.

const E164_ANY = /^\+[1-9]\d{7,14}$/;

// Accepts: "5125551234", "(512) 555-1234", "512-555-1234", "1 512 555 1234",
//          "+15125551234", "+447911123456" (international, explicit +)
// Returns E.164 string, or null if not parseable.
export function normalizeUSPhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Already E.164 (US or international) — accept verbatim.
  if (trimmed.startsWith('+') && E164_ANY.test(trimmed)) return trimmed;

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

// Display: "+15125551234" → "+1 (512) 555-1234". Other countries fall back
// to the raw E.164.
export function formatPhoneDisplay(e164: string): string {
  if (/^\+1\d{10}$/.test(e164)) {
    const d = e164.slice(2);
    return `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return e164;
}
