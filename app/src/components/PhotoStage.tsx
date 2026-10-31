import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import type { Point, Stroke } from '../types';
import { MinusIcon, PlusIcon } from './Icons';

const MAX_ZOOM = 6;

/**
 * Zoom and pan: the photo is scaled by `scale` and shifted by (x, y),
 * fractions of its own size (0 or less, so it always covers the frame).
 */
type View = { scale: number; x: number; y: number };

const FIT: View = { scale: 1, x: 0, y: 0 };

/** Keep the zoom in range and the photo covering the frame. */
function clampView(view: View): View {
  const scale = Math.min(MAX_ZOOM, Math.max(1, view.scale));

  return {
    scale,
    x: Math.min(0, Math.max(1 - scale, view.x)),
    y: Math.min(0, Math.max(1 - scale, view.y)),
  };
}

/** Zoom to `scale` keeping the photo under (fx, fy), fractions of the frame, in place. */
function zoomAt(view: View, scale: number, fx: number, fy: number): View {
  const next = Math.min(MAX_ZOOM, Math.max(1, scale));
  const ratio = next / view.scale;

  return clampView({
    scale: next,
    x: fx - (fx - view.x) * ratio,
    y: fy - (fy - view.y) * ratio,
  });
}

type Props = {
  src: string;
  alt: string;
  /**
   * Called with the tapped position in original image pixels, and
   * as percentages of the photo (for placing markers).
   */
  onTap?: (point: Point, percent: Point) => void;
  /** Show a before/after slider with this image as "before". */
  compareSrc?: string;
  busyLabel?: string;
  /** Non-blocking progress note, e.g. while a new colour renders. */
  working?: string;
  /**
   * Brush mode: strokes are drawn on the photo instead of taps.
   * Brush size is in screen pixels, strokes are in photo pixels.
   */
  brush?: {
    strokes: Stroke[];
    onChange: (strokes: Stroke[]) => void;
    color: string;
    size: number;
  };
  /** Overlays drawn exactly over the photo (absolutely positioned). */
  children?: ReactNode;
  /** The zoom resets to fit when this changes (e.g. a new photo). */
  zoomKey?: string;
};

/**
 * The photo, sized to fit, with overlays that line up with it
 * pixel for pixel: the frame shrinks to the rendered image, so
 * percentages inside it are percentages of the photo.
 *
 * Pinch (or the + and - buttons) to zoom in for precise taps and
 * brushing. Two fingers move the zoomed photo; so does one finger
 * when tapping, not brushing. Photo and overlays zoom together, and
 * taps and strokes are measured on the zoomed photo, so they stay
 * exact (and the brush gets finer as you zoom in).
 */
