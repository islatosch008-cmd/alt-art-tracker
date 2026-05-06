import * as Crypto from 'expo-crypto';

// HaveIBeenPwned k-anonymity API: send only first 5 hex chars of SHA-1(password),
// receive a list of suffix:count pairs, locally check whether the rest of the
// hash is in that list. The full password never leaves the device.
//
// Returns the breach count (0 = not in any breach).
export async function checkPasswordBreach(password: string): Promise<number> {
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA1,
    password,
  );
  const upper = hash.toUpperCase();
  const prefix = upper.slice(0, 5);
  const suffix = upper.slice(5);

  const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    headers: { 'Add-Padding': 'true' },
  });
  if (!res.ok) {
    // Don't block signup on a HIBP outage — log and treat as non-breached.
    console.warn('HIBP request failed', res.status);
    return 0;
  }
  const text = await res.text();
  for (const line of text.split('\n')) {
    const [hashSuffix, countStr] = line.trim().split(':');
    if (hashSuffix === suffix) {
      return parseInt(countStr, 10) || 0;
    }
  }
  return 0;
}
