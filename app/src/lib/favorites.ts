import { useCallback, useState } from 'react';

const KEY = 'paint-ai-favorite-shades';

function read(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

/** Favourite shade codes, remembered on this device. */
export function useFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(read);

  const toggle = useCallback((code: string) => {
    setFavorites((previous) => {
      const next = new Set(previous);

      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }

      try {
        localStorage.setItem(KEY, JSON.stringify([...next]));
      } catch {
        // Private browsing: favourites last for this visit only.
      }

      return next;
    });
  }, []);

  return { favorites, toggle };
}
