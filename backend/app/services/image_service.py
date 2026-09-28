from pathlib import Path
from uuid import uuid4
from io import BytesIO

from PIL import Image
import numpy as np
import cv2


ALLOWED = {
    "image/jpeg",
    "image/png",
    "image/webp",
}


def save_upload(
    data: bytes,
    filename: str,
    upload_dir: str,
) -> tuple[str, Image.Image]:

    Path(upload_dir).mkdir(
        parents=True,
        exist_ok=True,
    )

    image = Image.open(
        BytesIO(data)
    ).convert("RGB")

    image.thumbnail(
        (2400, 2400),
        Image.Resampling.LANCZOS,
    )

    out = (
        Path(upload_dir)
        / f"{uuid4().hex}.jpg"
    )

    image.save(
        out,
        "JPEG",
        quality=92,
    )

    return str(out), image


def rough_wall_mask(
    image: Image.Image,
) -> Image.Image:

    arr = np.array(image)

    h, w = arr.shape[:2]

    mask = np.zeros(
        (h, w),
        dtype=np.uint8,
    )

    x1 = int(w * 0.08)
    x2 = int(w * 0.92)

    y1 = int(h * 0.15)
    y2 = int(h * 0.82)

    mask[
        y1:y2,
        x1:x2
    ] = 255

    mask[
        int(h * 0.72):,
        :
    ] = 0

    mask = cv2.GaussianBlur(
        mask,
        (0, 0),
        2,
    )

    return Image.fromarray(mask)


def _hex_to_rgb(
    color_hex: str,
) -> np.ndarray:

    color_hex = color_hex.strip().lstrip("#")

    if len(color_hex) != 6:
        raise ValueError(
            "Color must be a 6-digit hexadecimal value."
        )

    try:
        return np.array(
            [
                int(color_hex[0:2], 16),
                int(color_hex[2:4], 16),
                int(color_hex[4:6], 16),
            ],
            dtype=np.float32,
        )

    except ValueError:
        raise ValueError(
            "Color contains invalid hexadecimal characters."
        )


def _srgb_to_linear(
    rgb: np.ndarray,
) -> np.ndarray:

    rgb = rgb / 255.0

    return np.where(
        rgb <= 0.04045,
        rgb / 12.92,
        (
            (rgb + 0.055)
            / 1.055
        ) ** 2.4,
    )


def _linear_to_srgb(
    rgb: np.ndarray,
) -> np.ndarray:

    rgb = np.clip(
        rgb,
        0.0,
        1.0,
    )

    return np.where(
        rgb <= 0.0031308,
        rgb * 12.92,
        1.055
        * np.power(
            rgb,
            1.0 / 2.4,
        )
        - 0.055,
    )


