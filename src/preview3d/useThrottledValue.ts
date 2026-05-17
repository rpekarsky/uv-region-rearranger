import { useEffect, useRef, useState } from 'react';

export function useThrottledValue<T>(value: T, ms: number): T {
  const [throttled, setThrottled] = useState(value);
  const lastFireRef = useRef(0);

  useEffect(() => {
    const elapsed = Date.now() - lastFireRef.current;
    const wait = Math.max(0, ms - elapsed);
    const id = window.setTimeout(() => {
      lastFireRef.current = Date.now();
      setThrottled(value);
    }, wait);
    return () => clearTimeout(id);
  }, [value, ms]);

  return throttled;
}
