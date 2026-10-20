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

from .device_lock import inference_lock
from .sam import sam_service
from ..services.mask_refine import refine_mask


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

    "interior wall",
    "ceiling",
]


# Grounding DINO scores drop when the prompt lists many classes, so
# surfaces are detected in small groups (indoor rooms were often missed
# entirely with one long prompt).
PAINTABLE_GROUPS = [
    ["wall", "interior wall", "exterior wall", "building facade"],
    ["ceiling"],
    ["column", "pillar"],
    ["balcony wall", "parapet wall"],
]


# ---------------------------------------------------------
# Objects that must NOT accidentally get painted.
# ---------------------------------------------------------

PROTECTED_GROUPS = [
    ["window", "glass window", "door", "doorway", "garage door", "gate"],
    ["railing", "radiator", "air conditioner", "lamp", "wire"],
    ["person", "car", "motorcycle", "tree", "plant"],
    ["sofa", "bed", "cabinet", "shelf", "television", "picture frame"],
]

PROTECTED_CLASSES = [
    name for group in PROTECTED_GROUPS for name in group
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

        with inference_lock, torch.inference_mode():

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
    def _clean_label(
        label: str,
        classes: list[str],
    ) -> str:
        """
        Grounding DINO can merge several matched phrases
        into one label, e.g. "wall wall lower wall".
        Keep the most specific class it contains.
        """

        matches = [
            name
            for name in classes
            if name in label
        ]

        if not matches:
            return label.strip()

        return max(
            matches,
            key=len,
        )


    @staticmethod
    def _iou(a: np.ndarray, b: np.ndarray) -> float:

        union = np.logical_or(a, b).sum()

        return float(np.logical_and(a, b).sum() / union) if union else 0.0


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

        protected_detections = [
            detection
            for group in PROTECTED_GROUPS
            for detection in self._detect(
                image,
                group,
                threshold=0.28,
                text_threshold=0.22,
            )
        ]

        # -------------------------------------------------
        # 2. Detect paintable architectural regions. Groups
        #    are handled in order (walls first), most
        #    confident first within a group, so a wall that
        #    the "column" prompt also matched is named a wall.
        # -------------------------------------------------

        paintable_detections = [
            detection
            for group in PAINTABLE_GROUPS
            for detection in sorted(
                self._detect(
                    image,
                    group,
                    threshold=0.27,
                    text_threshold=0.22,
                ),
                key=lambda detection: -detection["score"],
            )
        ]

        image_rgb = np.array(image)
        image_area = image.width * image.height

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

                # A huge "window" mask is a detection error;
                # it would wipe out most of the walls.
                if mask.mean() <= 0.25:
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

        for detection in paintable_detections:

            # A box around (almost) the whole photo is the
            # detector naming the entire room, not one wall.
            x1, y1, x2, y2 = detection["box"]

            if (x2 - x1) * (y2 - y1) > image_area * 0.85:
                continue

            try:

                mask, sam_score = (
                    self._mask_from_box(
                        image_path,
                        detection["box"],
                    )
                )

                mask = refine_mask(
                    mask,
                    image_rgb,
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

                min_area = max(800, int(image_area * 0.005))

                mask = (
                    self._remove_small_components(
                        mask,
                        min_area=min_area,
                    )
                )

                area = int(
                    mask.sum()
                )

                if area < min_area or area > image_area * 0.7:
                    continue

                # Several prompts often find the same wall.
                if any(
                    self._iou(mask, kept["mask"]) > 0.6
                    for kept in surfaces
                ):
                    continue

                surface_id = (
                    f"surface_{len(surfaces) + 1}"
                )

                surfaces.append(
                    {
                        "id": surface_id,
                        "type": self._clean_label(
                            detection["label"],
                            PAINTABLE_CLASSES,
                        ),
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