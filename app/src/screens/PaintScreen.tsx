import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  cleanUpPhoto,
  detectSurfaces,
  editSurface,
  findSurface,
  freshUrl,
  maskUrlFor,
  renderPaint,
  transferSurfaces,
} from '../api';
import {
  BrushIcon,
  CameraIcon,
  CloseIcon,
  CompareIcon,
  EraserIcon,
  PlusIcon,
  RollerIcon,
  ShareIcon,
  SparkleIcon,
  TapIcon,
  TrashIcon,
  UndoIcon,
} from '../components/Icons';
import { PhotoButtons, PhotoEmptyState } from '../components/PhotoPicker';
import { PhotoStage } from '../components/PhotoStage';
import { ScreenHeader } from '../components/ScreenHeader';
import { ShadePicker } from '../components/ShadePicker';
import { Sheet } from '../components/Sheet';
import { successFeedback, tapFeedback } from '../lib/haptics';
import { highlightUrl, maskContains, maskOverlap } from '../lib/mask';
import { shareOrSave } from '../lib/share';
import type { Photo, Point, Scheme, Shade, Stroke, Wall } from '../types';

type Props = {
  photo?: Photo;
  uploading: boolean;
  onPickPhoto: (file: File) => void;
  /** The photo was replaced by a cleaned-up version of itself. */
  onPhotoReplaced: (photo: Photo) => void;
  shades: Shade[];
  favorites: Set<string>;
  /** Shade chosen elsewhere ("Try on my wall"), applied to the next wall. */
  pendingShade?: Shade;
  onPendingUsed: () => void;
  onHome: () => void;
  notify: (message: string) => void;
};

type Tool = 'tap' | 'edges' | 'erase';

const SCHEME_IDS = ['a', 'b', 'c'];
const MAX_SCHEMES = SCHEME_IDS.length;

const BRUSH_ADD = '#2fbf71';
const BRUSH_REMOVE = '#ff3b30';

/** Friendly kind of surface from the detector's label. */
function kindOf(type: string) {
  const label = type.toLowerCase();

  if (label.includes('ceiling')) return 'Ceiling';
  if (label.includes('column') || label.includes('pillar')) return 'Column';
  if (label.includes('balcony') || label.includes('parapet')) return 'Balcony';
  if (label.includes('facade')) return 'Facade';
  return 'Wall';
}

/** "Wall 1", "Wall 2", "Ceiling": numbered only when a kind repeats. */
function wallNames(walls: Wall[]) {
  const totals = new Map<string, number>();
  walls.forEach((wall) => totals.set(wall.kind, (totals.get(wall.kind) ?? 0) + 1));

  const seen = new Map<string, number>();
  const names = new Map<string, string>();

  for (const wall of walls) {
    const index = (seen.get(wall.kind) ?? 0) + 1;
    seen.set(wall.kind, index);
    names.set(
      wall.id,
      (totals.get(wall.kind) ?? 0) > 1 ? `${wall.kind} ${index}` : wall.kind
    );
  }

  return names;
}

