from pathlib import Path

import cv2
import numpy as np


class PaintablePreviewService:

    def create_preview(
        self,
        image_path: str,
        output_path: str,
    ) -> str:
        """
        Creates a geometry-preserving visual simplification
        of the original photograph.

        IMPORTANT:
        - Same width
        - Same height
        - Same perspective
        - Same pixel coordinates

        The preview is used only for selection.
        Final painting is always performed on the original.
        """

        image = cv2.imread(
            image_path,
            cv2.IMREAD_COLOR,
        )

        if image is None:
            raise ValueError(
                f"Could not read image: {image_path}"
            )

        # --------------------------------------------------
        # 1. Preserve the original dimensions
        # --------------------------------------------------

        original_height, original_width = image.shape[:2]

        # --------------------------------------------------
        # 2. Edge-preserving smoothing
        #
        # This removes small texture/noise while keeping
        # architectural boundaries.
        # --------------------------------------------------

        smooth = cv2.bilateralFilter(
            image,
            d=9,
            sigmaColor=60,
            sigmaSpace=60,
        )

        # --------------------------------------------------
        # 3. Stronger architectural simplification
        # --------------------------------------------------

        smooth = cv2.bilateralFilter(
            smooth,
            d=7,
            sigmaColor=45,
            sigmaSpace=45,
        )

        # --------------------------------------------------
        # 4. Slight color quantisation
        #
        # This makes large surfaces visually flatter and
        # easier for the user to distinguish.
        # --------------------------------------------------

        data = smooth.reshape(
            (-1, 3)
        ).astype(
            np.float32
        )

        # Compact color palette using k-means.
        # Keeping this relatively small makes the preview
        # look more like a clean architectural visualization.
        k = 12

        criteria = (
            cv2.TERM_CRITERIA_EPS
            + cv2.TERM_CRITERIA_MAX_ITER,
            20,
            1.0,
        )

        _, labels, centers = cv2.kmeans(
            data,
            k,
            None,
            criteria,
            2,
            cv2.KMEANS_PP_CENTERS,
        )

        quantized = centers[
            labels.flatten()
        ].reshape(
            smooth.shape
        )

        quantized = np.clip(
            quantized,
            0,
            255,
        ).astype(
            np.uint8
        )

        # --------------------------------------------------
        # 5. Architectural edge extraction
        # --------------------------------------------------

        gray = cv2.cvtColor(
            quantized,
            cv2.COLOR_BGR2GRAY,
        )

        edges = cv2.Canny(
            gray,
            60,
            140,
        )

        # Slightly thicken architectural boundaries.
        kernel = np.ones(
            (2, 2),
            np.uint8,
        )

        edges = cv2.dilate(
            edges,
            kernel,
            iterations=1,
        )

        # --------------------------------------------------
        # 6. Convert edges into subtle dark boundaries
        # --------------------------------------------------

        edge_overlay = np.zeros_like(
            quantized
        )

        edge_overlay[
            edges > 0
        ] = (
            35,
            35,
            35,
        )

        preview = cv2.addWeighted(
            quantized,
            0.94,
            edge_overlay,
            0.06,
            0,
        )

        # --------------------------------------------------
        # 7. Preserve exact dimensions
        # --------------------------------------------------

        if (
            preview.shape[1] != original_width
            or preview.shape[0] != original_height
        ):
            preview = cv2.resize(
                preview,
                (
                    original_width,
                    original_height,
                ),
                interpolation=cv2.INTER_LINEAR,
            )

        # --------------------------------------------------
        # 8. Save
        # --------------------------------------------------

        output = Path(
            output_path
        )

        output.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        success = cv2.imwrite(
            str(output),
            preview,
            [
                cv2.IMWRITE_PNG_COMPRESSION,
                3,
            ],
        )

        if not success:
            raise ValueError(
                "Could not save paintable preview."
            )

        return str(output)


paintable_preview_service = (
    PaintablePreviewService()
)