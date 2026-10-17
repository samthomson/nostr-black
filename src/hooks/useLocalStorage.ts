import { useState, useEffect } from 'react';

/**
 * Generic hook for managing localStorage state
 */
export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
  serializer?: {
    serialize: (value: T) => string;
    deserialize: (value: string) => T;
  }
) {
  const serialize = serializer?.serialize || JSON.stringify;
  const deserialize = serializer?.deserialize || JSON.parse;

  const [state, setState] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key);
      return item ? deserialize(item) : defaultValue;
    } catch (error) {
      console.warn(`Failed to load ${key} from localStorage:`, error);
      return defaultValue;
    }
  });

  const setValue = (value: T | ((prev: T) => T)) => {
    // Functional update: read the latest committed state, never the value
    // this closure was created with. `updateConfig` is memoized with [] so
    // a stale `state` here would silently drop every other config field.
    setState((prev) => {
      const next = value instanceof Function ? value(prev) : value;
      try {
        localStorage.setItem(key, serialize(next));
      } catch (error) {
        console.warn(`Failed to save ${key} to localStorage:`, error);
      }
      return next;
    });
  };

  // Sync with localStorage changes from other tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key && e.newValue !== null) {
        try {
          setState(deserialize(e.newValue));
        } catch (error) {
          console.warn(`Failed to sync ${key} from localStorage:`, error);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key, deserialize]);

  return [state, setValue] as const;
}