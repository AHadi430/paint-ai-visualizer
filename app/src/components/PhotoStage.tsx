import {
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import type { Point, Stroke } from '../types';

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
};

/**
 * The photo, sized to fit, with overlays that line up with it
 * pixel for pixel: the frame shrinks to the rendered image, so
 * percentages inside it are percentages of the photo.
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
}: Props) {
  const image = useRef<HTMLImageElement>(null);
  const dragging = useRef(false);
  const drawing = useRef(false);
  const [split, setSplit] = useState(50);
  const [natural, setNatural] = useState({ width: 0, height: 0 });

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
    if (!brush || busyLabel) {
      return;
    }

    const hit = toPhoto(event.clientX, event.clientY);

    if (!hit) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;

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
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    moveSplit(event.clientX);
  };

  const keyMove = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -4, ArrowRight: 4 }[event.key];

    if (step) {
      event.preventDefault();
      setSplit((value) => Math.min(100, Math.max(0, value + step)));
    }
  };

  return (
    <div className="stage">
      <div className="frame">
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

            <span className="tag tag-left">Before</span>
            <span className="tag tag-right">After</span>
          </>
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
