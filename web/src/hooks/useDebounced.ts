import { useEffect, useState } from "react";

// Returns `value`, but only after it has stopped changing for `ms` (e.g. a search box: one
// request when the user pauses typing, not one per keystroke).
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
