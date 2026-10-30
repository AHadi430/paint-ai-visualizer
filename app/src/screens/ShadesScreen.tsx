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
  const rangeCount = new Set(shades.map((shade) => shade.range)).size;

  return (
    <div className="screen-content">
      <ScreenHeader
        title="Shade card"
        subtitle={
          shades.length
            ? `${shades.length} colours in ${rangeCount} paint range${rangeCount === 1 ? '' : 's'}`
            : undefined
        }
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
            <span>{detail.range}</span>
            <strong>{detail.name}</strong>
            <span>
              Shade {detail.code}
              {detail.new && ' · New'}
            </span>
          </div>

          <dl className="facts">
            <div>
              <dt>Range</dt>
              <dd>{detail.range}</dd>
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

          {detail.special && (
            <p className="note">
              Special price. A dark colour: apply it with a roller for the
              best finish.
            </p>
          )}

          {detail.approximate && (
            <p className="note">
              A very pale shade, so it may look whiter on screen than on
              the wall. Check the printed shade card before you buy.
            </p>
          )}

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
