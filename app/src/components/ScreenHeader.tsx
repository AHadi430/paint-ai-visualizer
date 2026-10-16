import type { ReactNode } from 'react';
import { tapFeedback } from '../lib/haptics';
import { HomeIcon } from './Icons';

type Props = {
  title: string;
  subtitle?: string;
  onHome: () => void;
  /** Buttons on the right. */
  children?: ReactNode;
};

/** Top bar of a section: Home button, title and actions. */
export function ScreenHeader({ title, subtitle, onHome, children }: Props) {
  return (
    <header className="topbar">
      <button
        type="button"
        className="home-btn"
        aria-label="Home"
        onClick={() => {
          tapFeedback();
          onHome();
        }}
      >
        <HomeIcon size={20} />
      </button>

      <div className="topbar-title">
        <h1>{title}</h1>
        {subtitle && <span>{subtitle}</span>}
      </div>

      <div className="actions">{children}</div>
    </header>
  );
}
