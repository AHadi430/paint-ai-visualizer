from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image


class RenderService:

    @staticmethod
    def hex_to_rgb(hex_color: str) -> np.ndarray:
        value = hex_color.strip().lstrip("#")

        if len(value) != 6:
            raise ValueError(f"Invalid color: {hex_color}")

        try:
            return np.array(
                [
                    int(value[0:2], 16),
                    int(value[2:4], 16),
                    int(value[4:6], 16),
                ],
                dtype=np.float32,
            )
        except ValueError:
            raise ValueError(f"Invalid color: {hex_color}")

    @staticmethod
    def soften_mask(mask: np.ndarray) -> np.ndarray:
        """
        Slightly feather the segmentation boundary.
        Keeps the effect inside the selected surface.
        """

        mask = mask.astype(np.uint8) * 255

        # Small morphological cleanup
        kernel = np.ones((3, 3), np.uint8)

        mask = cv2.morphologyEx(
            mask,
            cv2.MORPH_OPEN,
            kernel,
        )

        mask = cv2.morphologyEx(
            mask,
            cv2.MORPH_CLOSE,
            kernel,
        )

        # Very small blur for natural boundaries
        mask = cv2.GaussianBlur(
            mask,
            (5, 5),
            0,
        )

        return mask.astype(np.float32) / 255.0

    @staticmethod
    def recolor_surface(
        original_rgb: np.ndarray,
        mask: np.ndarray,
        target_rgb: np.ndarray,
    ) -> np.ndarray:
        """
        Paint only the selected mask.

        The original image remains untouched outside
        the mask.

        Lighting and texture are preserved using the
        original surface luminance.
        """

        image = original_rgb.astype(np.float32) / 255.0
        target = target_rgb.astype(np.float32) / 255.0

        # Original luminance
        luminance = (
            0.2126 * image[:, :, 0]
            + 0.7152 * image[:, :, 1]
            + 0.0722 * image[:, :, 2]
        )

        # Estimate the base surface brightness.
        # Using a percentile avoids windows/highlights
        # dominating the result.
        surface_pixels = luminance[mask > 0.05]

        if surface_pixels.size < 100:
            return original_rgb.copy()

        base_luminance = np.percentile(
            surface_pixels,
            70,
        )

        if base_luminance <= 0.01:
            return original_rgb.copy()

        illumination = (
            luminance / base_luminance
        )

        # Prevent extreme highlights/shadows from
        # destroying the selected paint color.
        illumination = np.clip(
            illumination,
            0.45,
            1.45,
        )

        # Apply target paint while preserving
        # illumination.
        painted = (
            target[None, None, :]
            * illumination[:, :, None]
        )

        painted = np.clip(
            painted,
            0.0,
            1.0,
        )

        # Preserve some original micro texture.
        gray = cv2.cvtColor(
            image,
            cv2.COLOR_RGB2GRAY,
        )

        texture = (
            gray - cv2.GaussianBlur(
                gray,
                (0, 0),
                2.0,
            )
        )

        painted += (
            texture[:, :, None] * 0.18
        )

        painted = np.clip(
            painted,
            0.0,
            1.0,
        )

        alpha = mask[:, :, None]

        result = (
            image * (1.0 - alpha)
            + painted * alpha
        )

        return (
            np.clip(
                result * 255.0,
                0,
                255,
            )
            .astype(np.uint8)
        )

    def render(
        self,
        image_path: str,
        surfaces: list[dict[str, Any]],
        output_path: str,
    ) -> None:

        original = np.array(
            Image.open(image_path).convert("RGB")
        )

        result = original.copy()

        for surface in surfaces:

            mask_path = surface.get("mask_path")
            color = surface.get("color")

            if not mask_path or not color:
                continue

            if not Path(mask_path).exists():
                continue

            mask_image = np.array(
                Image.open(mask_path)
                .convert("L")
            )

            if mask_image.shape[:2] != result.shape[:2]:
                mask_image = cv2.resize(
                    mask_image,
                    (
                        result.shape[1],
                        result.shape[0],
                    ),
                    interpolation=cv2.INTER_NEAREST,
                )

            mask = mask_image.astype(
                np.float32
            ) / 255.0

            # Safety: never paint the entire image.
            # Close-up wall photos can legitimately
            # cover most of the frame.
            coverage = float(
                np.mean(mask > 0.5)
            )

            if coverage > 0.98:
                continue

            mask = self.soften_mask(
                mask > 0.35
            )

            target_rgb = self.hex_to_rgb(
                color
            )

            result = self.recolor_surface(
                result,
                mask,
                target_rgb,
            )

        Image.fromarray(result).save(
            output_path,
            quality=95,
        )


render_service = RenderService()