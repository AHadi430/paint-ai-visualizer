import { useCallback, useEffect, useRef, useState } from 'react';
import { getShades, uploadPhoto } from './api';
import { useFavorites } from './lib/favorites';
import { HomeScreen, type Section } from './screens/HomeScreen';
import { IdentifyScreen } from './screens/IdentifyScreen';
import { PaintScreen } from './screens/PaintScreen';
import { ShadesScreen } from './screens/ShadesScreen';
import type { Photo, Shade } from './types';

type Screen = 'home' | Section;

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
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

  const goTo = useCallback((next: Screen) => {
    setScreen(next);
    window.scrollTo({ top: 0 });
  }, []);

  const goHome = useCallback(() => goTo('home'), [goTo]);

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
    goTo('paint');

    notify(
      photo
        ? `Tap a wall to try ${shade.name}`
        : `Add a photo, then tap a wall to try ${shade.name}`
    );
  }

  return (
    <div className="app">
      <main className="screen theme-home" hidden={screen !== 'home'}>
        <HomeScreen
          shades={shades}
          favoriteCount={favorites.size}
          photo={photo}
          onOpen={goTo}
          onTry={tryShade}
        />
      </main>

      {/* Sections stay mounted so going Home keeps their work. */}
      <main className="screen theme-paint" hidden={screen !== 'paint'}>
        <PaintScreen
          photo={photo}
          uploading={uploading}
          onPickPhoto={pickPhoto}
          onPhotoReplaced={setPhoto}
          shades={shades}
          favorites={favorites}
          pendingShade={pendingShade}
          onPendingUsed={() => setPendingShade(undefined)}
          onHome={goHome}
          notify={notify}
        />
      </main>

      <main className="screen theme-identify" hidden={screen !== 'identify'}>
        <IdentifyScreen
          photo={photo}
          uploading={uploading}
          onPickPhoto={pickPhoto}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          onTry={tryShade}
          onHome={goHome}
          notify={notify}
        />
      </main>

      <main className="screen theme-shades" hidden={screen !== 'shades'}>
        <ShadesScreen
          shades={shades}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          onTry={tryShade}
          onHome={goHome}
          notify={notify}
        />
      </main>

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
