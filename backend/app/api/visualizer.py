import json
import re
import shutil
from pathlib import Path
from uuid import uuid4

import cv2
from ..ai.architectural_map import (
    architectural_map_service,
)
from ..services.paintable_preview import (
    paintable_preview_service,
)
import numpy as np
from ..services.render_service import render_service
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from PIL import Image
from ..config import settings
from ..services.image_service import (
    save_upload,
    ALLOWED,
)
from ..ai.sam import sam_service
from ..services.clean_service import clean_service


router = APIRouter(
    prefix="/api/visualizer",
    tags=["visualizer"],
)


# Company shade library
SHADE_FILE = (
    Path(__file__).resolve().parents[2]
    / "data"
    / "shades.json"
)


class SegmentRequest(BaseModel):
    image_id: str
    x: float
    y: float
    surface_id: str | None = None
    surface_type: str = "manual surface"

class PolygonSegmentRequest(BaseModel):
    image_id: str
    points: list[list[float]]
    surface_id: str | None = None
    surface_type: str = "manual surface"


class EraseStroke(BaseModel):
    points: list[list[float]]
    width: float = 24


class CleanRequest(BaseModel):
    image_id: str
    # Automatically remove wires, vehicles, people...
    auto: bool = True
    # Extra areas the user brushed over.
    strokes: list[EraseStroke] = []


class TransferRequest(BaseModel):
    from_image_id: str
    to_image_id: str


IMAGE_ID = re.compile(r"^[0-9a-f]{32}$")

# Ids and names that end up in file paths must never
# contain "/" or "..".
SURFACE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

SAFE_FILENAME = re.compile(
    r"^[A-Za-z0-9_-]{1,128}\.(png|jpg|jpeg|webp)$"
)

# Per-image files that are NOT surface masks.
NON_MASK_SUFFIXES = (
    "_painted.png",
    "_paintable_preview.png",
)


def _check_surface_id(surface_id: str) -> str:

    if not isinstance(surface_id, str) or not SURFACE_ID.match(surface_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid surface id.",
        )

    return surface_id


def _check_filename(filename: str) -> str:

    if not SAFE_FILENAME.match(filename):
        raise HTTPException(
            status_code=404,
            detail="File not found.",
        )

    return filename


def _find_upload(image_id: str) -> Path:

    if not isinstance(image_id, str) or not IMAGE_ID.match(image_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid image id.",
        )

    matches = list(
        Path(settings.upload_dir).glob(
            f"{image_id}.*"
        )
    )

    if not matches:
        raise HTTPException(
            status_code=404,
            detail="Image not found.",
        )

    return matches[0]


def _copy_surface_masks(
    from_id: str,
    to_id: str,
) -> int:
    """
    Surface masks are keyed by image id. A clean render
    has exactly the same geometry as its source, so the
    masks (and the paint map) can be reused as-is.
    """

    output_dir = Path(settings.output_dir)
    copied = 0

    for path in output_dir.glob(f"{from_id}_*.png"):

        if path.name.endswith(NON_MASK_SUFFIXES):
            continue

        suffix = path.name[len(from_id):]

        shutil.copyfile(
            path,
            output_dir / f"{to_id}{suffix}",
        )

        copied += 1

    return copied


@router.get("/shades")
def get_shades():
    if not SHADE_FILE.exists():
        raise HTTPException(
            500,
            "Shade library not found.",
        )

    try:
        with open(
            SHADE_FILE,
            "r",
            encoding="utf-8",
        ) as file:
            shades = json.load(file)

    except Exception as exc:
        raise HTTPException(
            500,
            f"Could not load shade library: {exc}",
        )

    return {
        "count": len(shades),
        "shades": shades,
    }


@router.post("/upload")
async def upload_image(
    file: UploadFile = File(...),
):
    if file.content_type not in ALLOWED:
        raise HTTPException(
            400,
            "Please upload a JPG, PNG, or WebP image.",
        )

    data = await file.read()

    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(
            413,
            f"Image must be under "
            f"{settings.max_upload_mb} MB.",
        )

    try:
        path, image = save_upload(
            data,
            file.filename or "image",
            settings.upload_dir,
        )

    except Exception as exc:
        raise HTTPException(
            400,
            f"Could not read image: {exc}",
        )

    return {
        "image_id": Path(path).stem,
        "image_url":
            f"/api/visualizer/image/{Path(path).name}",
        "status": "uploaded",
    }


@router.post("/paintable-preview")
def create_paintable_preview(
    payload: dict,
):
    image_id = payload.get("image_id")

    if not image_id:
        raise HTTPException(
            status_code=400,
            detail="image_id is required.",
        )

    image_path = _find_upload(image_id)

    preview_filename = (
        f"{image_id}_paintable_preview.png"
    )

    preview_path = (
        Path(settings.output_dir)
        / preview_filename
    )

    try:
        paintable_preview_service.create_preview(
            image_path=str(image_path),
            output_path=str(preview_path),
        )

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=(
                "Could not create paintable preview: "
                f"{exc}"
            ),
        )

    return {
        "image_id": image_id,
        "preview_url": (
            "/api/visualizer/image/"
            f"{preview_filename}"
        ),
        "status": "ready",
    }

