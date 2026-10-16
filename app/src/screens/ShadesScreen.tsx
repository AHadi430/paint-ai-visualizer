import { useState } from 'react';
import { HeartIcon, RollerIcon } from '../components/Icons';
import { ShadePicker } from '../components/ShadePicker';
import { Sheet } from '../components/Sheet';
import { readableOn } from '../lib/color';
import { copyText } from '../lib/share';
import type { Shade } from '../types';

type Props = {
  shades: Shade[];
  favorites: Set<string>;
  onToggleFavorite: (code: string) => void;
  onTry: (shade: Shade) => void;
  notify: (message: string) => void;
};

/** The company shade card: browse, search and save favourites. */
export function ShadesScreen({
  shades,
  favorites,
  onToggleFavorite,
  onTry,
  notify,
}: Props) {
  const [detail, setDetail] = useState<Shade>();

  return (
    <div className="screen-content">
      <header className="topbar">
        <div>
          <span className="brand">PAINT AI</span>
          <h1>Shade card</h1>
        </div>
        <span className="count">{shades.length} shades</span>
      </header>

      <ShadePicker
        shades={shades}
        favorites={favorites}
        onPick={setDetail}
        columns={3}
      />

      {detail && (
        <Sheet title={detail.name} onClose={() => setDetail(undefined)}>
          <div
            className="shade-detail"
            style={{ background: detail.hex, color: readableOn(detail.hex) }}
          >
            <span>{detail.category}</span>
            <strong>{detail.name}</strong>
            <span>Shade {detail.code}</span>
          </div>

          <dl className="facts">
            <div>
              <dt>Code</dt>
              <dd>{detail.code}</dd>
            </div>
            <div>
              <dt>Colour</dt>
              <dd>
                <button
                  type="button"
                  className="link"
                  onClick={async () =>
                    notify(
                      (await copyText(detail.hex))
                        ? `Copied ${detail.hex}`
                        : detail.hex
                    )
                  }
                >
                  {detail.hex}
                </button>
              </dd>
            </div>
            <div>
              <dt>Family</dt>
              <dd>{detail.category}</dd>
            </div>
          </dl>

          <div className="sheet-actions">
            <button
              type="button"
              className="btn secondary"
              onClick={() => onToggleFavorite(detail.code)}
              aria-pressed={favorites.has(detail.code)}
            >
              <HeartIcon filled={favorites.has(detail.code)} />
              {favorites.has(detail.code) ? 'Saved' : 'Save'}
            </button>

            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setDetail(undefined);
                onTry(detail);
              }}
            >
              <RollerIcon />
              Try on my wall
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
