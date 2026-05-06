import { useEffect, useState } from 'react';

// Returns `value` after it's been stable for `delay` ms. Use to throttle a
// fast-changing input (text field) before it fans out to network calls.
export function useDebounce<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