@router.post("/segment-polygon")
def segment_polygon(
    request: PolygonSegmentRequest,
):
    image_path = _find_upload(request.image_id)

    if len(request.points) < 3:
        raise HTTPException(
            status_code=400,
            detail="A polygon requires at least 3 points.",
        )

    try:
        image = Image.open(
            image_path
        ).convert("RGB")

        width, height = image.size

        # -------------------------------------------------
        # Validate and clamp polygon points
        # -------------------------------------------------

        polygon = []

        for point in request.points:

            if len(point) != 2:
                raise ValueError(
                    "Invalid polygon point."
                )

            x = float(point[0])
            y = float(point[1])

            x = max(
                0.0,
                min(
                    float(width - 1),
                    x,
                ),
            )

            y = max(
                0.0,
                min(
                    float(height - 1),
                    y,
                ),
            )

            polygon.append(
                [x, y]
            )

        polygon_array = np.array(
            polygon,
            dtype=np.float32,
        )

        # -------------------------------------------------
        # Create HARD user polygon mask
        # -------------------------------------------------

        polygon_mask = np.zeros(
            (height, width),
            dtype=np.uint8,
        )

        cv2.fillPoly(
            polygon_mask,
            [
                polygon_array.astype(
                    np.int32
                )
            ],
            1,
        )

        polygon_area = float(
            np.sum(polygon_mask)
        )

        image_area = float(
            width * height
        )

        polygon_ratio = (
            polygon_area / image_area
        )

        # Close-up photos of a single wall legitimately
        # cover most of the frame, so only reject a
        # polygon that is effectively the whole image.
        if polygon_ratio > 0.98:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Selected area covers the whole image. "
                    "Please outline a specific surface."
                ),
            )

        if polygon_area < 100:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Selected area is too small."
                ),
            )

        # -------------------------------------------------
        # Bounding box around user's polygon
        # -------------------------------------------------

        x1 = float(
            polygon_array[:, 0].min()
        )

        y1 = float(
            polygon_array[:, 1].min()
        )

        x2 = float(
            polygon_array[:, 0].max()
        )

        y2 = float(
            polygon_array[:, 1].max()
        )

        box = [
            x1,
            y1,
            x2,
            y2,
        ]

        # -------------------------------------------------
        # The user's polygon IS the selection.
        #
        # SAM is only used to tighten the edges when one
        # of its candidates closely matches the polygon.
        # Otherwise SAM usually picked a sub-object
        # (a window, a patch of wall) and intersecting
        # with it would throw away most of the area the
        # user outlined.
        # -------------------------------------------------

        polygon_bool = polygon_mask.astype(bool)

        final_mask = polygon_bool
        confidence = 1.0
        refined = False

        try:
            candidates, scores = (
                sam_service.box_candidates(
                    str(image_path),
                    box,
                )
            )

            best_iou = 0.0
            best_index = -1

            for index, candidate in enumerate(
                candidates
            ):
                intersection = np.logical_and(
                    candidate,
                    polygon_bool,
                ).sum()

                union = np.logical_or(
                    candidate,
                    polygon_bool,
                ).sum()

                iou = (
                    float(intersection) / float(union)
                    if union
                    else 0.0
                )

                if iou > best_iou:
                    best_iou = iou
                    best_index = index

            if best_index >= 0 and best_iou >= 0.80:
                # SAM can NEVER escape the user's polygon.
                final_mask = np.logical_and(
                    candidates[best_index],
                    polygon_bool,
                )
                confidence = float(
                    scores[best_index]
                )
                refined = True

        except Exception as exc:
            print(
                "SAM polygon refinement skipped:",
                exc,
            )

        final_area = float(
            np.sum(final_mask)
        )

        final_ratio = (
            final_area / image_area
        )

        # -------------------------------------------------
        # Unique surface ID
        # -------------------------------------------------

        surface_id = _check_surface_id(
            request.surface_id
            or f"manual_{uuid4().hex[:12]}"
        )

        mask_filename = (
            f"{request.image_id}_"
            f"{surface_id}.png"
        )

        mask_path = (
            Path(settings.output_dir)
            / mask_filename
        )

        mask_path.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        mask_image = Image.fromarray(
            (
                final_mask
                * 255
            ).astype(np.uint8)
        )

        mask_image.save(
            mask_path
        )

        return {
            "image_id": request.image_id,
            "surface_id": surface_id,
            "type": request.surface_type,
            "score": float(confidence),
            "confidence": float(confidence),
            "mask_url": (
                "/api/visualizer/mask/"
                f"{mask_filename}"
            ),
            "box": [
                x1,
                y1,
                x2,
                y2,
            ],
            "polygon": polygon,
            "area_ratio": final_ratio,
            "refined": refined,
            "status": "segmented",
        }

    except HTTPException:
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=(
                "Polygon segmentation failed: "
                f"{exc}"
            ),
        )


