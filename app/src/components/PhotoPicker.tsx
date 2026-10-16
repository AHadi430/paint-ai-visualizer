import { useRef, type ChangeEvent, type ReactNode } from 'react';
import { CameraIcon, GalleryIcon } from './Icons';

type Props = {
  onPick: (file: File) => void;
  disabled?: boolean;
  compact?: boolean;
};

/**
 * "Take a photo" opens the camera on phones (capture attribute);
 * "Choose photo" opens the gallery / file picker.
 */
export function PhotoButtons({ onPick, disabled, compact }: Props) {
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);

  const handle = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    // Allow picking the same file again later.
    event.target.value = '';

    if (file) {
      onPick(file);
    }
  };

  return (
    <div className={compact ? 'photo-buttons compact' : 'photo-buttons'}>
      <button
        type="button"
        className="btn primary"
        onClick={() => camera.current?.click()}
        disabled={disabled}
      >
        <CameraIcon />
        Take a photo
      </button>

      <button
        type="button"
        className="btn secondary"
        onClick={() => gallery.current?.click()}
        disabled={disabled}
      >
        <GalleryIcon />
        Choose photo
      </button>

      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={handle}
      />

      <input
        ref={gallery}
        type="file"
        accept="image/*"
        hidden
        onChange={handle}
      />
    </div>
  );
}

/** Empty state shown before a photo has been chosen. */
export function PhotoEmptyState({
  icon,
  title,
  text,
  steps,
  onPick,
  disabled,
}: Props & {
  icon: ReactNode;
  title: string;
  text: string;
  steps: string[];
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{text}</p>

      <ol className="steps">
        {steps.map((step, index) => (
          <li key={step}>
            <span>{index + 1}</span>
            {step}
          </li>
        ))}
      </ol>

      <PhotoButtons onPick={onPick} disabled={disabled} />

      <small className="tip">
        Tip: daylight photos taken straight-on give the most accurate
        results.
      </small>
    </div>
  );
}
