import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from 'react';

const API =
  import.meta.env.VITE_API_URL ||
  'http://localhost:8000';

const ANALYZING_MESSAGE =
  'Paintable preview ready. Outline a surface with Polygon now — AI is still detecting walls, windows and doors in the background…';

type Shade = {
  code: string;
  name: string;
  hex: string;
  category: string;
};

type UploadResponse = {
  image_id: string;
  image_url: string;
};

type Surface = {
  id: string;
  type: string;
  score: number;
  mask_url: string;
  box: number[];
};

type AnalyzeResponse = {
  image_id: string;
  paint_map_url: string;
  surfaces: Surface[];
  protected_count: number;
};

type RecolorResponse = {
  image_url: string;
  surfaces_rendered: number;
};

type PaintedSurface = {
  surface_id: string;
  color: string;
  shadeName: string;
  shadeCode: string;
};

type Photo = {
  id: string;
  url: string;
};

type Point = {
  x: number;
  y: number;
};

type EraseStroke = {
  points: Point[];
  width: number;
};

type CleanResponse = {
  image_id: string;
  image_url: string;
  removed: string[];
};

/*
 * Surface masks are stored per image as
 * `${imageId}_${surfaceId}.png`.
 */
const maskUrl = (
  imageId: string,
  surfaceId: string
) =>
  `${API}/api/visualizer/mask/${imageId}_${surfaceId}.png?t=${Date.now()}`;

/*
 * Parse a backend response. If the server crashed or a
 * proxy answered, the body may not be JSON; report that
 * clearly instead of "Unexpected token < in JSON".
 */
async function readJson(res: Response): Promise<any> {
  const text =
    await res.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      res.ok
        ? 'The server sent an unexpected response. Please try again.'
        : `Server error (${res.status}). Please try again in a moment.`
    );
  }
}

async function postJson<T>(
  path: string,
  body: unknown
): Promise<T> {
  const res =
    await fetch(
      `${API}${path}`,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',
        },

        body: JSON.stringify(body),
      }
    );

  const data =
    await readJson(res);

  if (!res.ok) {
    throw new Error(
      data.detail ||
      'Request failed'
    );
  }

  return data as T;
}

/*
 * Human-friendly surface names. Repeated types are
 * numbered ("Lower wall 1", "Lower wall 2") so the
 * list entries can be told apart.
 */
function surfaceLabels(
  surfaces: Surface[]
): Map<string, string> {
  const baseName = (surface: Surface) =>
    surface.type === 'manual surface'
      ? 'Your selection'
      : surface.type.charAt(0).toUpperCase() +
        surface.type.slice(1);

  const totals = new Map<string, number>();

  for (const surface of surfaces) {
    const name = baseName(surface);

    totals.set(
      name,
      (totals.get(name) ?? 0) + 1
    );
  }

  const seen = new Map<string, number>();
  const labels = new Map<string, string>();

  for (const surface of surfaces) {
    const name = baseName(surface);

    const index =
      (seen.get(name) ?? 0) + 1;

    seen.set(name, index);

    labels.set(
      surface.id,
      (totals.get(name) ?? 0) > 1
        ? `${name} ${index}`
        : name
    );
  }

  return labels;
}

