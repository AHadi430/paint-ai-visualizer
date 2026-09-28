from pathlib import Path
from typing import Any
import cv2
import numpy as np
import torch
from PIL import Image, ImageDraw

from transformers import (
    AutoProcessor,
    AutoModelForZeroShotObjectDetection,
)

from .sam import sam_service


MODEL_ID = "IDEA-Research/grounding-dino-tiny"


# ---------------------------------------------------------
# Objects that we WANT to identify as paintable.
# ---------------------------------------------------------

PAINTABLE_CLASSES = [
    "exterior wall",
    "wall",
    "building wall",
    "building facade",
    "facade",
    "facade section",

    "column",
    "pillar",
    "exterior column",
    "exterior pillar",

    "balcony wall",
    "balcony",
    "balcony facade",

    "parapet wall",
    "parapet",

    "front wall",
    "side wall",
    "upper wall",
    "lower wall",

    "accent wall",
    "architectural wall",
]


# ---------------------------------------------------------
# Objects that must NOT accidentally get painted.
# ---------------------------------------------------------

PROTECTED_CLASSES = [
    "window",
    "glass window",
    "door",
    "doorway",
    "garage door",
    "gate",
    "glass",
    "railing",
    "metal railing",
    "person",
    "car",
    "motorcycle",
    "tree",
    "plant",
    "wire",
]


