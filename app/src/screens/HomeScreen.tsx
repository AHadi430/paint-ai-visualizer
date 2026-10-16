import type { ComponentType } from 'react';
import {
  ArrowIcon,
  PipetteIcon,
  RollerIcon,
  SwatchesIcon,
} from '../components/Icons';
import { tapFeedback } from '../lib/haptics';
import type { Photo, Shade } from '../types';

export type Section = 'paint' | 'identify' | 'shades';

type Props = {
  shades: Shade[];
  favoriteCount: number;
  photo?: Photo;
  onOpen: (section: Section) => void;
  onTry: (shade: Shade) => void;
};

type Action = {
  section: Section;
  title: string;
  text: string;
  icon: ComponentType<{ size?: number }>;
};

/** Start screen: three big buttons, one per section. */
export function HomeScreen({
  shades,
  favoriteCount,
  photo,
  onOpen,
  onTry,
}: Props) {
  const actions: Action[] = [
    {
      section: 'paint',
      title: 'Paint my walls',
      text: 'Try our shades on a photo of your room',
      icon: RollerIcon,
    },
    {
      section: 'identify',
      title: 'Identify a colour',
      text: 'Tap any colour to find our closest shade',
      icon: PipetteIcon,
    },
    {
      section: 'shades',
      title: 'Browse shades',
      text: shades.length
        ? `${shades.length} colours${favoriteCount ? ` · ${favoriteCount} saved` : ''}`
        : 'Explore our full shade card',
      icon: SwatchesIcon,
    },
  ];

  const featured = colourfulShades(shades, 12);

  const open = (section: Section) => {
    tapFeedback();
    onOpen(section);
  };

  return (
    <div className="home">
      <div className="home-blobs" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <header className="home-header">
        <span className="home-logo" aria-hidden="true">
          <i />
        </span>
        <span className="brand">PAINT AI</span>
        <h1>
          Bring <span className="rainbow">colour</span>
          <br />
          to your walls
        </h1>
        <p>What would you like to do today?</p>
      </header>

      <nav className="home-actions" aria-label="Choose what to do">
        {actions.map(({ section, title, text, icon: Icon }, index) => (
          <button
            key={section}
            type="button"
            className={`home-card theme-${section}`}
            style={{ animationDelay: `${index * 70}ms` }}
            onClick={() => open(section)}
          >
            <span className="home-card-icon">
              <Icon size={30} />
            </span>

            <span className="home-card-text">
              <strong>{title}</strong>
              <small>{text}</small>
            </span>

            <ArrowIcon size={22} className="home-card-arrow" />
          </button>
        ))}
      </nav>

      {photo && (
        <button
          type="button"
          className="continue-card"
          onClick={() => open('paint')}
        >
          <img src={photo.url} alt="" />
          <span>
            <strong>Continue with your photo</strong>
            <small>Pick up where you left off</small>
          </span>
          <ArrowIcon size={20} />
        </button>
      )}

      {featured.length > 0 && (
        <section className="home-shades">
          <h4>Tap a colour to try it</h4>

          <div className="shade-dots">
            {featured.map((shade) => (
              <button
                key={shade.code}
                type="button"
                aria-label={`Try ${shade.name}`}
                title={shade.name}
                style={{ background: shade.hex }}
                onClick={() => {
                  tapFeedback();
                  onTry(shade);
                }}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Hue (0-360) and saturation (0-1) of a hex colour. */
function hueAndSaturation(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;

  const saturation =
    delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

  let hue = 0;

  if (delta !== 0) {
    hue =
      max === r
        ? ((g - b) / delta) % 6
        : max === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4;
  }

  return { hue: (hue * 60 + 360) % 360, saturation };
}

/**
 * The most colourful shades, in rainbow order, so the home screen
 * shows off the range rather than a row of whites.
 */
function colourfulShades(shades: Shade[], count: number): Shade[] {
  return shades
    .map((shade) => ({ shade, ...hueAndSaturation(shade.hex) }))
    .sort((a, b) => b.saturation - a.saturation)
    .slice(0, count)
    .sort((a, b) => a.hue - b.hue)
    .map(({ shade }) => shade);
}
