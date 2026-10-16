import { useMemo, useState } from 'react';
import { readableOn } from '../lib/color';
import type { Shade } from '../types';
import { CheckIcon, HeartIcon, SearchIcon } from './Icons';

const FAVORITES = 'Favourites';

type Props = {
  shades: Shade[];
  favorites: Set<string>;
  selectedCode?: string;
  onPick: (shade: Shade) => void;
  /** Number of swatches per row. */
  columns?: number;
};

/** Search, category chips and a grid of swatches. */
export function ShadePicker({
  shades,
  favorites,
  selectedCode,
  onPick,
  columns = 4,
}: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');

  const categories = useMemo(
    () => [
      'All',
      ...(favorites.size ? [FAVORITES] : []),
      ...Array.from(new Set(shades.map((shade) => shade.category))),
    ],
    [shades, favorites.size]
  );

  const visible = shades.filter((shade) => {
    const search = query.trim().toLowerCase();

    const matchesSearch =
      !search ||
      shade.name.toLowerCase().includes(search) ||
      shade.code.toLowerCase().includes(search);

    const matchesCategory =
      category === 'All' ||
      (category === FAVORITES
        ? favorites.has(shade.code)
        : shade.category === category);

    return matchesSearch && matchesCategory;
  });

  if (shades.length === 0) {
    return <p className="muted center">Loading the shade card…</p>;
  }

  return (
    <div className="shade-picker">
      <label className="search">
        <SearchIcon size={18} />
        <input
          type="search"
          placeholder="Search name or code"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <div className="chips" role="tablist">
        {categories.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={category === name}
            className={category === name ? 'chip active' : 'chip'}
            onClick={() => setCategory(name)}
          >
            {name === FAVORITES && <HeartIcon size={14} filled />}
            {name}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="muted center">No shades match “{query}”.</p>
      ) : (
        <div
          className="swatch-grid"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {visible.map((shade) => (
            <button
              key={shade.code}
              type="button"
              className={
                selectedCode === shade.code ? 'swatch selected' : 'swatch'
              }
              onClick={() => onPick(shade)}
              aria-pressed={selectedCode === shade.code}
            >
              <span
                className="swatch-color"
                style={{ background: shade.hex, color: readableOn(shade.hex) }}
              >
                {selectedCode === shade.code && (
                  <CheckIcon size={18} className="swatch-check" />
                )}
                {favorites.has(shade.code) && (
                  <HeartIcon size={12} filled className="swatch-fav" />
                )}
              </span>
              <span className="swatch-name">{shade.name}</span>
              <span className="swatch-code">{shade.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
