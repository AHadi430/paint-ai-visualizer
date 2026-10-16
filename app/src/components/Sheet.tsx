import type { ReactNode } from 'react';
import { CloseIcon } from './Icons';

type Props = {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Keep the photo above usable: no dimmed backdrop. */
  inline?: boolean;
};

/** A panel that slides up from the bottom of the screen. */
export function Sheet({ title, onClose, children, inline }: Props) {
  return (
    <>
      {!inline && <div className="backdrop" onClick={onClose} />}

      <section
        className={inline ? 'sheet inline' : 'sheet'}
        role="dialog"
        aria-label={typeof title === 'string' ? title : undefined}
      >
        <div className="sheet-handle" />

        <header className="sheet-header">
          <div className="sheet-title">{title}</div>

          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="sheet-body">{children}</div>
      </section>
    </>
  );
}
