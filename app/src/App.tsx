import { useCallback, useEffect, useRef, useState } from 'react';
import { getShades, uploadPhoto } from './api';
import { PipetteIcon, RollerIcon, SwatchesIcon } from './components/Icons';
import { useFavorites } from './lib/favorites';
import { IdentifyScreen } from './screens/IdentifyScreen';
import { PaintScreen } from './screens/PaintScreen';
import { ShadesScreen } from './screens/ShadesScreen';
import type { Photo, Shade } from './types';

type Tab = 'paint' | 'identify' | 'shades';

const TABS: { id: Tab; label: string; icon: typeof RollerIcon }[] = [
  { id: 'paint', label: 'Paint', icon: RollerIcon },
  { id: 'identify', label: 'Identify', icon: PipetteIcon },
  { id: 'shades', label: 'Shades', icon: SwatchesIcon },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('paint');
  const [shades, setShades] = useState<Shade[]>([]);
  const { favorites, toggle: toggleFavorite } = useFavorites();

  // One photo shared by Paint and Identify, so a colour found in
  // Identify can be tried on the same wall straight away.
  const [photo, setPhoto] = useState<Photo>();
  const [uploading, setUploading] = useState(false);

  const [pendingShade, setPendingShade] = useState<Shade>();

  const [toast, setToast] = useState<string>();
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), 3200);
  }, []);

  // The shade card. Retries while the backend is starting up.
  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;

    const load = async () => {
      try {
        const list = await getShades();
        if (!cancelled) {
          setShades(list);
        }
      } catch {
        if (!cancelled) {
          attempt += 1;
          timer = setTimeout(load, Math.min(2000 * attempt, 10000));
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  async function pickPhoto(file: File) {
    setUploading(true);

    try {
      setPhoto(await uploadPhoto(file));
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  function tryShade(shade: Shade) {
    setPendingShade(shade);
    setTab('paint');

    notify(
      photo
        ? `Tap a wall to try ${shade.name}`
        : `Add a photo, then tap a wall to try ${shade.name}`
    );
  }

  return (
    <div className="app">
      {/* All screens stay mounted so switching tabs keeps their work. */}
      <main className="screen" hidden={tab !== 'paint'}>
        <PaintScreen
          photo={photo}
          uploading={uploading}
          onPickPhoto={pickPhoto}
          shades={shades}
          favorites={favorites}
          pendingShade={pendingShade}
          onPendingUsed={() => setPendingShade(undefined)}
          notify={notify}
        />
      </main>

      <main className="screen" hidden={tab !== 'identify'}>
        <IdentifyScreen
          photo={photo}
          uploading={uploading}
          onPickPhoto={pickPhoto}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          onTry={tryShade}
          notify={notify}
        />
      </main>

      <main className="screen" hidden={tab !== 'shades'}>
        <ShadesScreen
          shades={shades}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          onTry={tryShade}
          notify={notify}
        />
      </main>

      <nav className="tabbar" aria-label="Main">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'tab active' : 'tab'}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
          >
            <Icon size={24} />
            {label}
          </button>
        ))}
      </nav>

      {uploading && (
        <div className="fullscreen-busy">
          <span className="spinner large" />
          Uploading your photo…
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