class ArchitecturalMapService:

    def __init__(self):

        self.device = self._get_device()

        print(
            f"Loading Grounding DINO on {self.device}..."
        )

        self.processor = (
            AutoProcessor.from_pretrained(
                MODEL_ID
            )
        )

        self.model = (
            AutoModelForZeroShotObjectDetection
            .from_pretrained(MODEL_ID)
            .to(self.device)
        )

        self.model.eval()

        print(
            "Grounding DINO loaded successfully."
        )

        # Share the single SAM 2 instance instead of
        # loading a second copy of the model.
        self.sam = sam_service


    @staticmethod
    def _get_device():

        if torch.backends.mps.is_available():
            return torch.device("mps")

        if torch.cuda.is_available():
            return torch.device("cuda")

        return torch.device("cpu")


    def _detect(
        self,
        image: Image.Image,
        labels: list[str],
        threshold: float = 0.30,
        text_threshold: float = 0.25,
    ) -> list[dict[str, Any]]:

        # Grounding DINO expects text labels.
        text_labels = [
            labels
        ]

        inputs = self.processor(
            images=image,
            text=text_labels,
            return_tensors="pt",
        )

        inputs = {
            key: value.to(self.device)
            if hasattr(value, "to")
            else value
            for key, value in inputs.items()
        }

        with torch.inference_mode():

            outputs = self.model(
                **inputs
            )

        results = (
            self.processor
            .post_process_grounded_object_detection(
                outputs,
                inputs["input_ids"],
                threshold=threshold,
                text_threshold=text_threshold,
                target_sizes=[
                    image.size[::-1]
                ],
            )
        )

        result = results[0]

        detections = []

        for box, score, label in zip(
            result["boxes"],
            result["scores"],
            result["text_labels"],
        ):

            detections.append(
                {
                    "box": [
                        float(x)
                        for x in box.tolist()
                    ],
                    "score": float(
                        score.item()
                    ),
                    "label": str(label),
                }
            )

        return detections


    def _mask_from_box(
        self,
        image_path: str,
        box: list[float],
    ):

        mask, score = (
            self.sam.segment_from_box(
                image_path,
                box,
            )
        )

        return mask, score


    @staticmethod
    def _remove_small_components(
        mask: np.ndarray,
        min_area: int = 500,
    ) -> np.ndarray:

        mask_uint8 = (
            mask.astype(np.uint8)
            * 255
        )

        num_labels, labels, stats, _ = (
            cv2.connectedComponentsWithStats(
                mask_uint8,
                connectivity=8,
            )
        )

        cleaned = np.zeros_like(
            mask_uint8
        )

        for label_id in range(
            1,
            num_labels,
        ):

            area = stats[
                label_id,
                cv2.CC_STAT_AREA,
            ]

            if area >= min_area:

                cleaned[
                    labels == label_id
                ] = 255

        return (
            cleaned > 0
        )


    def analyze(
        self,
        image_path: str,
    ) -> dict[str, Any]:

        image = (
            Image.open(
                image_path
            )
            .convert("RGB")
        )

        # -------------------------------------------------
        # 1. Detect protected regions FIRST.
        # -------------------------------------------------

        protected_detections = (
            self._detect(
                image,
                PROTECTED_CLASSES,
                threshold=0.28,
                text_threshold=0.22,
            )
        )

        # -------------------------------------------------
        # 2. Detect paintable architectural regions.
        # -------------------------------------------------

        paintable_detections = (
            self._detect(
                image,
                PAINTABLE_CLASSES,
                threshold=0.28,
                text_threshold=0.22,
            )
        )

        protected_masks = []

        for detection in (
            protected_detections
        ):

            try:

                mask, score = (
                    self._mask_from_box(
                        image_path,
                        detection["box"],
                    )
                )

                protected_masks.append(
                    mask
                )

            except Exception as exc:

                print(
                    "Protected mask failed:",
                    exc,
                )


        # -------------------------------------------------
        # Combine all protected masks.
        # -------------------------------------------------

        height = image.height
        width = image.width

        protected_union = np.zeros(
            (height, width),
            dtype=bool,
        )

        for mask in protected_masks:

            protected_union |= (
                mask.astype(bool)
            )


        surfaces = []


        # -------------------------------------------------
        # Convert each paintable detection to a SAM mask.
        # -------------------------------------------------

        for index, detection in enumerate(
            paintable_detections
        ):

            try:

                mask, sam_score = (
                    self._mask_from_box(
                        image_path,
                        detection["box"],
                    )
                )

                mask = mask.astype(
                    bool
                )

                # -----------------------------------------
                # IMPORTANT:
                # Remove windows, doors, glass, gates,
                # railings, cars, wires, etc.
                # -----------------------------------------

                mask[
                    protected_union
                ] = False

                # -----------------------------------------
                # Remove tiny fragments.
                # -----------------------------------------

                mask = (
                    self._remove_small_components(
                        mask,
                        min_area=800,
                    )
                )

                area = int(
                    mask.sum()
                )

                if area < 800:
                    continue

                surface_id = (
                    f"surface_{index + 1}"
                )

                surfaces.append(
                    {
                        "id": surface_id,
                        "type": detection["label"],
                        "score": float(
                            min(
                                detection["score"],
                                sam_score,
                            )
                        ),
                        "box": detection["box"],
                        "mask": mask,
                    }
                )

            except Exception as exc:

                print(
                    "Paintable mask failed:",
                    exc,
                )


        return {
            "width": width,
            "height": height,
            "surfaces": surfaces,
            "protected_count": len(
                protected_masks
            ),
        }


    @staticmethod
    def create_map_image(
        image: Image.Image,
        surfaces: list[dict[str, Any]],
    ) -> Image.Image:

        """
        Creates a debug visualization.

        This is ONLY a visualization.
        It is NOT used for final painting.
        """

        base = image.convert(
            "RGBA"
        )

        overlay = Image.new(
            "RGBA",
            base.size,
            (0, 0, 0, 0),
        )

        draw = ImageDraw.Draw(
            overlay
        )

        # Different visualization color
        # for each surface.

        colors = [
            (40, 180, 99, 130),
            (52, 152, 219, 130),
            (155, 89, 182, 130),
            (241, 196, 15, 130),
            (230, 126, 34, 130),
            (231, 76, 60, 130),
        ]

        for index, surface in enumerate(
            surfaces
        ):

            mask = surface["mask"]

            color = colors[
                index % len(colors)
            ]

            rgba_mask = np.zeros(
                (
                    mask.shape[0],
                    mask.shape[1],
                    4,
                ),
                dtype=np.uint8,
            )

            rgba_mask[
                mask
            ] = color

            mask_image = Image.fromarray(
                rgba_mask,
                "RGBA",
            )

            overlay = Image.alpha_composite(
                overlay,
                mask_image,
            )

            # Draw bounding box.

            x1, y1, x2, y2 = (
                surface["box"]
            )

            draw.rectangle(
                [
                    x1,
                    y1,
                    x2,
                    y2,
                ],
                outline=color[:3] + (220,),
                width=3,
            )

            draw.text(
                (
                    x1 + 5,
                    y1 + 5,
                ),
                surface["id"],
                fill=(255, 255, 255, 255),
            )


        return Image.alpha_composite(
            base,
            overlay,
        ).convert("RGB")


architectural_map_service = (
    ArchitecturalMapService()
)