@router.post("/segment")
def segment_image(
    request: SegmentRequest,
):
    image_path = _find_upload(request.image_id)

    try:
        mask, confidence = (
            sam_service.segment_from_point(
                str(image_path),
                request.x,
                request.y,
            )
        )

    except Exception as exc:
        raise HTTPException(
            500,
            f"SAM segmentation failed: {exc}",
        )

    # Give manually selected surfaces a stable ID.
    surface_id = _check_surface_id(
        request.surface_id
        or "manual_surface"
    )

    mask_filename = (
        f"{request.image_id}_{surface_id}.png"
    )

    mask_path = (
        Path(settings.output_dir)
        / mask_filename
    )

    mask_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    mask_image = Image.fromarray(
        mask.astype(np.uint8) * 255
    )

    mask_image.save(mask_path)

    # Calculate bounding box from the mask.
    ys, xs = np.where(mask)

    if len(xs) > 0 and len(ys) > 0:
        box = [
            float(xs.min()),
            float(ys.min()),
            float(xs.max()),
            float(ys.max()),
        ]
    else:
        box = [
            float(request.x - 1),
            float(request.y - 1),
            float(request.x + 1),
            float(request.y + 1),
        ]

    return {
        "image_id": request.image_id,
        "surface_id": surface_id,
        "type": request.surface_type,
        "mask_url": (
            f"/api/visualizer/mask/"
            f"{mask_filename}"
        ),
        "confidence": confidence,
        "box": box,
        "status": "segmented",
    }


@router.post("/recolor")
def recolor_image(payload: dict):
    image_id = payload.get("image_id")
    surfaces = payload.get("surfaces", [])

    if not image_id:
        raise HTTPException(
            status_code=400,
            detail="image_id is required.",
        )

    if not isinstance(surfaces, list):
        raise HTTPException(
            status_code=400,
            detail="surfaces must be a list.",
        )

    image_path = _find_upload(image_id)

    output_filename = (
        f"{image_id}_painted.png"
    )

    output_path = (
        Path(settings.output_dir)
        / output_filename
    )

    render_surfaces = []

    for surface in surfaces:

        if not isinstance(surface, dict):
            continue

        surface_id = surface.get("surface_id")
        color = surface.get("color")

        if not surface_id or not color:
            continue

        # Only allow expected surface IDs.
        _check_surface_id(surface_id)

        mask_filename = (
            f"{image_id}_{surface_id}.png"
        )

        mask_path = (
            Path(settings.output_dir)
            / mask_filename
        )

        if not mask_path.exists():
            continue

        render_surfaces.append(
            {
                "surface_id": surface_id,
                "color": color,
                "mask_path": str(mask_path),
            }
        )

    try:

        render_service.render(
            image_path=str(image_path),
            surfaces=render_surfaces,
            output_path=str(output_path),
        )

    except Exception as exc:

        raise HTTPException(
            status_code=500,
            detail=f"Rendering failed: {exc}",
        )

    return {
        "image_url": (
            f"/api/visualizer/image/"
            f"{output_filename}"
        ),
        "surfaces_rendered": len(
            render_surfaces
        ),
    }





@router.post("/clean")
def clean_image(
    request: CleanRequest,
):
    """
    Creates a clean render: overhead wires, vehicles,
    people, poles and loose objects are removed, plus
    any areas the user brushed over.

    The result is saved as a NEW image so everything
    else (segmentation, painting) works on it unchanged.
    """

    image_path = _find_upload(
        request.image_id
    )

    if not request.auto and not request.strokes:
        raise HTTPException(
            status_code=400,
            detail="Mark at least one area to erase.",
        )

    try:
        with Image.open(image_path) as image:
            width, height = image.size

        # Rasterise the user's brush strokes.
        brush_mask = np.zeros(
            (height, width),
            dtype=np.uint8,
        )

        for stroke in request.strokes:

            points = np.array(
                [
                    [
                        min(max(x, 0), width - 1),
                        min(max(y, 0), height - 1),
                    ]
                    for x, y in (
                        point[:2]
                        for point in stroke.points
                        if len(point) >= 2
                    )
                ],
                dtype=np.int32,
            )

            if len(points) == 0:
                continue

            thickness = int(
                min(max(stroke.width, 2), 400)
            )

            if len(points) > 1:
                cv2.polylines(
                    brush_mask,
                    [points],
                    isClosed=False,
                    color=1,
                    thickness=thickness,
                )

            # Round caps and joins.
            for x, y in points:
                cv2.circle(
                    brush_mask,
                    (int(x), int(y)),
                    thickness // 2,
                    1,
                    -1,
                )

        new_id = uuid4().hex

        output_path = (
            Path(settings.upload_dir)
            / f"{new_id}.jpg"
        )

        result = clean_service.clean(
            image_path=str(image_path),
            output_path=str(output_path),
            auto=request.auto,
            extra_mask=(
                brush_mask
                if brush_mask.any()
                else None
            ),
        )

    except HTTPException:
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Clean render failed: {exc}",
        )

    _copy_surface_masks(
        request.image_id,
        new_id,
    )

    return {
        "image_id": new_id,
        "source_image_id": request.image_id,
        "image_url": (
            f"/api/visualizer/image/{new_id}.jpg"
        ),
        "removed": result["removed"],
        "removed_ratio": result["removed_ratio"],
        "status": "cleaned",
    }


