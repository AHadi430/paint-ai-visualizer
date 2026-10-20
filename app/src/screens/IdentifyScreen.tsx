import { useEffect, useState, type ReactNode } from 'react';
import { freshUrl, getPalette, identifyColor } from '../api';
import { ColorReportCard } from '../components/ColorReportCard';
import { CameraIcon, PipetteIcon, SparkleIcon, TapIcon } from '../components/Icons';
import { PhotoButtons, PhotoEmptyState } from '../components/PhotoPicker';
import { PhotoStage } from '../components/PhotoStage';
import { ScreenHeader } from '../components/ScreenHeader';
import { Sheet } from '../components/Sheet';
import { successFeedback, tapFeedback } from '../lib/haptics';
import { highlightUrl } from '../lib/mask';
import { copyText } from '../lib/share';
import type { ColorReport, PaletteColor, Photo, Point, Shade } from '../types';

type Props = {
  photo?: Photo;
  uploading: boolean;
  onPickPhoto: (file: File) => void;
  favorites: Set<string>;
  onToggleFavorite: (code: string) => void;
  onTry: (shade: Shade) => void;
  onHome: () => void;
  notify: (message: string) => void;
};

type Reading = {
  report: ColorReport;
  source: string;
  unevenLighting?: boolean;
};

export function IdentifyScreen({
  photo,
  uploading,
  onPickPhoto,
  favorites,
  onToggleFavorite,
  onTry,
  onHome,
  notify,
}: Props) {
  const [mode, setMode] = useState<'surface' | 'point'>('surface');
  const [reading, setReading] = useState<Reading>();
  const [marker, setMarker] = useState<Point>();
  const [highlight, setHighlight] = useState<string>();
  const [palette, setPalette] = useState<PaletteColor[]>();
  const [busy, setBusy] = useState<string>();
  const [changingPhoto, setChangingPhoto] = useState(false);

  // New photo: clear the old reading and find its main colours.
  useEffect(() => {
    setReading(undefined);
    setMarker(undefined);
    setHighlight(undefined);
    setPalette(undefined);
    setChangingPhoto(false);

    if (!photo) {
      return;
    }

    let cancelled = false;

    getPalette(photo.id)
      .then((colors) => !cancelled && setPalette(colors))
      .catch(() => !cancelled && setPalette([]));

    return () => {
      cancelled = true;
    };
  }, [photo?.id]);

  async function handleTap(point: Point, percent: Point) {
    if (!photo || busy) {
      return;
    }

    tapFeedback();
    setMarker(percent);
    setHighlight(undefined);
    setBusy(mode === 'surface' ? 'Finding the surface…' : 'Reading the colour…');

    try {
      const result = await identifyColor(photo.id, point.x, point.y, mode);

      setReading({
        report: result,
        source:
          result.mode === 'surface' ? 'Surface you tapped' : 'Spot you tapped',
        unevenLighting: result.uneven_lighting,
      });

      successFeedback();

      if (result.mask_url) {
        setHighlight(
          await highlightUrl(freshUrl(result.mask_url), [255, 255, 255], 40)
        );
      }
    } catch (error) {
      notify(
        error instanceof Error ? error.message : 'Could not read that colour.'
      );
    } finally {
      setBusy(undefined);
    }
  }

  function showPaletteColor(color: PaletteColor) {
    setMarker(undefined);
    setHighlight(undefined);
    setReading({
      report: color,
      source: `${Math.round(color.share * 100)}% of your photo`,
    });
  }

  async function copy(text: string) {
    notify((await copyText(text)) ? `Copied ${text}` : text);
  }

  const header = (actions?: ReactNode) => (
    <ScreenHeader
      title="Identify colour"
      subtitle="Find any colour in a photo"
      onHome={onHome}
    >
      {actions}
    </ScreenHeader>
  );

  if (!photo) {
    return (
      <div className="screen-content">
        {header()}

        <PhotoEmptyState
          icon={<PipetteIcon size={34} />}
          title="Find the colour of any wall"
          text="Take a photo of a colour you like. Our AI reads it and finds the closest shades from our card."
          steps={[
            'Take or choose a photo',
            'Tap the colour you want to know',
            'See its name and our closest shades',
          ]}
          onPick={onPickPhoto}
          disabled={uploading}
        />
      </div>
    );
  }

  return (
    <div className="screen-content">
      {header(
        <button
          type="button"
          className="icon-btn"
          aria-label="New photo"
          onClick={() => setChangingPhoto(true)}
          disabled={!!busy || uploading}
        >
          <CameraIcon />
        </button>
      )}

      <div className="segmented" role="radiogroup" aria-label="What to read">
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'surface'}
          className={mode === 'surface' ? 'active' : ''}
          onClick={() => setMode('surface')}
        >
          <SparkleIcon size={16} />
          Whole surface
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={mode === 'point'}
          className={mode === 'point' ? 'active' : ''}
          onClick={() => setMode('point')}
        >
          <PipetteIcon size={16} />
          Exact spot
        </button>
      </div>

      <PhotoStage
        src={photo.url}
        alt="Your photo"
        onTap={handleTap}
        busyLabel={busy}
      >
        {highlight && <img className="overlay" src={highlight} alt="" />}

        {marker && (
          <span
            className="pin"
            style={{
              left: `${marker.x}%`,
              top: `${marker.y}%`,
              background: reading?.report.hex,
            }}
          />
        )}
      </PhotoStage>

      {!reading && (
        <p className="hint">
          <TapIcon size={18} />
          {mode === 'surface'
            ? 'Tap a wall or surface: the AI reads its overall colour.'
            : 'Tap the exact spot whose colour you want.'}
        </p>
      )}

      <section className="palette">
        <h4>Colours in this photo</h4>

        {!palette ? (
          <p className="muted">Finding the main colours…</p>
        ) : palette.length === 0 ? (
          <p className="muted">Could not find the main colours.</p>
        ) : (
          <div className="palette-row">
            {palette.map((color) => (
              <button
                key={color.hex}
                type="button"
                className={
                  reading?.report.hex === color.hex
                    ? 'palette-chip active'
                    : 'palette-chip'
                }
                onClick={() => showPaletteColor(color)}
              >
                <span style={{ background: color.hex }} />
                <small>{color.name}</small>
              </button>
            ))}
          </div>
        )}
      </section>

      {reading && (
        <ColorReportCard
          report={reading.report}
          source={reading.source}
          unevenLighting={reading.unevenLighting}
          favorites={favorites}
          onToggleFavorite={onToggleFavorite}
          onTry={onTry}
          onCopy={copy}
        />
      )}

      {changingPhoto && (
        <Sheet title="New photo" onClose={() => setChangingPhoto(false)}>
          <PhotoButtons
            onPick={(file) => {
              setChangingPhoto(false);
              onPickPhoto(file);
            }}
            disabled={uploading}
          />
        </Sheet>
      )}
    </div>
  );
}
