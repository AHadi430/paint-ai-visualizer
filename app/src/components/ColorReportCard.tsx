import { readableOn } from '../lib/color';
import type { ColorReport, Shade } from '../types';
import { HeartIcon, RollerIcon } from './Icons';

type Props = {
  report: ColorReport;
  /** Where the colour came from, e.g. "Whole surface". */
  source: string;
  unevenLighting?: boolean;
  favorites: Set<string>;
  onToggleFavorite: (code: string) => void;
  onTry: (shade: Shade) => void;
  onCopy: (text: string) => void;
};

/** What the colour picker found, and the closest shade-card colours. */
export function ColorReportCard({
  report,
  source,
  unevenLighting,
  favorites,
  onToggleFavorite,
  onTry,
  onCopy,
}: Props) {
  const rgb = report.rgb.join(', ');

  return (
    <article className="report">
      <div
        className="report-hero"
        style={{ background: report.hex, color: readableOn(report.hex) }}
      >
        <span className="report-source">{source}</span>
        <h3>{report.name}</h3>

        <div className="report-codes">
          <button type="button" onClick={() => onCopy(report.hex)}>
            {report.hex}
          </button>
          <button type="button" onClick={() => onCopy(`rgb(${rgb})`)}>
            RGB {rgb}
          </button>
        </div>
      </div>

      <div className="report-tags">
        <span>{report.temperature} tone</span>
        <span>{report.lightness}</span>
        <span>{report.family}</span>
      </div>

      {unevenLighting && (
        <p className="note">
          The light changes across this surface, so this is its average
          colour. Try tapping an evenly lit part for a closer reading.
        </p>
      )}

      <h4>Closest from our shade card</h4>

      <ul className="matches">
        {report.matches.map((shade) => (
          <li key={shade.code}>
            <span className="match-swatch" style={{ background: shade.hex }} />

            <div className="match-text">
              <strong>{shade.name}</strong>
              <small>
                {shade.code} · <MatchBadge match={shade.match} />
              </small>
            </div>

            <button
              type="button"
              className="icon-btn"
              aria-label={
                favorites.has(shade.code)
                  ? `Remove ${shade.name} from favourites`
                  : `Add ${shade.name} to favourites`
              }
              onClick={() => onToggleFavorite(shade.code)}
            >
              <HeartIcon filled={favorites.has(shade.code)} />
            </button>

            <button
              type="button"
              className="btn small"
              onClick={() => onTry(shade)}
            >
              <RollerIcon size={16} />
              Try
            </button>
          </li>
        ))}
      </ul>

      <p className="fine-print">
        Colours in photos depend on lighting and the camera. Check the
        final choice against a physical shade card.
      </p>
    </article>
  );
}

function MatchBadge({ match }: { match: string }) {
  const tone =
    match === 'Excellent match'
      ? 'good'
      : match === 'Very close'
        ? 'ok'
        : 'far';

  return <span className={`match-badge ${tone}`}>{match}</span>;
}
