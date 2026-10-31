import { useMemo, useState } from 'react';
import { readableOn } from '../lib/color';
import { RANGE_INFO } from '../lib/ranges';
import type { Shade } from '../types';
import { CheckIcon, HeartIcon, SearchIcon } from './Icons';

const ALL = 'All';
const FAVORITES = 'Favourites';

// Remembered while the app is open, so the picker reopens on the range
// the customer chose (e.g. Weather Shine for an outside wall).
let lastRange = ALL;

type Props = {
  shades: Shade[];
  favorites: Set<string>;
  selectedCode?: string;
  onPick: (shade: Shade) => void;
  /** Colours already used, offered first for quick reuse. */
  recent?: Shade[];
  /** Number of swatches per row. */
  columns?: number;
};

/** Paint range tabs, search, colour family chips and a grid of swatches. */
export function ShadePicker({
  shades,
  favorites,
  selectedCode,
  onPick,
  recent = [],
  columns = 4,
}: Props) {
  const [query, setQuery] = useState('');
  const [range, setRange] = useState(lastRange);
  const [category, setCategory] = useState(ALL);

  const ranges = useMemo(
    () => Array.from(new Set(shades.map((shade) => shade.range))),
    [shades]
  );

  const activeRange = ranges.includes(range) ? range : ALL;

  const inRange = useMemo(
    () =>
      activeRange === ALL
        ? shades
        : shades.filter((shade) => shade.range === activeRange),
    [shades, activeRange]
  );

  const categories = useMemo(
    () => [
      ALL,
      ...(favorites.size ? [FAVORITES] : []),
      ...Array.from(new Set(inRange.map((shade) => shade.category))),
    ],
    [inRange, favorites.size]
  );

  // Keep the family when switching range, if that range has it.
  const activeCategory = categories.includes(category) ? category : ALL;

  const visible = inRange.filter((shade) => {
    const search = query.trim().toLowerCase();

    const matchesSearch =
      !search ||
      shade.name.toLowerCase().includes(search) ||
      shade.code.toLowerCase().includes(search);

    const matchesCategory =
      activeCategory === ALL ||
      (activeCategory === FAVORITES
        ? favorites.has(shade.code)
        : shade.category === activeCategory);

    return matchesSearch && matchesCategory;
  });

  // With all ranges shown, each range gets its own heading: the same
  // name (e.g. Off White) can be in more than one range.
  const groups =
    activeRange === ALL
      ? ranges
          .map((name) => ({
            name,
            shades: visible.filter((shade) => shade.range === name),
          }))
          .filter((group) => group.shades.length)
      : [{ name: activeRange, shades: visible }];

  if (shades.length === 0) {
    return <p className="muted center">Loading the shade card…</p>;
  }

  return (
    <div className="shade-picker">
      {recent.length > 0 && (
        <div className="recent-shades">
          <span className="picker-label">Used in this photo</span>

          <div className="chips">
            {recent.map((shade) => (
              <button
                key={shade.code}
                type="button"
                className={selectedCode === shade.code ? 'chip active' : 'chip'}
                onClick={() => onPick(shade)}
              >
                <i className="chip-dot" style={{ background: shade.hex }} />
                {shade.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {ranges.length > 1 && (
        <div className="range-tabs" role="tablist" aria-label="Paint range">
          {[ALL, ...ranges].map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={activeRange === name}
              className={activeRange === name ? 'range-tab active' : 'range-tab'}
              onClick={() => {
                lastRange = name;
                setRange(name);
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {RANGE_INFO[activeRange] && (
        <p className="range-info">{RANGE_INFO[activeRange]}</p>
      )}

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
            aria-selected={activeCategory === name}
            className={activeCategory === name ? 'chip active' : 'chip'}
            onClick={() => setCategory(name)}
          >
            {name === FAVORITES && <HeartIcon size={14} filled />}
            {name}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="muted center">
          {query.trim()
            ? `No shades match “${query.trim()}”.`
            : 'No shades to show here.'}
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.name} className="swatch-section">
            {activeRange === ALL && (
              <h5 className="swatch-group">
                {group.name}
                <small>{group.shades.length}</small>
              </h5>
            )}

            <div
              className="swatch-grid"
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            >
              {group.shades.map((shade) => (
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
                    {shade.new && <span className="swatch-new">New</span>}
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
          </section>
        ))
      )}
    </div>
  );
}