export function PhotoStage({
  src,
  alt,
  onTap,
  compareSrc,
  busyLabel,
  working,
  brush,
  children,
  zoomKey,
}: Props) {
  const image = useRef<HTMLImageElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const drawing = useRef(false);
  const [split, setSplit] = useState(50);
  const [natural, setNatural] = useState({ width: 0, height: 0 });

  const [view, setView] = useState<View>(FIT);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => setView(FIT), [zoomKey]);

  // Fingers on the photo, and the gesture they are making.
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ distance: number; mid: Point; view: View } | null>(null);
  const pan = useRef<{ start: Point; view: View; moved: boolean } | null>(null);
  // A pan or pinch just ended: the click that follows is not a tap.
  const suppressClick = useRef(false);
  // Strokes before the one being drawn, to drop it if a pinch starts.
  const strokesBefore = useRef<Stroke[] | null>(null);

  // Expanding rings where the photo was tapped.
  const [ripples, setRipples] = useState<(Point & { id: number })[]>([]);
  const rippleId = useRef(0);

  // Strokes as they are being drawn (props update a frame later).
  const liveStrokes = useRef<Stroke[]>([]);
  liveStrokes.current = brush?.strokes ?? [];

  const handleClick = (event: MouseEvent<HTMLImageElement>) => {
    const img = image.current;

    if (!onTap || !img || !img.naturalWidth || busyLabel || brush) {
      return;
    }

    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }

    const rect = img.getBoundingClientRect();

    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;

    const id = ++rippleId.current;

    setRipples((list) => [...list, { id, x: fx * 100, y: fy * 100 }]);
    setTimeout(
      () => setRipples((list) => list.filter((ripple) => ripple.id !== id)),
      700
    );

    onTap(
      { x: fx * img.naturalWidth, y: fy * img.naturalHeight },
      { x: fx * 100, y: fy * 100 }
    );
  };

  /** Screen position to photo pixels, plus the screen-to-photo scale. */
  const toPhoto = (clientX: number, clientY: number) => {
    const img = image.current;

    if (!img || !img.naturalWidth) {
      return null;
    }

    const rect = img.getBoundingClientRect();
    const scale = img.naturalWidth / rect.width;

    return {
      point: {
        x: Math.min(img.naturalWidth - 1, Math.max(0, (clientX - rect.left) * scale)),
        y: Math.min(img.naturalHeight - 1, Math.max(0, (clientY - rect.top) * scale)),
      },
      scale,
    };
  };

  const startStroke = (event: PointerEvent<HTMLDivElement>) => {
    if (!brush || busyLabel || pinch.current) {
      return;
    }

    const hit = toPhoto(event.clientX, event.clientY);

    if (!hit) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    strokesBefore.current = liveStrokes.current;

    const next = [
      ...liveStrokes.current,
      { points: [hit.point], width: brush.size * hit.scale },
    ];

    liveStrokes.current = next;
    brush.onChange(next);
  };

  const continueStroke = (event: PointerEvent<HTMLDivElement>) => {
    if (!brush || !drawing.current) {
      return;
    }

    const hit = toPhoto(event.clientX, event.clientY);
    const strokes = liveStrokes.current;
    const last = strokes[strokes.length - 1];

    if (!hit || !last) {
      return;
    }

    const previous = last.points[last.points.length - 1];

    // Skip points that barely moved on screen.
    if (
      Math.hypot(hit.point.x - previous.x, hit.point.y - previous.y) <
      3 * hit.scale
    ) {
      return;
    }

    const next = [
      ...strokes.slice(0, -1),
      { ...last, points: [...last.points, hit.point] },
    ];

    liveStrokes.current = next;
    brush.onChange(next);
  };

  const moveSplit = (clientX: number) => {
    const rect = image.current?.getBoundingClientRect();

    if (rect) {
      setSplit(
        Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100))
      );
    }
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (pinch.current) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    moveSplit(event.clientX);
  };

  /** A screen position as fractions of the frame. */
  const inFrame = (clientX: number, clientY: number): Point => {
    const rect = frame.current?.getBoundingClientRect();

    return rect
      ? { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height }
      : { x: 0.5, y: 0.5 };
  };

  const zoomBy = (factor: number) =>
    setView((current) => zoomAt(current, current.scale * factor, 0.5, 0.5));

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];

    // The first finger already started a stroke or slider drag:
    // that was the start of the pinch, so undo it.
    if (drawing.current && strokesBefore.current && brush) {
      liveStrokes.current = strokesBefore.current;
      brush.onChange(strokesBefore.current);
    }

    drawing.current = false;
    dragging.current = false;
    pan.current = null;
    suppressClick.current = true;

    pinch.current = {
      distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mid: inFrame((a.x + b.x) / 2, (a.y + b.y) / 2),
      view: viewRef.current,
    };
  };

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('.zoom-controls')) {
      return;
    }

    if (pointers.current.size === 0) {
      suppressClick.current = false;
    }

    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2) {
      startPinch();
    } else if (
      pointers.current.size === 1 &&
      viewRef.current.scale > 1 &&
      !brush &&
      !compareSrc
    ) {
      pan.current = {
        start: { x: event.clientX, y: event.clientY },
        view: viewRef.current,
        moved: false,
      };
    }
  };

  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) {
      return;
    }

    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const start = pinch.current;
      const mid = inFrame((a.x + b.x) / 2, (a.y + b.y) / 2);
      const scale = Math.min(
        MAX_ZOOM,
        Math.max(1, (start.view.scale * Math.hypot(a.x - b.x, a.y - b.y)) / start.distance)
      );

      // The photo point that was under the fingers stays under them.
      const px = (start.mid.x - start.view.x) / start.view.scale;
      const py = (start.mid.y - start.view.y) / start.view.scale;

      setView(clampView({ scale, x: mid.x - px * scale, y: mid.y - py * scale }));
      return;
    }

    const current = pan.current;

    if (current) {
      const from = inFrame(current.start.x, current.start.y);
      const to = inFrame(event.clientX, event.clientY);

      if (
        !current.moved &&
        Math.hypot(event.clientX - current.start.x, event.clientY - current.start.y) < 6
      ) {
        return;
      }

      current.moved = true;
      suppressClick.current = true;

      setView(
        clampView({
          ...current.view,
          x: current.view.x + to.x - from.x,
          y: current.view.y + to.y - from.y,
        })
      );
    }
  };

  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);

    if (pointers.current.size < 2) {
      pinch.current = null;
    }

    if (pointers.current.size === 0) {
      pan.current = null;
    }
  };

  // Trackpad pinch and Ctrl + scroll zoom on a computer; scrolling
  // moves a zoomed photo. Native listeners: they must cancel the
  // page's own zoom and scroll.
  useEffect(() => {
    const element = frame.current;

    if (!element) {
      return;
    }

    const wheel = (event: WheelEvent) => {
      const at = inFrame(event.clientX, event.clientY);

      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        setView((current) =>
          zoomAt(current, current.scale * Math.exp(-event.deltaY * 0.01), at.x, at.y)
        );
      } else if (viewRef.current.scale > 1) {
        event.preventDefault();
        const rect = element.getBoundingClientRect();
        setView((current) =>
          clampView({
            ...current,
            x: current.x - event.deltaX / rect.width,
            y: current.y - event.deltaY / rect.height,
          })
        );
      }
    };

    // Safari's trackpad pinch. Touch pinches are handled above.
    let gestureScale = 1;

    const gestureStart = (event: Event) => {
      event.preventDefault();
      gestureScale = viewRef.current.scale;
    };

    const gestureChange = (event: Event) => {
      event.preventDefault();

      if (pointers.current.size) {
        return;
      }

      const gesture = event as Event & { scale: number; clientX: number; clientY: number };
      const at = inFrame(gesture.clientX, gesture.clientY);
      setView((current) => zoomAt(current, gestureScale * gesture.scale, at.x, at.y));
    };

    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('gesturestart', gestureStart);
    element.addEventListener('gesturechange', gestureChange);

    return () => {
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('gesturestart', gestureStart);
      element.removeEventListener('gesturechange', gestureChange);
    };
  }, []);

  const zoomStyle = {
    transform: `translate(${view.x * 100}%, ${view.y * 100}%) scale(${view.scale})`,
    '--unzoom': 1 / view.scale,
  } as CSSProperties;

  const keyMove = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -4, ArrowRight: 4 }[event.key];

    if (step) {
      event.preventDefault();
      setSplit((value) => Math.min(100, Math.max(0, value + step)));
    }
  };

  return (
    <div className="stage">
      <div
        ref={frame}
        className="frame"
        style={{ touchAction: view.scale > 1 || brush || compareSrc ? 'none' : 'pan-y' }}
        onPointerDownCapture={pointerDown}
        onPointerMoveCapture={pointerMove}
        onPointerUpCapture={pointerUp}
        onPointerCancelCapture={pointerUp}
      >
        <div className="zoom" style={zoomStyle}>
          <img
            ref={image}
            src={src}
            alt={alt}
            draggable={false}
            onClick={handleClick}
            onLoad={(event) =>
              setNatural({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            className={onTap && !compareSrc && !brush ? 'tappable' : undefined}
          />

          {!compareSrc && children}

          {ripples.map((ripple) => (
            <span
              key={ripple.id}
              className="ripple"
              style={{ left: `${ripple.x}%`, top: `${ripple.y}%` }}
            />
          ))}

          {brush && natural.width > 0 && (
            <>
              <svg
                className="brush-strokes"
                viewBox={`0 0 ${natural.width} ${natural.height}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {/* Opaque strokes in a translucent group: overlaps
                    don't get darker. */}
                <g opacity={0.55}>
                  {brush.strokes.map((stroke, index) =>
                    stroke.points.length === 1 ? (
                      <circle
                        key={index}
                        cx={stroke.points[0].x}
                        cy={stroke.points[0].y}
                        r={stroke.width / 2}
                        fill={brush.color}
                      />
                    ) : (
                      <polyline
                        key={index}
                        points={stroke.points.map((p) => `${p.x},${p.y}`).join(' ')}
                        fill="none"
                        stroke={brush.color}
                        strokeWidth={stroke.width}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )
                  )}
                </g>
              </svg>

              <div
                className="brush-hit"
                onPointerDown={startStroke}
                onPointerMove={continueStroke}
                onPointerUp={() => (drawing.current = false)}
                onPointerCancel={() => (drawing.current = false)}
              />
            </>
          )}

          {compareSrc && (
            <>
              {/* "Before" on the left of the divider. */}
              <img
                className="compare-before"
                src={compareSrc}
                alt="Before"
                draggable={false}
                style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
              />

              <div
                className="compare-hit"
                onPointerDown={startDrag}
                onPointerMove={(event) =>
                  dragging.current && moveSplit(event.clientX)
                }
                onPointerUp={() => (dragging.current = false)}
                onPointerCancel={() => (dragging.current = false)}
              />

              <div className="compare-line" style={{ left: `${split}%` }}>
                <div
                  className="compare-knob"
                  role="slider"
                  tabIndex={0}
                  aria-label="Before and after"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(split)}
                  onKeyDown={keyMove}
                >
                  ‹ ›
                </div>
              </div>

            </>
          )}
        </div>

        {compareSrc && (
          <>
            <span className="tag tag-left">Before</span>
            <span className="tag tag-right">After</span>
          </>
        )}

        {natural.width > 0 && (
          <div className="zoom-controls">
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => zoomBy(1 / 1.6)}
              disabled={view.scale <= 1}
            >
              <MinusIcon size={18} />
            </button>

            {view.scale > 1 && (
              <button
                type="button"
                className="zoom-fit"
                aria-label="Fit the whole photo"
                onClick={() => setView(FIT)}
              >
                {view.scale.toFixed(1)}×
              </button>
            )}

            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => zoomBy(1.6)}
              disabled={view.scale >= MAX_ZOOM}
            >
              <PlusIcon size={18} />
            </button>
          </div>
        )}

        {working && !busyLabel && (
          <div className="working">
            <span className="spinner" />
            {working}
          </div>
        )}

        {busyLabel && (
          <div className="busy">
            <span className="spinner" />
            {busyLabel}
          </div>
        )}
      </div>
    </div>
  );
}
