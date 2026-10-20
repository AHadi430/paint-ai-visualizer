"""
Cleaner, smoother surface masks.

SAM masks often have ragged outlines (especially where a wall meets a
ceiling of a similar colour), stray specks and pinholes. Refining them:

1. drops specks that are not part of the surface,
2. fills pinholes (but keeps real openings such as windows),
3. smooths the outline while snapping it to edges in the photo, using
   a guided filter (He, Sun & Tang, 2010): the mask is smoothed where
   the photo is flat and keeps its shape where the photo has an edge.
"""

import cv2
import numpy as np


def _guided_filter(
    guide: np.ndarray,
    source: np.ndarray,
    radius: int,
    eps: float,
) -> np.ndarray:
    """Edge-preserving smoothing of `source`, steered by `guide`."""

    size = (2 * radius + 1, 2 * radius + 1)

    def box(image):
        return cv2.boxFilter(image, cv2.CV_32F, size)

    mean_i = box(guide)
    mean_p = box(source)
    corr_ip = box(guide * source)
    var_i = box(guide * guide) - mean_i * mean_i

    a = (corr_ip - mean_i * mean_p) / (var_i + eps)
    b = mean_p - a * mean_i

    return box(a) * guide + box(b)


def refine_mask(
    mask: np.ndarray,
    image_rgb: np.ndarray,
) -> np.ndarray:
    """Return a cleaned-up copy of a boolean surface mask."""

    mask = mask.astype(bool)
    height, width = mask.shape
    area = mask.sum()

    if area == 0:
        return mask

    # 1. Keep the surface, drop specks (< 2% of the surface).
    count, labels, stats, _ = cv2.connectedComponentsWithStats(
        mask.astype(np.uint8), connectivity=8
    )

    keep = np.zeros(count, dtype=bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= max(150, area * 0.02)

    # Never drop everything.
    if not keep.any() and count > 1:
        keep[1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])] = True

    mask = keep[labels]

    # 2. Fill pinholes: enclosed gaps smaller than 0.1% of the photo.
    #    Bigger openings (windows, doors) stay unpainted.
    count, labels, stats, _ = cv2.connectedComponentsWithStats(
        (~mask).astype(np.uint8), connectivity=4
    )

    small_hole = stats[:, cv2.CC_STAT_AREA] < height * width * 0.001
    touches_border = (
        (stats[:, cv2.CC_STAT_LEFT] == 0)
        | (stats[:, cv2.CC_STAT_TOP] == 0)
        | (stats[:, cv2.CC_STAT_LEFT] + stats[:, cv2.CC_STAT_WIDTH] == width)
        | (stats[:, cv2.CC_STAT_TOP] + stats[:, cv2.CC_STAT_HEIGHT] == height)
    )

    fill = small_hole & ~touches_border
    fill[0] = False  # label 0 is the mask itself
    mask = mask | fill[labels]

    # 3. Edge-aware smoothing of the outline.
    guide = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    radius = max(3, int(round(max(height, width) * 0.004)))

    smooth = _guided_filter(
        guide,
        mask.astype(np.float32),
        radius=radius,
        eps=1e-3,
    )

    refined = smooth > 0.5

    # Smoothing must not wipe out a thin surface (e.g. a pillar).
    if refined.sum() < area * 0.5:
        return mask

    return refined