def apply_paint_color(
    image: Image.Image,
    mask: np.ndarray,
    color_hex: str,
) -> Image.Image:
    """
    Recolor a selected surface using a target
    company shade while preserving the original
    surface's lighting, shadows and texture.

    The important difference from the previous
    implementation is that we DON'T simply keep
    the original LAB lightness.

    Instead:

        original wall
              ↓
        estimate illumination
              ↓
        target company color
              ↓
        apply illumination to target
              ↓
        preserve shadows / highlights / texture
    """

    # --------------------------------------------------
    # Original image
    # --------------------------------------------------

    original = np.array(
        image.convert("RGB"),
        dtype=np.float32,
    )

    height, width = original.shape[:2]

    # --------------------------------------------------
    # Validate mask
    # --------------------------------------------------

    if mask.shape[:2] != (
        height,
        width,
    ):
        raise ValueError(
            "Mask dimensions do not match image dimensions."
        )

    mask_float = (
        mask.astype(np.float32)
        / 255.0
    )

    # --------------------------------------------------
    # Smooth segmentation boundary
    # --------------------------------------------------

    mask_float = cv2.GaussianBlur(
        mask_float,
        (0, 0),
        1.2,
    )

    mask_float = np.clip(
        mask_float,
        0.0,
        1.0,
    )

    # --------------------------------------------------
    # Target company shade
    # --------------------------------------------------

    target_rgb = _hex_to_rgb(
        color_hex
    )

    # --------------------------------------------------
    # Convert target to linear RGB
    #
    # We work in linear light so that
    # brightness adjustments behave more
    # naturally than direct 8-bit RGB.
    # --------------------------------------------------

    target_linear = _srgb_to_linear(
        target_rgb
    )

    # --------------------------------------------------
    # Original image in linear RGB
    # --------------------------------------------------

    original_linear = _srgb_to_linear(
        original
    )

    # --------------------------------------------------
    # Estimate original surface luminance
    # --------------------------------------------------

    original_luminance = (
        0.2126
        * original_linear[:, :, 0]
        + 0.7152
        * original_linear[:, :, 1]
        + 0.0722
        * original_linear[:, :, 2]
    )

    # --------------------------------------------------
    # Find pixels belonging strongly to the surface.
    #
    # We use the core of the mask rather than the
    # soft boundary because segmentation edges can
    # contain pixels from surrounding objects.
    # --------------------------------------------------

    core = mask_float > 0.65

    surface_values = (
        original_luminance[core]
    )

    if surface_values.size < 100:
        # Fallback if the selected region is very small.
        surface_values = (
            original_luminance[
                mask_float > 0.25
            ]
        )

    if surface_values.size == 0:
        raise ValueError(
            "Selected surface contains no usable pixels."
        )

    # --------------------------------------------------
    # Estimate the normal/base illumination of
    # the surface.
    #
    # A high percentile approximates the normally
    # illuminated portion without letting a few
    # extreme highlights dominate.
    # --------------------------------------------------

    base_luminance = float(
        np.percentile(
            surface_values,
            85,
        )
    )

    base_luminance = max(
        base_luminance,
        0.05,
    )

    # --------------------------------------------------
    # Illumination map
    #
    # Example:
    #
    # original wall luminance = 0.80
    # base wall luminance     = 0.90
    #
    # illumination = 0.89
    #
    # This means the target paint receives
    # approximately 89% of its normal brightness.
    # --------------------------------------------------

    illumination = (
        original_luminance
        / base_luminance
    )

    # --------------------------------------------------
    # Prevent extreme lighting from completely
    # destroying the target company shade.
    #
    # Shadows can darken the paint substantially,
    # while highlights can brighten it.
    # --------------------------------------------------

    illumination = np.clip(
        illumination,
        0.35,
        1.35,
    )

    # --------------------------------------------------
    # Apply illumination to target shade
    # --------------------------------------------------

    painted_linear = (
        target_linear[None, None, :]
        * illumination[:, :, None]
    )

    # --------------------------------------------------
    # Preserve some local surface texture.
    #
    # High-frequency luminance information from the
    # original surface is retained subtly.
    # --------------------------------------------------

    gray = cv2.cvtColor(
        original.astype(np.uint8),
        cv2.COLOR_RGB2GRAY,
    ).astype(np.float32) / 255.0

    smooth_gray = cv2.GaussianBlur(
        gray,
        (0, 0),
        3.0,
    )

    texture = (
        gray
        - smooth_gray
    )

    # Keep texture subtle.
    texture_strength = 0.10

    texture_multiplier = (
        1.0
        + texture
        * texture_strength
    )

    painted_linear *= (
        texture_multiplier[:, :, None]
    )

    # --------------------------------------------------
    # Convert back to sRGB
    # --------------------------------------------------

    painted_rgb = (
        _linear_to_srgb(
            painted_linear
        )
        * 255.0
    )

    painted_rgb = np.clip(
        painted_rgb,
        0,
        255,
    )

    # --------------------------------------------------
    # Blend with original image using segmentation mask
    # --------------------------------------------------

    mask_3d = (
        mask_float[:, :, None]
    )

    result = (
        original
        * (1.0 - mask_3d)
        +
        painted_rgb
        * mask_3d
    )

    result = np.clip(
        result,
        0,
        255,
    ).astype(np.uint8)

    return Image.fromarray(
        result
    )