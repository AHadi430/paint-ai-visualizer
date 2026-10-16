import {
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import type { Point } from '../types';

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
  children,
}: Props) {
  const image = useRef<HTMLImageElement>(null);
  const dragging = useRef(false);
  const [split, setSplit] = useState(50);

  // Expanding rings where the photo was tapped.
  const [ripples, setRipples] = useState<(Point & { id: number })[]>([]);
  const rippleId = useRef(0);

  const handleClick = (event: MouseEvent<HTMLImageElement>) => {
    const img = image.current;

    if (!onTap || !img || !img.naturalWidth || busyLabel) {
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
          className={onTap && !compareSrc ? 'tappable' : undefined}
        />

        {!compareSrc && children}

        {ripples.map((ripple) => (
          <span
            key={ripple.id}
            className="ripple"
            style={{ left: `${ripple.x}%`, top: `${ripple.y}%` }}
          />
        ))}

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
