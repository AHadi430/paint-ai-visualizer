import { useState } from 'react';
import { HeartIcon, RollerIcon } from '../components/Icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { ShadePicker } from '../components/ShadePicker';
import { Sheet } from '../components/Sheet';
import { readableOn } from '../lib/color';
import { tapFeedback } from '../lib/haptics';
import { copyText } from '../lib/share';
import type { Shade } from '../types';

type Props = {
  shades: Shade[];
  favorites: Set<string>;
  onToggleFavorite: (code: string) => void;
  onTry: (shade: Shade) => void;
  onHome: () => void;
  notify: (message: string) => void;
};

/** The company shade card: browse, search and save favourites. */
export function ShadesScreen({
  shades,
  favorites,
  onToggleFavorite,
  onTry,
  onHome,
  notify,
}: Props) {
  const [detail, setDetail] = useState<Shade>();

  return (
    <div className="screen-content">
      <ScreenHeader
        title="Shade card"
        subtitle={shades.length ? `${shades.length} colours to explore` : undefined}
        onHome={onHome}
      />

      <ShadePicker
        shades={shades}
        favorites={favorites}
        onPick={(shade) => {
          tapFeedback();
          setDetail(shade);
        }}
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