@router.post("/transfer-surfaces")
def transfer_surfaces(
    request: TransferRequest,
):
    """
    Copy surface masks between two versions of the same
    photo (original <-> clean render).
    """

    _find_upload(request.from_image_id)
    _find_upload(request.to_image_id)

    copied = _copy_surface_masks(
        request.from_image_id,
        request.to_image_id,
    )

    return {
        "copied": copied,
    }


@router.get("/image/{filename}")
def get_image(
    filename: str,
    download: bool = False,
):

    _check_filename(filename)

    upload_path = (
        Path(settings.upload_dir)
        / filename
    )

    output_path = (
        Path(settings.output_dir)
        / filename
    )

    for path in (upload_path, output_path):

        if not path.is_file():
            continue

        if download:
            # Content-Disposition: attachment makes the
            # browser save the file. The <a download>
            # attribute is ignored cross-origin.
            label = (
                "painted"
                if path.stem.endswith("_painted")
                else "image"
            )

            return FileResponse(
                path,
                filename=(
                    f"paint-visualizer-{label}-"
                    f"{path.stem[:8]}{path.suffix}"
                ),
            )

        return FileResponse(
            path
        )

    raise HTTPException(
        status_code=404,
        detail="Image not found.",
    )


@router.get("/mask/{filename}")
def get_mask(
    filename: str,
):
    path = (
        Path(settings.output_dir)
        / _check_filename(filename)
    )

    if not path.is_file():
        raise HTTPException(
            404,
            "Mask not found.",
        )

    return FileResponse(
        path,
        media_type="image/png",
    )

@router.post("/analyze")
def analyze_image(payload: dict):

    image_id = payload.get("image_id")

    if not image_id:
        raise HTTPException(
            status_code=400,
            detail="image_id is required.",
        )

    image_path = _find_upload(image_id)

    try:

        result = (
            architectural_map_service
            .analyze(str(image_path))
        )

        surfaces_response = []

        for index, surface in enumerate(
            result["surfaces"]
        ):

            surface_id = (
                surface.get("id")
                or f"surface_{index}"
            )

            mask_filename = (
                f"{image_id}_{surface_id}.png"
            )

            mask_path = (
                Path(settings.output_dir)
                / mask_filename
            )

            mask_image = Image.fromarray(
                (
                    surface["mask"]
                    .astype(np.uint8)
                    * 255
                )
            )

            mask_image.save(
                mask_path
            )

            surfaces_response.append(
                {
                    "id": surface_id,
                    "type": surface["type"],
                    "score": float(
                        surface["score"]
                    ),
                    "mask_url": (
                        "/api/visualizer/mask/"
                        f"{mask_filename}"
                    ),
                    "box": [
                        float(x)
                        for x in surface["box"]
                    ],
                }
            )

        map_image = (
            architectural_map_service
            .create_map_image(
                Image.open(
                    image_path
                ).convert("RGB"),
                result["surfaces"],
            )
        )

        map_filename = (
            f"{image_id}_paint_map.png"
        )

        map_path = (
            Path(settings.output_dir)
            / map_filename
        )

        map_image.save(map_path)

        return {
            "image_id": image_id,
            "paint_map_url": (
                "/api/visualizer/map/"
                f"{map_filename}"
            ),
            "surfaces":
                surfaces_response,
            "protected_count":
                result["protected_count"],
        }

    except Exception as exc:

        raise HTTPException(
            status_code=500,
            detail=(
                "Architectural analysis failed: "
                f"{exc}"
            ),
        )

@router.get("/map/{filename}")
def get_paint_map(filename: str):

    path = (
        Path(settings.output_dir)
        / _check_filename(filename)
    )

    if not path.is_file():
        raise HTTPException(
            status_code=404,
            detail="Paint map not found.",
        )

    return FileResponse(
        path,
        media_type="image/png",
    )