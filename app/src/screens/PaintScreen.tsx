import { useEffect, useRef, useState, type ReactNode } from 'react';
import { findSurface, freshUrl, renderPaint } from '../api';
import {
  CameraIcon,
  CloseIcon,
  CompareIcon,
  RollerIcon,
  ShareIcon,
  TapIcon,
  UndoIcon,
} from '../components/Icons';
import { PhotoButtons, PhotoEmptyState } from '../components/PhotoPicker';
import { PhotoStage } from '../components/PhotoStage';
import { ShadePicker } from '../components/ShadePicker';
import { Sheet } from '../components/Sheet';
import { highlightUrl, maskContains } from '../lib/mask';
import { shareOrSave } from '../lib/share';
import type { Photo, Point, Shade, Wall } from '../types';

type Props = {
  photo?: Photo;
  uploading: boolean;
  onPickPhoto: (file: File) => void;
  shades: Shade[];
  favorites: Set<string>;
  /** Shade chosen elsewhere ("Try on my wall"), applied to the next wall. */
  pendingShade?: Shade;
  onPendingUsed: () => void;
  notify: (message: string) => void;
};

export function PaintScreen({
  photo,
  uploading,
  onPickPhoto,
  shades,
  favorites,
  pendingShade,
  onPendingUsed,
  notify,
}: Props) {
  const [walls, setWalls] = useState<Wall[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [history, setHistory] = useState<Wall[][]>([]);
  const [painted, setPainted] = useState<string>();
  const [comparing, setComparing] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [highlight, setHighlight] = useState<string>();
  const [changingPhoto, setChangingPhoto] = useState(false);
  const wallCounter = useRef(0);

  const selected = walls.find((wall) => wall.id === selectedId);

  const wallName = (id: string) =>
    `Wall ${walls.findIndex((wall) => wall.id === id) + 1}`;

  // A new photo starts a new project.
  useEffect(() => {
    setWalls([]);
    setSelectedId(undefined);
    setHistory([]);
    setPainted(undefined);
    setComparing(false);
    setChangingPhoto(false);
  }, [photo?.id]);

  // Mark the selected wall: a blue tint while it has no colour, only
  // an outline once painted so the real paint colour stays visible.
  const selectedPainted = !!selected?.shade;

  useEffect(() => {
    if (!selected) {
      setHighlight(undefined);
      return;
    }

    let url: string | undefined;
    let cancelled = false;

    highlightUrl(selected.maskUrl, undefined, selectedPainted ? 0 : 95)
      .then((value) => {
        url = value;
        if (!cancelled) {
          setHighlight(value);
        }
      })
      .catch(() => setHighlight(undefined));

    return () => {
      cancelled = true;
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [selected?.maskUrl, selectedPainted]);

  async function rerender(list: Wall[]) {
    if (!photo) {
      return;
    }

    const paintedWalls = list.filter((wall) => wall.shade);

    if (paintedWalls.length === 0) {
      setPainted(undefined);
      setComparing(false);
      return;
    }

    const { image_url } = await renderPaint(
      photo.id,
      paintedWalls.map((wall) => ({
        surface_id: wall.id,
        color: wall.shade!.hex,
      }))
    );

    setPainted(freshUrl(image_url));
  }

  async function paint(wallId: string, shade: Shade | undefined, base = walls) {
    const next = base.map((wall) =>
      wall.id === wallId ? { ...wall, shade } : wall
    );

    setBusy('Painting…');

    try {
      await rerender(next);
      setHistory((previous) => [...previous, base]);
      setWalls(next);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not paint the wall.');
    } finally {
      setBusy(undefined);
    }
  }

  async function handleTap(point: Point) {
    if (!photo || busy) {
      return;
    }

    // Tapping a wall that was already found selects it again.
    for (const wall of [...walls].reverse()) {
      if (await maskContains(wall.maskUrl, point.x, point.y)) {
        setSelectedId(wall.id);

        if (pendingShade) {
          await paint(wall.id, pendingShade);
          onPendingUsed();
        }

        return;
      }
    }

    setBusy('Finding the wall…');

    try {
      wallCounter.current += 1;
      const id = `wall_${wallCounter.current}`;

      const { mask_url } = await findSurface(photo.id, point.x, point.y, id);

      const wall: Wall = { id, maskUrl: freshUrl(mask_url) };
      const next = [...walls, wall];

      setWalls(next);
      setSelectedId(id);
      setBusy(undefined);

      if (pendingShade) {
        await paint(id, pendingShade, next);
        onPendingUsed();
      }
    } catch (error) {
      notify(
        error instanceof Error ? error.message : 'Could not find a wall there.'
      );
      setBusy(undefined);
    }
  }

  async function undo() {
    const previous = history[history.length - 1];

    if (!previous || busy) {
      return;
    }

    setBusy('Undoing…');

    try {
      await rerender(previous);
      setWalls(previous);
      setHistory((list) => list.slice(0, -1));

      if (!previous.some((wall) => wall.id === selectedId)) {
        setSelectedId(undefined);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not undo.');
    } finally {
      setBusy(undefined);
    }
  }

  async function share() {
    if (!painted) {
      return;
    }

    try {
      const result = await shareOrSave(
        painted,
        `paint-ai-${new Date().toISOString().slice(0, 10)}.png`,
        'My room in new colours'
      );

      if (result === 'saved') {
        notify('Image saved.');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save the image.');
    }
  }

  if (!photo) {
    return (
      <div className="screen-content">
        <Header />

        {pendingShade && (
          <PendingBanner shade={pendingShade} onClear={onPendingUsed} />
        )}

        <PhotoEmptyState
          icon={<RollerIcon size={34} />}
          title="See your walls in a new colour"
          text="Take a photo of a room or the outside of your home and try our shades on it in seconds."
          steps={[
            'Take or choose a photo',
            'Tap the wall you want to paint',
            'Pick a shade and compare before and after',
          ]}
          onPick={onPickPhoto}
          disabled={uploading}
        />
      </div>
    );
  }

  const paintedWalls = walls.filter((wall) => wall.shade);
  const sheetOpen = !!selected && !comparing;

  return (
    <div className={sheetOpen ? 'screen-content with-sheet' : 'screen-content'}>
      <Header>
        <button
          type="button"
          className="icon-btn"
          aria-label="Undo"
          onClick={undo}
          disabled={!history.length || !!busy}
        >
          <UndoIcon />
        </button>

        <button
          type="button"
          className={comparing ? 'icon-btn active' : 'icon-btn'}
          aria-label="Compare before and after"
          aria-pressed={comparing}
          onClick={() => {
            setComparing((value) => !value);
            setSelectedId(undefined);
          }}
          disabled={!painted || !!busy}
        >
          <CompareIcon />
        </button>

        <button
          type="button"
          className="icon-btn"
          aria-label="Share or save"
          onClick={share}
          disabled={!painted || !!busy}
        >
          <ShareIcon />
        </button>

        <button
          type="button"
          className="icon-btn"
          aria-label="New photo"
          onClick={() => setChangingPhoto(true)}
          disabled={!!busy || uploading}
        >
          <CameraIcon />
        </button>
      </Header>

      {pendingShade && (
        <PendingBanner shade={pendingShade} onClear={onPendingUsed} />
      )}

      <PhotoStage
        src={painted ?? photo.url}
        alt="Your photo"
        onTap={comparing ? undefined : handleTap}
        compareSrc={comparing ? photo.url : undefined}
        busyLabel={busy}
      >
        {highlight && <img className="overlay" src={highlight} alt="" />}
      </PhotoStage>

      {comparing ? (
        <p className="hint">
          <CompareIcon size={18} />
          Drag the slider to compare. Tap the compare button again to keep
          painting.
        </p>
      ) : sheetOpen ? null : paintedWalls.length === 0 ? (
        <p className="hint">
          <TapIcon size={18} />
          Tap a wall in the photo to paint it.
        </p>
      ) : (
        <div className="wall-list">
          {walls.map((wall) => (
            <button
              key={wall.id}
              type="button"
              className={wall.id === selectedId ? 'wall-chip active' : 'wall-chip'}
              onClick={() => setSelectedId(wall.id)}
            >
              <span
                className="dot"
                style={{ background: wall.shade?.hex ?? 'transparent' }}
              />
              {wallName(wall.id)}
              <small>{wall.shade ? wall.shade.name : 'No colour'}</small>
            </button>
          ))}

          <span className="wall-list-hint">Tap another wall to add it</span>
        </div>
      )}

      {sheetOpen && (
        <Sheet
          inline
          title={
            <>
              {wallName(selected.id)}
              <small>
                {selected.shade
                  ? `${selected.shade.name} · ${selected.shade.code}`
                  : 'Choose a colour'}
              </small>
            </>
          }
          onClose={() => setSelectedId(undefined)}
        >
          <ShadePicker
            shades={shades}
            favorites={favorites}
            selectedCode={selected.shade?.code}
            onPick={(shade) => paint(selected.id, shade)}
            columns={5}
          />

          {selected.shade && (
            <button
              type="button"
              className="btn ghost full"
              onClick={() => paint(selected.id, undefined)}
              disabled={!!busy}
            >
              Remove colour from {wallName(selected.id)}
            </button>
          )}
        </Sheet>
      )}

      {changingPhoto && (
        <Sheet title="New photo" onClose={() => setChangingPhoto(false)}>
          <p className="muted">
            Starting with a new photo clears the colours on this one. Save
            or share it first if you want to keep it.
          </p>
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

function Header({ children }: { children?: ReactNode }) {
  return (
    <header className="topbar">
      <div>
        <span className="brand">PAINT AI</span>
        <h1>Paint</h1>
      </div>
      <div className="actions">{children}</div>
    </header>
  );
}

function PendingBanner({ shade, onClear }: { shade: Shade; onClear: () => void }) {
  return (
    <div className="banner">
      <span className="dot big" style={{ background: shade.hex }} />
      <div>
        <strong>Trying {shade.name}</strong>
        <small>Tap a wall to paint it in this shade.</small>
      </div>
      <button
        type="button"
        className="icon-btn"
        aria-label="Cancel"
        onClick={onClear}
      >
        <CloseIcon size={18} />
      </button>
    </div>
  );
}