export default function App() {
  const input =
    useRef<HTMLInputElement>(null);

  const imageRef =
    useRef<HTMLImageElement>(null);

  const [shades, setShades] =
    useState<Shade[]>([]);

  const [shadesError, setShadesError] =
    useState(false);

  const [shadeSearch, setShadeSearch] =
    useState('');

  const [shadeCategory, setShadeCategory] =
    useState('All');

  const [selectedShade, setSelectedShade] =
    useState<Shade>();

  const [preview, setPreview] =
    useState<string>();

  const [painted, setPainted] =
    useState<string>();

  const [paintMap, setPaintMap] =
    useState<string>();

  const [paintablePreview, setPaintablePreview] =
    useState<string>();
  
  const [viewMode, setViewMode] =
    useState<"original" | "clean" | "paintable" | "painted" | "map">(
      "paintable"
    );

  /*
   * The photo as uploaded, and its clean render
   * (wires, vehicles and clutter removed). Painting
   * happens on whichever one is the current base
   * (imageId / preview).
   */
  const [originalPhoto, setOriginalPhoto] =
    useState<Photo>();

  const [cleanPhoto, setCleanPhoto] =
    useState<Photo>();

  /*
   * Areas brushed over in Erase mode, in original
   * image pixel coordinates.
   */
  const [eraseStrokes, setEraseStrokes] =
    useState<EraseStroke[]>([]);

  const [brushSize, setBrushSize] =
    useState(28);

  const drawingStroke =
    useRef(false);

  const colorPanelRef =
    useRef<HTMLDivElement>(null);

  /*
   * Paintable preview URL per image id, so switching
   * between original and clean render is instant.
   */
  const previewCache =
    useRef(new Map<string, string>());

  /*
   * Id of the uploaded photo. Analysis results for
   * any other upload are stale and ignored.
   */
  const sessionId =
    useRef<string | undefined>(undefined);

  const [imageId, setImageId] =
    useState<string>();

  const [surfaces, setSurfaces] =
    useState<Surface[]>([]);

  /*
   * Surface selection mode
   *
   * polygon = user manually draws the exact
   * area that should be painted.
   *
   * click = existing AI/SAM selection mode.
   *
   * erase = brush over things to remove from
   * the clean render.
   */
  const [selectionMode, setSelectionMode] =
    useState<'click' | 'polygon' | 'erase'>('polygon');

  const [polygonPoints, setPolygonPoints] =
    useState<{ x: number; y: number }[]>([]);

  const [isDrawingPolygon, setIsDrawingPolygon] =
    useState(false);

  const [selectedSurface, setSelectedSurface] =
    useState<string>();

  const [paintedSurfaces, setPaintedSurfaces] =
    useState<PaintedSurface[]>([]);

  const [busy, setBusy] =
    useState(false);

  /*
   * Architectural analysis runs in the background
   * so the user can already draw polygons.
   */
  const [analyzing, setAnalyzing] =
    useState(false);

  /*
   * Image the UI is currently showing. Used to
   * ignore analysis results for a previous upload.
   */
  const currentImageId =
    useRef<string | undefined>(undefined);

  /*
   * Decoded surface masks, keyed by URL, used to
   * check which surface was actually clicked.
   */
  const maskCache =
    useRef(
      new Map<string, Promise<ImageData | null>>()
    );

  const [message, setMessage] =
    useState(
      'Upload a room or building photo to begin.'
    );

  /*
   * Load company shades
   */

  /*
   * The backend can still be starting up (loading
   * the AI models) when the page opens, so keep
   * retrying instead of giving up after one try.
   */
  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;

    const load = async () => {
      try {
        const res =
          await fetch(
            `${API}/api/visualizer/shades`
          );

        if (!res.ok) {
          throw new Error(
            'Could not load shades'
          );
        }

        const data =
          await readJson(res);

        if (!cancelled) {
          setShades(
            data.shades || []
          );

          setShadesError(false);
        }
      } catch {
        if (cancelled) {
          return;
        }

        setShadesError(true);

        attempt += 1;

        timer = setTimeout(
          load,
          Math.min(2000 * attempt, 10000)
        );
      }
    };

    void load();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const categories = [
    'All',
    ...Array.from(
      new Set(
        shades.map(
          shade => shade.category
        )
      )
    ),
  ];

  const filteredShades =
    shades.filter(shade => {
      const search =
        shadeSearch
          .toLowerCase()
          .trim();

      const matchesSearch =
        !search ||
        shade.name
          .toLowerCase()
          .includes(search) ||
        shade.code
          .toLowerCase()
          .includes(search);

      const matchesCategory =
        shadeCategory === 'All' ||
        shade.category ===
          shadeCategory;

      return (
        matchesSearch &&
        matchesCategory
      );
    });

  /*
   * Upload
   */

  async function upload(
    file?: File
  ) {
    if (!file) return;

    setBusy(true);

    setPreview(undefined);
    setPainted(undefined);
    setPaintMap(undefined);
    setPaintablePreview(undefined);
    setImageId(undefined);
    currentImageId.current = undefined;
    sessionId.current = undefined;

    setOriginalPhoto(undefined);
    setCleanPhoto(undefined);
    setEraseStrokes([]);
    previewCache.current.clear();

    setSurfaces([]);
    setSelectedSurface(undefined);
    setPaintedSurfaces([]);

    setSelectedShade(undefined);

    setViewMode('paintable');
    setAnalyzing(false);

    setPolygonPoints([]);
    setIsDrawingPolygon(false);

    setSelectionMode('polygon');

    setMessage(
      'Uploading image…'
    );

    const form =
      new FormData();

    form.append(
      'file',
      file
    );

    try {
      const res =
        await fetch(
          `${API}/api/visualizer/upload`,
          {
            method: 'POST',
            body: form,
          }
        );

      const data =
        await readJson(res);

      if (!res.ok) {
        throw new Error(
          data.detail ||
          'Upload failed'
        );
      }

      const result =
        data as UploadResponse;

      const imageUrl =
  `${API}${result.image_url}`;

setPreview(imageUrl);
setImageId(result.image_id);
currentImageId.current = result.image_id;
sessionId.current = result.image_id;

setOriginalPhoto({
  id: result.image_id,
  url: imageUrl,
});

setMessage(
  'Image uploaded. Creating paintable preview…'
);

const previewResponse = await fetch(
  `${API}/api/visualizer/paintable-preview`,
  {
    method: 'POST',

    headers: {
      'Content-Type':
        'application/json',
    },

    body: JSON.stringify({
      image_id:
        result.image_id,
    }),
  }
);

const previewData =
  await readJson(previewResponse);

if (!previewResponse.ok) {
  throw new Error(
    previewData.detail ||
    'Could not create paintable preview.'
  );
}

const paintableUrl =
  `${API}${previewData.preview_url}?t=${Date.now()}`;

previewCache.current.set(
  result.image_id,
  paintableUrl
);

setPaintablePreview(paintableUrl);

setViewMode("paintable");

setMessage(ANALYZING_MESSAGE);

/*
 * Don't await: analysis can take a while and the
 * user should be able to start selecting surfaces
 * straight away.
 */
void analyze(
  result.image_id
);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Upload failed.'
      );
    } finally {
      setBusy(false);
    }
  }

  /*
   * Architectural analysis
   */

  async function analyze(
    id: string
  ) {
    setAnalyzing(true);

    try {
      const res =
        await fetch(
          `${API}/api/visualizer/analyze`,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',
            },

            body: JSON.stringify({
              image_id: id,
            }),
          }
        );

      const data =
        await readJson(res);

      if (!res.ok) {
        throw new Error(
          data.detail ||
          'Architectural analysis failed'
        );
      }

      // A newer photo was uploaded meanwhile.
      if (sessionId.current !== id) {
        return;
      }

      const result =
        data as AnalyzeResponse;

      // The user may have switched to the clean
      // render while analysis ran: bring the
      // detected masks over to it.
      const base =
        currentImageId.current ?? id;

      if (base !== id) {
        await postJson(
          '/api/visualizer/transfer-surfaces',
          {
            from_image_id: id,
            to_image_id: base,
          }
        );
      }

      const detected =
        result.surfaces.map(surface => ({
          ...surface,
          mask_url:
            maskUrl(base, surface.id),
        }));

      // Keep any surfaces the user already
      // selected manually while analysis ran.
      setSurfaces(
        previous => [
          ...detected,
          ...previous,
        ]
      );

      setPaintMap(
        `${API}${result.paint_map_url}?t=${Date.now()}`
      );

      // Don't overwrite a message about something
      // the user did while analysis was running.
      setMessage(
        previous =>
          previous === ANALYZING_MESSAGE
            ? `${result.surfaces.length} paintable surface(s) detected. Use Polygon to outline an exact area, or AI Click for automatic selection.`
            : previous
      );
    } catch (error) {
      if (sessionId.current !== id) {
        return;
      }

      const reason =
        error instanceof Error
          ? error.message
          : 'Architectural analysis failed.';

      setMessage(
        `${reason} You can still outline surfaces with Polygon.`
      );
    } finally {
      if (sessionId.current === id) {
        setAnalyzing(false);
      }
    }
  }

  /*
   * Paintable preview for an image, generated once.
   */

  async function ensurePaintablePreview(
    id: string
  ) {
    const cached =
      previewCache.current.get(id);

    if (cached) {
      return cached;
    }

    const data =
      await postJson<{ preview_url: string }>(
        '/api/visualizer/paintable-preview',
        { image_id: id }
      );

    const url =
      `${API}${data.preview_url}?t=${Date.now()}`;

    previewCache.current.set(id, url);

    return url;
  }

  /*
   * Make another version of the photo (original or
   * clean render) the one that gets painted.
   *
   * Both versions have identical geometry, so the
   * selected surfaces and applied paint carry over.
   */

  async function switchBase(
    target: Photo
  ) {
    const from = imageId;

    if (!from || from === target.id) {
      return;
    }

    await postJson(
      '/api/visualizer/transfer-surfaces',
      {
        from_image_id: from,
        to_image_id: target.id,
      }
    );

    const previewUrl =
      await ensurePaintablePreview(
        target.id
      );

    setSurfaces(
      previous =>
        previous.map(surface => ({
          ...surface,
          mask_url:
            maskUrl(target.id, surface.id),
        }))
    );

    setImageId(target.id);
    currentImageId.current = target.id;

    setPreview(target.url);
    setPaintablePreview(previewUrl);

    if (paintedSurfaces.length > 0) {
      const data =
        await postJson<RecolorResponse>(
          '/api/visualizer/recolor',
          {
            image_id: target.id,

            surfaces:
              paintedSurfaces.map(item => ({
                surface_id:
                  item.surface_id,

                color:
                  item.color,
              })),
          }
        );

      setPainted(
        `${API}${data.image_url}?t=${Date.now()}`
      );
    }
  }

  async function paintOn(
    target: Photo
  ) {
    if (busy) {
      return;
    }

    setBusy(true);

    try {
      await switchBase(target);

      setMessage(
        target.id === cleanPhoto?.id
          ? 'Now painting on the clean render.'
          : 'Now painting on the original photo.'
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Could not switch photo.'
      );
    } finally {
      setBusy(false);
    }
  }

  /*
   * Clean render
   *
   * auto = remove wires, vehicles, people and
   * clutter automatically. Otherwise erase the
   * areas brushed over in Erase mode.
   */

  async function runClean(
    auto: boolean
  ) {
    if (!imageId || busy) {
      return;
    }

    if (!auto && eraseStrokes.length === 0) {
      setMessage(
        'Brush over the things you want to remove first.'
      );

      return;
    }

    setBusy(true);

    setMessage(
      auto
        ? 'Removing wires, vehicles and clutter… this can take up to a minute.'
        : 'Erasing the marked areas…'
    );

    try {
      const data =
        await postJson<CleanResponse>(
          '/api/visualizer/clean',
          {
            image_id: imageId,
            auto,

            strokes: auto
              ? []
              : eraseStrokes.map(stroke => ({
                  points:
                    stroke.points.map(point => [
                      point.x,
                      point.y,
                    ]),

                  width:
                    stroke.width,
                })),
          }
        );

      const target: Photo = {
        id: data.image_id,
        url: `${API}${data.image_url}`,
      };

      await switchBase(target);

      setCleanPhoto(target);
      setEraseStrokes([]);
      setViewMode('clean');

      setMessage(
        !auto
          ? 'Marked areas erased. Brush over anything else, or pick a surface to paint.'
          : data.removed.length > 0
            ? `Clean render ready. Removed: ${data.removed.join(', ')}. Use Erase to brush over anything that is left.`
            : 'Nothing was removed automatically. Use Erase to brush over things you want gone.'
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Clean render failed.'
      );
    } finally {
      setBusy(false);
    }
  }

  /*
   * Erase brush
   */

  const startStroke = (
    event: PointerEvent<HTMLImageElement>
  ) => {
    if (busy) {
      return;
    }

    const point =
      getImageCoordinates(event);

    if (!point) {
      return;
    }

    event.preventDefault();

    event.currentTarget.setPointerCapture(
      event.pointerId
    );

    drawingStroke.current = true;

    setEraseStrokes(
      previous => [
        ...previous,
        {
          points: [point],
          width: brushSize,
        },
      ]
    );
  };

  const continueStroke = (
    event: PointerEvent<HTMLImageElement>
  ) => {
    if (!drawingStroke.current) {
      return;
    }

    const point =
      getImageCoordinates(event);

    if (!point) {
      return;
    }

    setEraseStrokes(previous => {
      const last =
        previous[previous.length - 1];

      if (!last) {
        return previous;
      }

      const lastPoint =
        last.points[last.points.length - 1];

      // Skip points that barely moved.
      if (
        Math.hypot(
          point.x - lastPoint.x,
          point.y - lastPoint.y
        ) < 3
      ) {
        return previous;
      }

      return [
        ...previous.slice(0, -1),
        {
          ...last,
          points: [
            ...last.points,
            point,
          ],
        },
      ];
    });
  };

  const endStroke = () => {
    drawingStroke.current = false;
  };

  /*
   * Convert browser coordinates to
   * original image coordinates.
   *
   * This is important because the displayed
   * image can be scaled down in the browser.
   */

  const getImageCoordinates = (
    event: MouseEvent<HTMLImageElement>
  ) => {
    if (!imageRef.current) {
      return null;
    }

    const image =
      imageRef.current;

    const rect =
      image.getBoundingClientRect();

    const naturalWidth =
      image.naturalWidth;

    const naturalHeight =
      image.naturalHeight;

    if (
      !naturalWidth ||
      !naturalHeight ||
      !rect.width ||
      !rect.height
    ) {
      return null;
    }

    /*
     * The image uses object-fit: contain, so the
     * picture is letterboxed inside the element.
     * Map against the rendered picture, not the
     * element box.
     */
    const scale =
      Math.min(
        rect.width / naturalWidth,
        rect.height / naturalHeight
      );

    const offsetX =
      (
        rect.width -
        naturalWidth * scale
      ) / 2;

    const offsetY =
      (
        rect.height -
        naturalHeight * scale
      ) / 2;

    const x =
      (
        event.clientX -
        rect.left -
        offsetX
      ) / scale;

    const y =
      (
        event.clientY -
        rect.top -
        offsetY
      ) / scale;

    // Clicked in the letterbox, outside the photo.
    if (
      x < 0 ||
      y < 0 ||
      x > naturalWidth ||
      y > naturalHeight
    ) {
      return null;
    }

    return {
      x: Math.min(
        naturalWidth - 1,
        x
      ),

      y: Math.min(
        naturalHeight - 1,
        y
      ),
    };
  };

  /*
   * Load a surface mask into memory so clicks can
   * be tested against its real shape rather than
   * its bounding box.
   */

  const loadMask = (
    url: string
  ): Promise<ImageData | null> => {
    const cached =
      maskCache.current.get(url);

    if (cached) {
      return cached;
    }

    const promise =
      new Promise<ImageData | null>(
        resolve => {
          const image = new Image();

          image.crossOrigin = 'anonymous';

          image.onload = () => {
            try {
              const canvas =
                document.createElement('canvas');

              canvas.width =
                image.naturalWidth;

              canvas.height =
                image.naturalHeight;

              const context =
                canvas.getContext('2d');

              if (!context) {
                resolve(null);
                return;
              }

              context.drawImage(image, 0, 0);

              resolve(
                context.getImageData(
                  0,
                  0,
                  canvas.width,
                  canvas.height
                )
              );
            } catch {
              resolve(null);
            }
          };

          image.onerror = () =>
            resolve(null);

          image.src = url;
        }
      );

    maskCache.current.set(
      url,
      promise
    );

    return promise;
  };

  /*
   * true / false when the mask could be read,
   * null when it could not (fall back to the box).
   */

  const maskContains = async (
    surface: Surface,
    x: number,
    y: number
  ): Promise<boolean | null> => {
    const mask =
      await loadMask(surface.mask_url);

    if (!mask) {
      return null;
    }

    const px = Math.min(
      mask.width - 1,
      Math.floor(x)
    );

    const py = Math.min(
      mask.height - 1,
      Math.floor(y)
    );

    return (
      mask.data[
        (py * mask.width + px) * 4
      ] > 127
    );
  };

  /*
   * Polygon selection
   *
   * Every click adds a point.
   * The user then presses Finish Selection.
   */

  const handlePolygonClick = (
    event: MouseEvent<HTMLImageElement>
  ) => {
    if (
      selectionMode !== 'polygon' ||
      busy
    ) {
      return;
    }

    const point =
      getImageCoordinates(event);

    if (!point) {
      return;
    }

    if (!isDrawingPolygon) {
      setIsDrawingPolygon(true);

      setPolygonPoints([
        point,
      ]);

      setMessage(
        'Click around the surface to define its boundary. Add at least 3 points.'
      );

      return;
    }

    setPolygonPoints(
      previous => [
        ...previous,
        point,
      ]
    );
  };

  /*
   * Finish polygon selection
   *
   * Sends the user polygon to the backend.
   * The backend uses SAM 2 inside the polygon
   * and clips the final mask to the polygon.
   */

  const finishPolygon = async () => {
    if (polygonPoints.length < 3) {
      setMessage(
        'Please select at least 3 points.'
      );

      return;
    }

    if (!imageId) {
      setMessage(
        'No image selected.'
      );

      return;
    }

    setBusy(true);

    setMessage(
      'AI is refining your selected surface…'
    );

    try {
      const response =
        await fetch(
          `${API}/api/visualizer/segment-polygon`,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',
            },

            body: JSON.stringify({
              image_id:
                imageId,

              points:
                polygonPoints.map(
                  point => [
                    point.x,
                    point.y,
                  ]
                ),

              surface_type:
                'manual surface',
            }),
          }
        );

      const data =
        await readJson(response);

      if (!response.ok) {
        throw new Error(
          data.detail ||
          'Could not refine selection.'
        );
      }

      const newSurface: Surface = {
        id:
          data.surface_id,

        type:
          data.type ||
          'manual surface',

        score:
          Number(
            data.confidence || 0
          ),

        mask_url:
          `${API}${data.mask_url}?t=${Date.now()}`,

        box:
          data.box || [],
      };

      setSurfaces(
        previous => [
          ...previous,
          newSurface,
        ]
      );

      setSelectedSurface(
        newSurface.id
      );

      setSelectedShade(
        undefined
      );

      setPolygonPoints([]);

      setIsDrawingPolygon(
        false
      );

      setMessage(
        data.refined
          ? 'Surface selected (edges refined by AI). Choose a company shade.'
          : 'Surface selected. Choose a company shade.'
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Could not refine selection.'
      );
    } finally {
      setBusy(false);
    }
  };

  /*
   * Clear polygon
   */

  const clearPolygon = () => {
    setPolygonPoints([]);

    setIsDrawingPolygon(
      false
    );

    setMessage(
      'Polygon selection cleared.'
    );
  };

  /*
   * Find surface at click position
   *
   * This is the old AI Click mode.
   */

  async function selectSurface(
    event: MouseEvent<HTMLImageElement>
  ) {
    if (
      !imageId ||
      busy
    ) {
      return;
    }

    const point =
      getImageCoordinates(event);

    if (!point) {
      return;
    }

    const { x, y } = point;

    /*
     * Detected surfaces whose bounding box contains
     * the click, most specific (smallest) first.
     */

    const candidates =
      surfaces
        .filter(surface => {
          const [
            x1,
            y1,
            x2,
            y2,
          ] = surface.box;

          return (
            x >= x1 &&
            x <= x2 &&
            y >= y1 &&
            y <= y2
          );
        })
        .sort(
          (a, b) =>
            (a.box[2] - a.box[0]) *
              (a.box[3] - a.box[1]) -
            (b.box[2] - b.box[0]) *
              (b.box[3] - b.box[1])
        );

    /*
     * A box also contains the windows and doors
     * inside it, so check the real mask shape.
     */

    let surface: Surface | undefined;

    for (const candidate of candidates) {
      const inside =
        await maskContains(
          candidate,
          x,
          y
        );

      // Mask unreadable: trust the box.
      if (inside === null || inside) {
        surface = candidate;
        break;
      }
    }

    if (!surface) {
      /*
       * Grounding DINO did not detect a surface
       * containing this click.
       *
       * Fall back to SAM 2 point segmentation so
       * users can still select walls, pillars,
       * columns and facade sections that the
       * detector missed.
       */

      const surfaceId =
        `manual_${Date.now()}`;

      setBusy(true);

      setMessage(
        'AI is identifying the surface you clicked…'
      );

      try {
        const res =
          await fetch(
            `${API}/api/visualizer/segment`,
            {
              method: 'POST',

              headers: {
                'Content-Type':
                  'application/json',
              },

              body: JSON.stringify({
                image_id: imageId,

                x,
                y,

                surface_id:
                  surfaceId,

                surface_type:
                  'manual surface',
              }),
            }
          );

        const data =
          await readJson(res);

        if (!res.ok) {
          throw new Error(
            data.detail ||
            'Could not segment surface.'
          );
        }

        const maskUrl =
          `${API}${data.mask_url}?t=${Date.now()}`;

        /*
         * Add the manually selected surface
         * to the same surface list used by
         * Grounding DINO surfaces.
         */

        const manualSurface: Surface = {
          id:
            data.surface_id,

          type:
            data.type ||
            'manual surface',

          score:
            Number(
              data.confidence || 0
            ),

          mask_url:
            maskUrl,

          box:
            data.box || [
              x - 1,
              y - 1,
              x + 1,
              y + 1,
            ],
        };

        setSurfaces(
          previous => [
            ...previous,
            manualSurface,
          ]
        );

        setSelectedSurface(
          manualSurface.id
        );

        setSelectedShade(
          undefined
        );

        setMessage(
          'Surface selected. Choose a company shade.'
        );
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : 'Could not identify surface.'
        );
      } finally {
        setBusy(false);
      }

      return;
    }

    selectForPainting(
      surface.id
    );
  }

  /*
   * The shade currently applied to a surface, if any.
   */

  function currentShadeOf(
    surfaceId: string
  ): Shade | undefined {
    const item =
      paintedSurfaces.find(
        painted =>
          painted.surface_id === surfaceId
      );

    if (!item) {
      return undefined;
    }

    return (
      shades.find(
        shade =>
          shade.code === item.shadeCode
      ) ?? {
        code: item.shadeCode,
        name: item.shadeName,
        hex: item.color,
        category: '',
      }
    );
  }

  /*
   * Select a surface for painting. If it is already
   * painted, start from its current shade so the user
   * can change it (edit) instead of starting over.
   */

  function selectForPainting(
    surfaceId: string
  ) {
    const current =
      currentShadeOf(surfaceId);

    const name =
      surfaceLabels(surfaces).get(surfaceId) ??
      'Surface';

    setSelectedSurface(
      surfaceId
    );

    setSelectedShade(
      current
    );

    if (current) {
      // Make sure the current shade is visible.
      setShadeSearch('');
      setShadeCategory('All');

      setMessage(
        `Editing ${name} (currently ${current.name}). Pick a new shade and press Update.`
      );
    } else {
      setMessage(
        `${name} selected. Choose a company shade.`
      );
    }
  }

  /*
   * Select surface from surface list
   */

  function chooseSurface(
    surface: Surface
  ) {
    selectForPainting(
      surface.id
    );
  }

  /*
   * Edit button in the Current Paint panel
   */

  function editPaint(
    surfaceId: string
  ) {
    selectForPainting(
      surfaceId
    );

    // The shade card is further down the page.
    requestAnimationFrame(() =>
      colorPanelRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    );
  }

  /*
   * Apply shade to currently selected surface
   */

  async function applyPaint() {
    if (
      !imageId ||
      !selectedSurface ||
      !selectedShade ||
      busy
    ) {
      return;
    }

    setBusy(true);

    setMessage(
      `Applying ${selectedShade.name}…`
    );

    /*
     * Replace an existing assignment for this
     * surface in place (editing must not change
     * which paint sits on top where surfaces
     * overlap), or add a new one at the end.
     */

    const assignment: PaintedSurface = {
      surface_id:
        selectedSurface,

      color:
        selectedShade.hex,

      shadeName:
        selectedShade.name,

      shadeCode:
        selectedShade.code,
    };

    const previous =
      currentShadeOf(selectedSurface);

    const next =
      previous
        ? paintedSurfaces.map(item =>
            item.surface_id === selectedSurface
              ? assignment
              : item
          )
        : [
            ...paintedSurfaces,
            assignment,
          ];

    const surfaceName =
      surfaceLabels(surfaces).get(selectedSurface) ??
      'Surface';

    try {
      const res =
        await fetch(
          `${API}/api/visualizer/recolor`,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',
            },

            body: JSON.stringify({
              image_id:
                imageId,

              surfaces:
                next.map(item => ({
                  surface_id:
                    item.surface_id,

                  color:
                    item.color,
                })),
            }),
          }
        );

      const data =
        await readJson(res);

      if (!res.ok) {
        throw new Error(
          data.detail ||
          'Paint application failed'
        );
      }

      const result =
        data as RecolorResponse;

      setPaintedSurfaces(
        next
      );

      setPainted(
        `${API}${result.image_url}?t=${Date.now()}`
      );

      setSelectedShade(
        undefined
      );

      // Clear the selection highlight so the
      // painted result is clearly visible.
      setSelectedSurface(
        undefined
      );

      // Show the result that was just rendered.
      setViewMode('painted');

      setMessage(
        previous
          ? `${surfaceName} changed from ${previous.name} to ${assignment.shadeName}.`
          : `${assignment.shadeName} applied to ${surfaceName}. Select another surface to continue.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Paint application failed.'
      );
    } finally {
      setBusy(false);
    }
  }

  /*
   * Remove paint from one surface
   */

  async function removeSurfacePaint(
    surfaceId: string
  ) {
    if (
      !imageId ||
      busy
    ) {
      return;
    }

    setBusy(true);

    const next =
      paintedSurfaces.filter(
        item =>
          item.surface_id !==
          surfaceId
      );

    try {
      const res =
        await fetch(
          `${API}/api/visualizer/recolor`,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',
            },

            body: JSON.stringify({
              image_id:
                imageId,

              surfaces:
                next.map(item => ({
                  surface_id:
                    item.surface_id,

                  color:
                    item.color,
                })),
            }),
          }
        );

      const data =
        await readJson(res);

      if (!res.ok) {
        throw new Error(
          data.detail ||
          'Could not update paint'
        );
      }

      const result =
        data as RecolorResponse;

      setPaintedSurfaces(
        next
      );

      if (next.length > 0) {
        setPainted(
          `${API}${result.image_url}?t=${Date.now()}`
        );
      } else {
        setPainted(
          undefined
        );

        setViewMode('paintable');
      }

      setMessage(
        'Surface paint removed.'
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Could not update paint.'
      );
    } finally {
      setBusy(false);
    }
  }

  /*
   * Reset
   */

  function reset() {
    setPreview(undefined);
    setPainted(undefined);
    setPaintMap(undefined);
    setPaintablePreview(undefined);

    setViewMode("paintable");
    setImageId(undefined);
    currentImageId.current = undefined;
    sessionId.current = undefined;
    setAnalyzing(false);

    setOriginalPhoto(undefined);
    setCleanPhoto(undefined);
    setEraseStrokes([]);
    previewCache.current.clear();

    setSurfaces([]);
    setSelectedSurface(undefined);
    setPaintedSurfaces([]);

    setSelectedShade(undefined);

    setShadeSearch('');
    setShadeCategory('All');

    setPolygonPoints([]);
    setIsDrawingPolygon(false);
    setSelectionMode('polygon');

    setMessage(
      'Upload a room or building photo to begin.'
    );

    if (input.current) {
      input.current.value = '';
    }
  }

  const displayedImage =
  viewMode === "paintable" && paintablePreview
    ? paintablePreview
    : viewMode === "map" && paintMap
      ? paintMap
      : viewMode === "painted" && painted
        ? painted
        : viewMode === "clean" && cleanPhoto
          ? cleanPhoto.url
          : viewMode === "original" && originalPhoto
            ? originalPhoto.url
            : preview;

  const paintingOnClean =
    !!cleanPhoto &&
    imageId === cleanPhoto.id;

  const surfaceNames =
    surfaceLabels(surfaces);

  // Paint already on the selected surface (editing).
  const selectedPaint =
    paintedSurfaces.find(
      item =>
        item.surface_id === selectedSurface
    );

  const selectedSurfaceData =
    surfaces.find(
      surface =>
        surface.id === selectedSurface
    );

  return (
    <main>
      <header>
        <div className="brand">
          PAINT<span>AI</span>
        </div>

        <div className="tag">
          AI Paint Visualizer
        </div>
      </header>

      <section className="hero">
        <div className="controls">
          <p className="eyebrow">
            AI PAINT VISUALIZER · MVP 1.0
          </p>

          <h1>
            See your space
            <br />
            <em>in any color.</em>
          </h1>

          <p className="lead">
            Upload a room or building photo,
            select individual surfaces, and
            visualize your company's paint
            shades while preserving the
            original lighting and texture.
          </p>

          <button
            onClick={() =>
              input.current?.click()
            }
            disabled={busy}
          >
            {preview
              ? 'Choose another photo'
              : 'Upload a photo'}
          </button>

          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) =>
              upload(
                e.target.files?.[0]
              )
            }
          />

          {preview && (
            <button
              className="secondary"
              onClick={reset}
              disabled={busy}
            >
              Reset
            </button>
          )}

          <p className="status">
            {message}
          </p>

          {preview && (
            <div className="view-controls">
              {(
                [
                  ['original', 'Original', !!preview],
                  ['clean', 'Clean Render', !!cleanPhoto],
                  ['paintable', 'Paintable Preview', !!paintablePreview],
                  ['painted', 'Painted', !!painted],
                  ['map', 'AI Paint Map', !!paintMap],
                ] as const
              ).map(([mode, label, available]) => (
                <button
                  key={mode}
                  type="button"
                  className={
                    viewMode === mode
                      ? 'active'
                      : ''
                  }
                  onClick={() =>
                    setViewMode(mode)
                  }
                  disabled={busy || !available}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {preview && (
            <div className="clean-panel">
              <div className="panel-title">
                CLEAN RENDER
              </div>

              <p>
                Remove overhead wires, vehicles,
                people and clutter so only the
                building remains. Use Erase to
                brush over anything left behind.
              </p>

              <button
                type="button"
                onClick={() =>
                  runClean(true)
                }
                disabled={busy}
              >
                {cleanPhoto
                  ? 'Run automatic clean-up again'
                  : 'Create clean render'}
              </button>

              {cleanPhoto && originalPhoto && (
                <div className="base-toggle">
                  <span>Paint on:</span>

                  <button
                    type="button"
                    className={
                      !paintingOnClean
                        ? 'active'
                        : ''
                    }
                    onClick={() =>
                      paintOn(originalPhoto)
                    }
                    disabled={busy}
                  >
                    Original photo
                  </button>

                  <button
                    type="button"
                    className={
                      paintingOnClean
                        ? 'active'
                        : ''
                    }
                    onClick={() =>
                      paintOn(cleanPhoto)
                    }
                    disabled={busy}
                  >
                    Clean render
                  </button>
                </div>
              )}
            </div>
          )}

          {surfaces.length > 0 && (
            <div className="surface-panel">
              <div className="panel-title">
                DETECTED PAINTABLE SURFACES
              </div>

              <div className="surface-list">
                {surfaces.map(
                  surface => {
                    const paintedSurface =
                      paintedSurfaces.find(
                        item =>
                          item.surface_id ===
                          surface.id
                      );

                    const selected =
                      selectedSurface ===
                      surface.id;

                    return (
                      <button
                        key={surface.id}
                        className={
                          selected
                            ? 'surface-item selected'
                            : 'surface-item'
                        }
                        onClick={() =>
                          chooseSurface(
                            surface
                          )
                        }
                        disabled={busy}
                      >
                        {paintedSurface && (
                          <span
                            className="surface-color"
                            style={{
                              backgroundColor:
                                paintedSurface.color,
                            }}
                          />
                        )}

                        <span>
                          {surfaceNames.get(surface.id)}
                        </span>

                        {/* Manual selections are exact, so a
                            confidence score is meaningless. */}
                        {surface.type !== 'manual surface' && (
                          <small title="AI detection confidence">
                            {Math.round(
                              surface.score * 100
                            )}
                            %
                          </small>
                        )}
                      </button>
                    );
                  }
                )}
              </div>
            </div>
          )}

          {paintedSurfaces.length > 0 && (
            <div className="painted-panel">
              <div className="panel-title">
                CURRENT PAINT
              </div>

              {paintedSurfaces.map(
                item => (
                  <div
                    className={
                      selectedSurface === item.surface_id
                        ? 'painted-item editing'
                        : 'painted-item'
                    }
                    key={item.surface_id}
                  >
                    <span
                      className="painted-color"
                      style={{
                        backgroundColor:
                          item.color,
                      }}
                    />

                    <div>
                      <strong>
                        {item.shadeName}
                      </strong>

                      <small>
                        {item.shadeCode}
                        {surfaceNames.has(item.surface_id) &&
                          ` · ${surfaceNames.get(item.surface_id)}`}
                      </small>
                    </div>

                    <button
                      type="button"
                      className="edit-paint"
                      onClick={() =>
                        editPaint(
                          item.surface_id
                        )
                      }
                      disabled={busy}
                    >
                      {selectedSurface === item.surface_id
                        ? 'Editing'
                        : 'Edit'}
                    </button>

                    <button
                      type="button"
                      aria-label="Remove paint"
                      onClick={() =>
                        removeSurfacePaint(
                          item.surface_id
                        )
                      }
                      disabled={busy}
                    >
                      ×
                    </button>
                  </div>
                )
              )}
            </div>
          )}

          {selectedSurface && (
            <div
              className="color-panel"
              ref={colorPanelRef}
            >
              <div className="panel-title">
                {selectedPaint
                  ? `CHANGE PAINT · ${surfaceNames.get(selectedSurface) ?? ''}`
                  : 'YOUR COMPANY SHADE CARD'}
              </div>

              {selectedPaint && (
                <p className="editing-note">
                  Currently{' '}
                  <span
                    className="inline-swatch"
                    style={{
                      backgroundColor:
                        selectedPaint.color,
                    }}
                  />
                  <strong>
                    {selectedPaint.shadeName}
                  </strong>{' '}
                  ({selectedPaint.shadeCode}). Pick
                  a new shade below.
                </p>
              )}

              <input
                className="shade-search"
                type="text"
                placeholder="Search shade name or code..."
                value={shadeSearch}
                onChange={(e) =>
                  setShadeSearch(
                    e.target.value
                  )
                }
                disabled={busy}
              />

              <div className="category-row">
                {categories.map(
                  category => (
                    <button
                      key={category}
                      className={
                        shadeCategory ===
                        category
                          ? 'category active'
                          : 'category'
                      }
                      onClick={() =>
                        setShadeCategory(
                          category
                        )
                      }
                      disabled={busy}
                    >
                      {category}
                    </button>
                  )
                )}
              </div>

              {shades.length === 0 && (
                <p className="shade-empty">
                  {shadesError
                    ? 'Waiting for the server to load the shade library… retrying automatically.'
                    : 'Loading shades…'}
                </p>
              )}

              <div className="shade-grid">
                {filteredShades.map(
                  shade => (
                    <button
                      key={shade.code}
                      className={
                        selectedShade?.code ===
                        shade.code
                          ? 'shade selected'
                          : 'shade'
                      }
                      onClick={() =>
                        setSelectedShade(
                          shade
                        )
                      }
                      disabled={busy}
                    >
                      <span
                        className="shade-color"
                        style={{
                          backgroundColor:
                            shade.hex,
                        }}
                      />

                      <span className="shade-name">
                        {shade.name}
                      </span>

                      <span className="shade-code">
                        {shade.code}
                      </span>
                    </button>
                  )
                )}
              </div>

              {selectedShade && (
                <div className="selected-shade">
                  <div
                    className="selected-preview"
                    style={{
                      backgroundColor:
                        selectedShade.hex,
                    }}
                  />

                  <div>
                    <strong>
                      {selectedShade.name}
                    </strong>

                    <span>
                      Shade{' '}
                      {selectedShade.code}
                    </span>

                    <small>
                      {selectedShade.hex}
                    </small>
                  </div>
                </div>
              )}

              <button
                className="apply"
                onClick={applyPaint}
                disabled={
                  busy ||
                  !selectedShade ||
                  selectedShade.code ===
                    selectedPaint?.shadeCode
                }
              >
                {busy
                  ? 'Processing…'
                  : !selectedShade
                    ? 'Select a shade'
                    : selectedShade.code ===
                        selectedPaint?.shadeCode
                      ? 'This is the current shade'
                      : selectedPaint
                        ? `Update to ${selectedShade.name}`
                        : `Apply ${selectedShade.name}`}
              </button>

              {selectedPaint && (
                <button
                  type="button"
                  className="cancel-edit"
                  onClick={() => {
                    setSelectedSurface(undefined);
                    setSelectedShade(undefined);
                    setMessage(
                      'Edit cancelled. The paint was not changed.'
                    );
                  }}
                  disabled={busy}
                >
                  Cancel
                </button>
              )}
            </div>
          )}

          {painted && (
            <button
              className="compare"
              onClick={() =>
                setViewMode(
                  viewMode === 'original'
                    ? 'painted'
                    : 'original'
                )
              }
            >
              {viewMode === 'original'
                ? 'Show painted'
                : 'Show original'}
            </button>
          )}

          {painted && (
            /*
             * `painted` already carries a ?t= cache
             * buster; download=1 makes the backend
             * send it as an attachment.
             */
            <a
              className={
                busy
                  ? 'download disabled'
                  : 'download'
              }
              href={`${painted}&download=1`}
            >
              Download painted image
            </a>
          )}
        </div>

        <div className="preview">

          {/* 
           * Surface selection controls
           *
           * Polygon is the recommended mode.
           * AI Click keeps the old behaviour available.
           */}
          <div className="selection-controls">

            <button
              type="button"
              className={
                selectionMode === 'polygon'
                  ? 'active'
                  : ''
              }
              onClick={() => {
                setSelectionMode('polygon');
                clearPolygon();
              }}
              disabled={busy}
            >
              Polygon
            </button>

            <button
              type="button"
              className={
                selectionMode === 'click'
                  ? 'active'
                  : ''
              }
              onClick={() => {
                setSelectionMode('click');
                clearPolygon();
              }}
              disabled={busy}
            >
              AI Click
            </button>

            <button
              type="button"
              className={
                selectionMode === 'erase'
                  ? 'active'
                  : ''
              }
              onClick={() => {
                setSelectionMode('erase');
                setPolygonPoints([]);
                setIsDrawingPolygon(false);
                setSelectedSurface(undefined);
                setMessage(
                  'Brush over wires, objects or anything else you want removed, then press Erase Marked.'
                );
              }}
              disabled={busy || !preview}
            >
              Erase
            </button>

            {selectionMode === 'erase' && (
              <>
                <label className="brush-size">
                  Brush

                  <input
                    type="range"
                    min={6}
                    max={120}
                    value={brushSize}
                    onChange={(e) =>
                      setBrushSize(
                        Number(e.target.value)
                      )
                    }
                    disabled={busy}
                  />
                </label>

                <button
                  type="button"
                  onClick={() =>
                    runClean(false)
                  }
                  disabled={
                    busy ||
                    eraseStrokes.length === 0
                  }
                >
                  Erase Marked
                </button>

                {eraseStrokes.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setEraseStrokes(
                          previous =>
                            previous.slice(0, -1)
                        )
                      }
                      disabled={busy}
                    >
                      Undo
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setEraseStrokes([])
                      }
                      disabled={busy}
                    >
                      Clear
                    </button>
                  </>
                )}
              </>
            )}

            {selectionMode === 'polygon' &&
              polygonPoints.length >= 3 && (
                <button
                  type="button"
                  onClick={finishPolygon}
                  disabled={busy}
                >
                  Finish Selection
                </button>
              )}

            {polygonPoints.length > 0 && (
              <button
                type="button"
                onClick={clearPolygon}
                disabled={busy}
              >
                Clear
              </button>
            )}
          </div>

          {displayedImage ? (

            <div className="image-stage">
              {viewMode === "paintable" && (
  <div className="map-label">
    AI PAINTABLE PREVIEW
  </div>
)}

{viewMode === "map" && (
  <div className="map-label">
    AI PAINT MAP
  </div>
)}
{viewMode === "painted" && (
  <div className="map-label">
    PAINTED RESULT
  </div>
)}
{viewMode === "clean" && (
  <div className="map-label">
    CLEAN RENDER
  </div>
)}
              {/*
               * Every view has the same pixel geometry,
               * so surfaces can be selected in any of them.
               */}
              <img
  ref={imageRef}
  src={displayedImage}
  alt="Room visualization"
  className={
    selectionMode === "erase"
      ? "room-image erasing"
      : "room-image"
  }
  draggable={false}
  onClick={
    selectionMode === "polygon"
      ? handlePolygonClick
      : selectionMode === "click"
        ? selectSurface
        : undefined
  }
  onPointerDown={
    selectionMode === "erase"
      ? startStroke
      : undefined
  }
  onPointerMove={
    selectionMode === "erase"
      ? continueStroke
      : undefined
  }
  onPointerUp={endStroke}
  onPointerCancel={endStroke}
/>

              {selectedSurfaceData && (
                <img
                  className="mask"
                  src={selectedSurfaceData.mask_url}
                  crossOrigin="anonymous"
                  alt=""
                />
              )}

              
               
              {(polygonPoints.length > 0 ||
                eraseStrokes.length > 0) &&
                imageRef.current && (
                  <svg
                    className="polygon-overlay"
                    viewBox={`0 0 ${
                      imageRef.current.naturalWidth
                    } ${
                      imageRef.current.naturalHeight
                    }`}
                    preserveAspectRatio="xMidYMid meet"
                  >
                    {/*
                     * Areas marked for erasing. Drawn opaque
                     * inside a translucent group so overlaps
                     * don't get darker.
                     */}
                    <g opacity={0.5}>
                      {eraseStrokes.map(
                        (stroke, index) =>
                          stroke.points.length === 1 ? (
                            <circle
                              key={index}
                              cx={stroke.points[0].x}
                              cy={stroke.points[0].y}
                              r={stroke.width / 2}
                              fill="#ff3b30"
                            />
                          ) : (
                            <polyline
                              key={index}
                              points={stroke.points
                                .map(
                                  point =>
                                    `${point.x},${point.y}`
                                )
                                .join(' ')}
                              fill="none"
                              stroke="#ff3b30"
                              strokeWidth={stroke.width}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          )
                      )}
                    </g>

                    {polygonPoints.length >= 3 && (
                      <polygon
                        points={polygonPoints
                          .map(
                            point =>
                              `${point.x},${point.y}`
                          )
                          .join(' ')}
                        fill="rgba(255,255,255,0.15)"
                        stroke="white"
                        strokeWidth="4"
                      />
                    )}

                    {polygonPoints.length > 1 && (
                      <polyline
                        points={polygonPoints
                          .map(
                            point =>
                              `${point.x},${point.y}`
                          )
                          .join(' ')}
                        fill="none"
                        stroke="white"
                        strokeWidth="4"
                      />
                    )}

                    {polygonPoints.map(
                      (point, index) => (
                        <circle
                          key={index}
                          cx={point.x}
                          cy={point.y}
                          r="8"
                          fill="white"
                          stroke="black"
                          strokeWidth="3"
                        />
                      )
                    )}
                  </svg>
                )}

              {(busy || analyzing) && (
                <div className="processing">
                  <div className="spinner" />

                  <span>
                    {busy
                      ? 'AI processing…'
                      : 'Detecting surfaces… you can select already'}
                  </span>
                </div>
              )}

              {painted && (
                <div className="result-badge">
                  PAINT AI
                </div>
              )}

            </div>

          ) : (

            <div className="empty">
              <div className="plus">
                +
              </div>

              <strong>
                Your visualization appears here
              </strong>

              <span>
                JPG, PNG or WebP · up to 15 MB
              </span>
            </div>

          )}

        </div>
      </section>
    </main>
  );
}