export function PaintScreen({
  photo,
  uploading,
  onPickPhoto,
  onPhotoReplaced,
  shades,
  favorites,
  pendingShade,
  onPendingUsed,
  onHome,
  notify,
}: Props) {
  const [walls, setWalls] = useState<Wall[]>([]);
  const [schemes, setSchemes] = useState<Scheme[]>([{ id: 'a', colors: {} }]);
  const [activeId, setActiveId] = useState('a');
  const [history, setHistory] = useState<{ schemes: Scheme[]; activeId: string }[]>([]);

  const [selectedId, setSelectedId] = useState<string>();
  const [comparing, setComparing] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [detecting, setDetecting] = useState(false);

  const [tool, setTool] = useState<Tool>('tap');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [brushOp, setBrushOp] = useState<'add' | 'remove'>('add');
  const [brushSize, setBrushSize] = useState(26);
  const [undoableEdges, setUndoableEdges] = useState<Set<string>>(new Set());

  /** The photo as uploaded, before any clean-up. */
  const [original, setOriginal] = useState<Photo>();

  const [sheet, setSheet] = useState<'photo' | 'clean' | 'compare'>();
  const [previewId, setPreviewId] = useState('a');

  const [highlight, setHighlight] = useState<string>();
  const [outlines, setOutlines] = useState<string[]>([]);

  const wallCounter = useRef(0);

  // Latest values for async work (state captured in closures goes stale).
  const wallsRef = useRef(walls);
  wallsRef.current = walls;
  const schemesRef = useRef(schemes);
  schemesRef.current = schemes;

  // Set while swapping in a cleaned-up photo, so its arrival doesn't
  // start a new project.
  const replacingTo = useRef<string>(undefined);

  const active = schemes.find((scheme) => scheme.id === activeId) ?? schemes[0];
  const selected = walls.find((wall) => wall.id === selectedId);
  const names = wallNames(walls);
  const nameOf = (id: string) => names.get(id) ?? 'Wall';
  const anyColour = schemes.some((scheme) => Object.keys(scheme.colors).length);

  // ---------------------------------------------------------------
  // New photo: start a new project and find its walls automatically.
  // ---------------------------------------------------------------

  useEffect(() => {
    if (photo && replacingTo.current === photo.id) {
      replacingTo.current = undefined;
      return;
    }

    setWalls([]);
    setSchemes([{ id: 'a', colors: {} }]);
    setActiveId('a');
    setHistory([]);
    setSelectedId(undefined);
    setComparing(false);
    setTool('tap');
    setStrokes([]);
    setUndoableEdges(new Set());
    setSheet(undefined);
    setOriginal(photo);

    if (!photo) {
      return;
    }

    let cancelled = false;
    setDetecting(true);

    detectSurfaces(photo.id)
      .then(async (surfaces) => {
        const found: Wall[] = [];

        for (const surface of surfaces) {
          const wall: Wall = {
            id: surface.id,
            maskUrl: freshUrl(surface.mask_url),
            kind: kindOf(surface.type),
          };

          // Skip walls the user already selected by tapping.
          let duplicate = false;
          for (const existing of wallsRef.current) {
            if ((await maskOverlap(wall.maskUrl, existing.maskUrl)) > 0.5) {
              duplicate = true;
              break;
            }
          }

          if (!duplicate) {
            found.push(wall);
          }
        }

        if (!cancelled && found.length) {
          setWalls((list) => [...found, ...list]);
        }
      })
      .catch(() => {
        // Detection is a convenience: tapping still works.
      })
      .finally(() => {
        if (!cancelled) setDetecting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [photo?.id]);

  // ---------------------------------------------------------------
  // Overlays: the selected wall, and outlines of tappable walls.
  // ---------------------------------------------------------------

  const selectedPainted = !!(selected && active.colors[selected.id]);
  const tintSelected = tool === 'edges' || !selectedPainted;

  useEffect(() => {
    if (!selected) {
      setHighlight(undefined);
      return;
    }

    let url: string | undefined;
    let cancelled = false;

    highlightUrl(selected.maskUrl, undefined, tintSelected ? 95 : 0)
      .then((value) => {
        url = value;
        if (!cancelled) setHighlight(value);
      })
      .catch(() => setHighlight(undefined));

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [selected?.maskUrl, tintSelected]);

  const unpaintedKey = walls
    .filter((wall) => !active.colors[wall.id])
    .map((wall) => wall.maskUrl)
    .join('|');

  const showOutlines = tool === 'tap' && !selected && !comparing;

  useEffect(() => {
    if (!showOutlines || !unpaintedKey) {
      setOutlines([]);
      return;
    }

    let urls: string[] = [];
    let cancelled = false;

    Promise.all(
      unpaintedKey.split('|').map((url) =>
        highlightUrl(url, [106, 63, 208], 45).catch(() => '')
      )
    ).then((list) => {
      urls = list.filter(Boolean);
      if (!cancelled) setOutlines(urls);
    });

    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [unpaintedKey, showOutlines]);

  // ---------------------------------------------------------------
  // Rendering colour schemes
  // ---------------------------------------------------------------

  async function render(
    scheme: Scheme,
    photoId = photo?.id,
    wallList = wallsRef.current
  ): Promise<Scheme> {
    const surfaces = wallList
      .filter((wall) => scheme.colors[wall.id])
      .map((wall) => ({ surface_id: wall.id, color: scheme.colors[wall.id].hex }));

    if (!photoId || surfaces.length === 0) {
      return { ...scheme, painted: undefined, stale: false };
    }

    const { image_url } = await renderPaint(photoId, surfaces, scheme.id);

    return { ...scheme, painted: freshUrl(image_url), stale: false };
  }

  const replaceScheme = (scheme: Scheme) =>
    setSchemes((list) => list.map((item) => (item.id === scheme.id ? scheme : item)));

  async function run(label: string, task: () => Promise<void>, failure: string) {
    setBusy(label);

    try {
      await task();
    } catch (error) {
      notify(error instanceof Error ? error.message : failure);
    } finally {
      setBusy(undefined);
    }
  }

  /** Put a shade on a wall (or remove it) in the current scheme. */
  function paint(wallId: string, shade: Shade | undefined, wallList?: Wall[]) {
    const snapshot = { schemes: schemesRef.current, activeId };
    const colors = { ...active.colors };

    if (shade) {
      colors[wallId] = shade;
    } else {
      delete colors[wallId];
    }

    return run(
      'Painting…',
      async () => {
        const rendered = await render({ ...active, colors }, photo?.id, wallList);
        setHistory((list) => [...list, snapshot]);
        replaceScheme(rendered);

        if (shade) {
          successFeedback();
        }
      },
      'Could not paint the wall.'
    );
  }

  async function handleTap(point: Point) {
    if (!photo || busy) {
      return;
    }

    tapFeedback();

    // Tapping a wall that is already known selects it.
    for (const wall of [...wallsRef.current].reverse()) {
      if (await maskContains(wall.maskUrl, point.x, point.y)) {
        setSelectedId(wall.id);

        if (pendingShade) {
          await paint(wall.id, pendingShade);
          onPendingUsed();
        }

        return;
      }
    }

    await run(
      'Finding the wall…',
      async () => {
        wallCounter.current += 1;
        const id = `wall_${wallCounter.current}`;

        const { mask_url } = await findSurface(photo.id, point.x, point.y, id);

        const wall: Wall = { id, maskUrl: freshUrl(mask_url), kind: 'Wall' };
        const next = [...wallsRef.current, wall];

        setWalls(next);
        setSelectedId(id);

        if (pendingShade) {
          setBusy(undefined);
          await paint(id, pendingShade, next);
          onPendingUsed();
        }
      },
      'Could not find a wall there.'
    );
  }

  async function undo() {
    const previous = history[history.length - 1];

    if (!previous || busy) {
      return;
    }

    await run(
      'Undoing…',
      async () => {
        const restored = previous.schemes.map((scheme) => ({ ...scheme, stale: true }));
        const current =
          restored.find((scheme) => scheme.id === previous.activeId) ?? restored[0];
        const rendered = await render(current);

        setSchemes(restored.map((scheme) => (scheme.id === rendered.id ? rendered : scheme)));
        setActiveId(rendered.id);
        setHistory((list) => list.slice(0, -1));
      },
      'Could not undo.'
    );
  }

  // ---------------------------------------------------------------
  // Colour schemes A / B / C
  // ---------------------------------------------------------------

  async function switchScheme(id: string) {
    tapFeedback();
    setActiveId(id);
    setSelectedId(undefined);

    const scheme = schemesRef.current.find((item) => item.id === id);

    if (scheme?.stale) {
      await run('Updating…', async () => replaceScheme(await render(scheme)), 'Could not update.');
    }
  }

  async function addScheme() {
    const id = SCHEME_IDS.find((name) => !schemes.some((scheme) => scheme.id === name));

    if (!id) {
      return;
    }

    tapFeedback();

    await run(
      'Creating scheme…',
      async () => {
        // Start from the current colours, so one wall can be changed.
        const scheme = await render({ id, colors: { ...active.colors } });
        setSchemes((list) => [...list, scheme].sort((a, b) => a.id.localeCompare(b.id)));
        setActiveId(id);
        setSelectedId(undefined);
        notify(`Scheme ${id.toUpperCase()} created. Change any wall to compare.`);
      },
      'Could not create a scheme.'
    );
  }

  function deleteScheme(id: string) {
    if (schemes.length < 2) {
      return;
    }

    const rest = schemes.filter((scheme) => scheme.id !== id);
    setSchemes(rest);
    setHistory([]);

    if (activeId === id) {
      setActiveId(rest[0].id);
      if (rest[0].stale) {
        void switchScheme(rest[0].id);
      }
    }

    if (previewId === id) {
      setPreviewId(rest[0].id);
    }
  }

  async function openCompare() {
    tapFeedback();
    setSelectedId(undefined);

    await run(
      'Preparing comparison…',
      async () => {
        const updated = await Promise.all(
          schemesRef.current.map((scheme) => (scheme.stale ? render(scheme) : scheme))
        );
        setSchemes(updated);
        setPreviewId(activeId);
        setSheet('compare');
      },
      'Could not prepare the comparison.'
    );
  }

  // ---------------------------------------------------------------
  // Fix edges (brush on the selected wall)
  // ---------------------------------------------------------------

  function startEdges() {
    if (!selected) {
      return;
    }

    setTool('edges');
    setBrushOp('add');
    setStrokes([]);
    setComparing(false);
  }

  async function applyEdges(action: 'add' | 'remove' | 'undo') {
    if (!photo || !selected) {
      return;
    }

    const wallId = selected.id;

    await run(
      action === 'undo' ? 'Undoing…' : 'Updating edges…',
      async () => {
        const result = await editSurface(
          photo.id,
          wallId,
          action,
          action === 'undo' ? [] : strokes
        );

        const maskUrl = maskUrlFor(photo.id, wallId);
        const nextWalls = wallsRef.current.map((wall) =>
          wall.id === wallId ? { ...wall, maskUrl } : wall
        );

        setWalls(nextWalls);
        setStrokes([]);
        setUndoableEdges((set) => {
          const next = new Set(set);
          if (result.can_undo) next.add(wallId);
          else next.delete(wallId);
          return next;
        });

        // Every scheme painting this wall needs a new render.
        const updated = await Promise.all(
          schemesRef.current.map(async (scheme) => {
            if (!scheme.colors[wallId]) return scheme;
            return scheme.id === activeId
              ? render(scheme, photo.id, nextWalls)
              : { ...scheme, stale: true };
          })
        );
        setSchemes(updated);
        successFeedback();
      },
      'Could not update the edges.'
    );
  }

  // ---------------------------------------------------------------
  // Clean up (wires, poles, clutter)
  // ---------------------------------------------------------------

  /** Swap in another version of the photo, keeping walls and colours. */
  async function swapPhoto(next: Photo) {
    replacingTo.current = next.id;
    onPhotoReplaced(next);

    const nextWalls = wallsRef.current.map((wall) => ({
      ...wall,
      maskUrl: maskUrlFor(next.id, wall.id),
    }));

    setWalls(nextWalls);

    const updated = await Promise.all(
      schemesRef.current.map((scheme) =>
        scheme.id === activeId
          ? render(scheme, next.id, nextWalls)
          : { ...scheme, stale: true }
      )
    );

    setSchemes(updated);
  }

  async function autoClean() {
    if (!photo) {
      return;
    }

    setSheet(undefined);

    await run(
      'Removing wires and clutter…',
      async () => {
        const { photo: cleaned, removed } = await cleanUpPhoto(photo.id, true);
        await swapPhoto(cleaned);
        successFeedback();
        notify(
          removed.length
            ? `Removed: ${removed.join(', ')}. Use Erase for anything left.`
            : 'Nothing to remove automatically. Use Erase to brush over things.'
        );
      },
      'Clean-up failed.'
    );
  }

  async function eraseMarked() {
    if (!photo || strokes.length === 0) {
      return;
    }

    await run(
      'Erasing…',
      async () => {
        const { photo: cleaned } = await cleanUpPhoto(photo.id, false, strokes);
        setStrokes([]);
        await swapPhoto(cleaned);
        successFeedback();
      },
      'Could not erase.'
    );
  }

  async function restoreOriginal() {
    if (!photo || !original || original.id === photo.id) {
      return;
    }

    setSheet(undefined);

    await run(
      'Restoring…',
      async () => {
        await transferSurfaces(photo.id, original.id);
        await swapPhoto(original);
        notify('Back to your original photo.');
      },
      'Could not restore the original photo.'
    );
  }

  async function share() {
    if (!active.painted) {
      return;
    }

    try {
      const result = await shareOrSave(
        active.painted,
        `griplac-${active.id}-${new Date().toISOString().slice(0, 10)}.png`,
        'My walls in Griplac colours'
      );

      if (result === 'saved') {
        notify('Image saved.');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save the image.');
    }
  }

  // ---------------------------------------------------------------
  // Screens
  // ---------------------------------------------------------------

  if (!photo) {
    return (
      <div className="screen-content">
        <Header onHome={onHome} />

        {pendingShade && <PendingBanner shade={pendingShade} onClear={onPendingUsed} />}

        <PhotoEmptyState
          icon={<RollerIcon size={34} />}
          title="See your walls in a new colour"
          text="Take a photo of a room or the outside of your home. We find the walls for you, then you try our shades in seconds."
          steps={[
            'Take or choose a photo',
            'Tap a wall we found (or any wall)',
            'Pick a shade, make a second scheme and compare',
          ]}
          onPick={onPickPhoto}
          disabled={uploading}
        />
      </div>
    );
  }

  const cleaned = !!original && original.id !== photo.id;
  const brushing = tool === 'edges' || tool === 'erase';
  const sheetOpen = (!!selected && !comparing) || brushing;
  const paintedWalls = walls.filter((wall) => active.colors[wall.id]);

  return (
    <div className={sheetOpen ? 'screen-content with-sheet' : 'screen-content'}>
      <Header onHome={onHome}>
        <button
          type="button"
          className="icon-btn"
          aria-label="Undo"
          onClick={undo}
          disabled={!history.length || !!busy || brushing}
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
          disabled={!active.painted || !!busy || brushing}
        >
          <CompareIcon />
        </button>

        <button
          type="button"
          className="icon-btn"
          aria-label="Clean up photo"
          onClick={() => setSheet('clean')}
          disabled={!!busy || brushing}
        >
          <SparkleIcon />
        </button>

        <button
          type="button"
          className="icon-btn"
          aria-label="Share or save"
          onClick={share}
          disabled={!active.painted || !!busy}
        >
          <ShareIcon />
        </button>

        <button
          type="button"
          className="icon-btn"
          aria-label="New photo"
          onClick={() => setSheet('photo')}
          disabled={!!busy || uploading || brushing}
        >
          <CameraIcon />
        </button>
      </Header>

      {pendingShade && <PendingBanner shade={pendingShade} onClear={onPendingUsed} />}

      {anyColour && !brushing && (
        <div className="scheme-bar" role="tablist" aria-label="Colour schemes">
          <span className="scheme-label">Schemes</span>
          {schemes.map((scheme) => (
            <button
              key={scheme.id}
              type="button"
              role="tab"
              aria-label={`Scheme ${scheme.id.toUpperCase()}`}
              aria-selected={scheme.id === activeId}
              className={scheme.id === activeId ? 'scheme-chip active' : 'scheme-chip'}
              onClick={() => switchScheme(scheme.id)}
              disabled={!!busy}
            >
              <span className="scheme-dots">
                {Object.values(scheme.colors)
                  .slice(0, 3)
                  .map((shade, index) => (
                    <i key={index} style={{ background: shade.hex }} />
                  ))}
              </span>
              {scheme.id.toUpperCase()}
            </button>
          ))}

          {schemes.length < MAX_SCHEMES && (
            <button
              type="button"
              className="scheme-chip add"
              onClick={addScheme}
              disabled={!!busy}
            >
              <PlusIcon size={16} />
              New
            </button>
          )}

          {schemes.length > 1 && (
            <button
              type="button"
              className="scheme-chip compare"
              onClick={openCompare}
              disabled={!!busy}
            >
              <CompareIcon size={16} />
              Compare
            </button>
          )}
        </div>
      )}

      <PhotoStage
        src={active.painted ?? photo.url}
        alt="Your photo"
        onTap={comparing || brushing ? undefined : handleTap}
        compareSrc={comparing ? original?.url ?? photo.url : undefined}
        busyLabel={busy}
        brush={
          brushing
            ? {
                strokes,
                onChange: setStrokes,
                size: brushSize,
                color: tool === 'erase' || brushOp === 'remove' ? BRUSH_REMOVE : BRUSH_ADD,
              }
            : undefined
        }
      >
        {outlines.map((url) => (
          <img key={url} className="overlay" src={url} alt="" />
        ))}

        {highlight && tool !== 'erase' && <img className="overlay" src={highlight} alt="" />}
      </PhotoStage>

      {!sheetOpen &&
        (comparing ? (
          <p className="hint">
            <CompareIcon size={18} />
            Drag the slider to compare. Tap the compare button again to keep painting.
          </p>
        ) : detecting && walls.length === 0 ? (
          <p className="hint">
            <span className="spinner dark" />
            Finding the walls in your photo…
          </p>
        ) : paintedWalls.length === 0 ? (
          <p className="hint">
            <TapIcon size={18} />
            {walls.length
              ? `We found ${walls.length} surface${walls.length === 1 ? '' : 's'}. Tap one to paint it.`
              : 'Tap a wall in the photo to paint it.'}
          </p>
        ) : (
          <div className="wall-list">
            {walls.map((wall) => (
              <button
                key={wall.id}
                type="button"
                className="wall-chip"
                onClick={() => setSelectedId(wall.id)}
              >
                <span
                  className="dot"
                  style={{ background: active.colors[wall.id]?.hex ?? 'transparent' }}
                />
                {nameOf(wall.id)}
                <small>{active.colors[wall.id]?.name ?? 'No colour'}</small>
              </button>
            ))}

            <span className="wall-list-hint">Tap any wall to change it</span>
          </div>
        ))}

      {/* Colour sheet for the selected wall */}
      {selected && !comparing && tool === 'tap' && (
        <Sheet
          inline
          title={
            <>
              {nameOf(selected.id)}
              <small>
                {active.colors[selected.id]
                  ? `${active.colors[selected.id].name} · ${active.colors[selected.id].code}`
                  : 'Choose a colour'}
                {schemes.length > 1 && ` · Scheme ${activeId.toUpperCase()}`}
              </small>
            </>
          }
          onClose={() => setSelectedId(undefined)}
        >
          <div className="sheet-tools">
            <button type="button" className="tool-btn" onClick={startEdges} disabled={!!busy}>
              <BrushIcon size={18} />
              Fix edges
            </button>

            {active.colors[selected.id] && (
              <button
                type="button"
                className="tool-btn danger"
                onClick={() => paint(selected.id, undefined)}
                disabled={!!busy}
              >
                <TrashIcon size={18} />
                Remove colour
              </button>
            )}
          </div>

          <ShadePicker
            shades={shades}
            favorites={favorites}
            selectedCode={active.colors[selected.id]?.code}
            onPick={(shade) => paint(selected.id, shade)}
            columns={5}
          />
        </Sheet>
      )}

      {/* Brush tools: fix a wall's edges, or erase objects */}
      {brushing && (
        <Sheet
          inline
          title={
            tool === 'edges' ? (
              <>
                Fix edges
                <small>{selected ? nameOf(selected.id) : ''}</small>
              </>
            ) : (
              <>
                Erase objects
                <small>Brush over anything you want removed</small>
              </>
            )
          }
          onClose={() => {
            setTool('tap');
            setStrokes([]);
          }}
        >
          {tool === 'edges' && (
            <div className="segmented" role="radiogroup" aria-label="Brush">
              <button
                type="button"
                role="radio"
                aria-checked={brushOp === 'add'}
                className={brushOp === 'add' ? 'active' : ''}
                onClick={() => setBrushOp('add')}
              >
                <PlusIcon size={16} />
                Add to wall
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={brushOp === 'remove'}
                className={brushOp === 'remove' ? 'active' : ''}
                onClick={() => setBrushOp('remove')}
              >
                <EraserIcon size={16} />
                Remove from wall
              </button>
            </div>
          )}

          <label className="brush-size">
            <span>Brush size</span>
            <input
              type="range"
              min={10}
              max={70}
              value={brushSize}
              onChange={(event) => setBrushSize(Number(event.target.value))}
            />
            <i style={{ width: brushSize / 2, height: brushSize / 2 }} />
          </label>

          <p className="muted small">
            {tool === 'edges'
              ? brushOp === 'add'
                ? 'Paint over parts of the wall that were missed.'
                : 'Paint over things that should not be painted, like pipes or trim.'
              : 'Paint over wires, poles, signs or anything else, then press Erase.'}
          </p>

          <div className="tool-actions">
            {tool === 'edges' ? (
              <>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => applyEdges(brushOp)}
                  disabled={!!busy || strokes.length === 0}
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => applyEdges('undo')}
                  disabled={!!busy || !selected || !undoableEdges.has(selected.id)}
                >
                  Undo edit
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn primary"
                  onClick={eraseMarked}
                  disabled={!!busy || strokes.length === 0}
                >
                  Erase
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setStrokes((list) => list.slice(0, -1))}
                  disabled={!!busy || strokes.length === 0}
                >
                  Undo stroke
                </button>
              </>
            )}

            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setTool('tap');
                setStrokes([]);
              }}
              disabled={!!busy}
            >
              Done
            </button>
          </div>
        </Sheet>
      )}

      {sheet === 'clean' && (
        <Sheet title="Clean up photo" onClose={() => setSheet(undefined)}>
          <p className="muted">
            Remove things that get in the way of seeing your walls. Your
            colours are kept.
          </p>

          <button type="button" className="option-card" onClick={autoClean}>
            <span className="option-icon">
              <SparkleIcon />
            </span>
            <span>
              <strong>Automatic clean-up</strong>
              <small>Removes overhead wires, poles, vehicles, people and clutter</small>
            </span>
          </button>

          <button
            type="button"
            className="option-card"
            onClick={() => {
              setSheet(undefined);
              setSelectedId(undefined);
              setComparing(false);
              setStrokes([]);
              setTool('erase');
            }}
          >
            <span className="option-icon">
              <EraserIcon />
            </span>
            <span>
              <strong>Brush to erase</strong>
              <small>Paint over anything else you want gone</small>
            </span>
          </button>

          {cleaned && (
            <button type="button" className="btn ghost full" onClick={restoreOriginal}>
              Go back to the original photo
            </button>
          )}
        </Sheet>
      )}

      {sheet === 'compare' && (
        <Sheet title="Compare schemes" onClose={() => setSheet(undefined)}>
          <CompareSchemes
            schemes={schemes}
            walls={walls}
            previewId={previewId}
            photoUrl={photo.url}
            nameOf={nameOf}
            onPreview={(id) => {
              tapFeedback();
              setPreviewId(id);
            }}
            onUse={(id) => {
              setActiveId(id);
              setSheet(undefined);
              notify(`Using scheme ${id.toUpperCase()}.`);
            }}
            onDelete={deleteScheme}
          />
        </Sheet>
      )}

      {sheet === 'photo' && (
        <Sheet title="New photo" onClose={() => setSheet(undefined)}>
          <p className="muted">
            Starting with a new photo clears the colours on this one. Share
            or save it first if you want to keep it.
          </p>
          <PhotoButtons
            onPick={(file) => {
              setSheet(undefined);
              onPickPhoto(file);
            }}
            disabled={uploading}
          />
        </Sheet>
      )}
    </div>
  );
}

/** Schemes side by side, with a large preview of the chosen one. */
function CompareSchemes({
  schemes,
  walls,
  previewId,
  photoUrl,
  nameOf,
  onPreview,
  onUse,
  onDelete,
}: {
  schemes: Scheme[];
  walls: Wall[];
  previewId: string;
  photoUrl: string;
  nameOf: (id: string) => string;
  onPreview: (id: string) => void;
  onUse: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const preview = schemes.find((scheme) => scheme.id === previewId) ?? schemes[0];

  return (
    <div className="compare-view">
      <div className="compare-preview">
        <img src={preview.painted ?? photoUrl} alt={`Scheme ${preview.id.toUpperCase()}`} />
        <span className="tag tag-left">Scheme {preview.id.toUpperCase()}</span>
      </div>

      <div
        className="scheme-grid"
        style={{ gridTemplateColumns: `repeat(${schemes.length}, minmax(0, 1fr))` }}
      >
        {schemes.map((scheme) => (
          <article
            key={scheme.id}
            className={scheme.id === preview.id ? 'scheme-card active' : 'scheme-card'}
          >
            <button
              type="button"
              className="scheme-thumb"
              onClick={() => onPreview(scheme.id)}
              aria-label={`Show scheme ${scheme.id.toUpperCase()}`}
            >
              <img src={scheme.painted ?? photoUrl} alt="" />
            </button>

            <strong>Scheme {scheme.id.toUpperCase()}</strong>

            <ul>
              {walls
                .filter((wall) => scheme.colors[wall.id])
                .map((wall) => (
                  <li key={wall.id}>
                    <i style={{ background: scheme.colors[wall.id].hex }} />
                    <span>
                      {nameOf(wall.id)}: {scheme.colors[wall.id].name}
                    </span>
                  </li>
                ))}
            </ul>
          </article>
        ))}
      </div>

      <div className="tool-actions">
        <button type="button" className="btn primary" onClick={() => onUse(preview.id)}>
          Use scheme {preview.id.toUpperCase()}
        </button>

        {schemes.length > 1 && (
          <button type="button" className="btn secondary" onClick={() => onDelete(preview.id)}>
            <TrashIcon size={18} />
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function Header({ onHome, children }: { onHome: () => void; children?: ReactNode }) {
  return (
    <ScreenHeader title="Paint" subtitle="Tap a wall" onHome={onHome}>
      {children}
    </ScreenHeader>
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
      <button type="button" className="icon-btn" aria-label="Cancel" onClick={onClear}>
        <CloseIcon size={18} />
      </button>
    </div>
  );
}
