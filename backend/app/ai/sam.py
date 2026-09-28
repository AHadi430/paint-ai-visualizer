import threading
from pathlib import Path

import numpy as np
import torch
from PIL import Image

from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor


BASE_DIR = Path(__file__).resolve().parents[3]

CHECKPOINT = (
    BASE_DIR
    / "models"
    / "sam2.1_hiera_small.pt"
)

# SAM 2 configuration shipped with the installed package
MODEL_CONFIG = (
    "configs/sam2.1/sam2.1_hiera_s.yaml"
)


class SAMService:

    def __init__(self):

        self.device = self._get_device()

        print(
            f"Loading SAM 2 on {self.device}..."
        )

        self.model = build_sam2(
            MODEL_CONFIG,
            str(CHECKPOINT),
            device=self.device,
        )

        self.predictor = (
            SAM2ImagePredictor(
                self.model
            )
        )

        # The predictor holds one image embedding at a
        # time and is shared by every request, so
        # set_image + predict must run atomically.
        self.lock = threading.RLock()

        # Cache key of the image currently embedded.
        # Computing the embedding is the expensive part,
        # so it is only redone when the image changes.
        self._image_key = None
        self._image_size = (0, 0)

        print(
            "SAM 2 loaded successfully."
        )

    @staticmethod
    def _get_device():

        if torch.backends.mps.is_available():
            return "mps"

        if torch.cuda.is_available():
            return "cuda"

        return "cpu"

    def set_image(
        self,
        image_path: str,
    ):

        path = Path(image_path)

        key = (
            str(path.resolve()),
            path.stat().st_mtime_ns,
        )

        with self.lock:

            if key == self._image_key:
                return

            image = (
                Image.open(
                    image_path
                ).convert("RGB")
            )

            self.predictor.set_image(
                np.array(image)
            )

            self._image_key = key
            self._image_size = image.size

    def box_candidates(
        self,
        image_path: str,
        box: list[float],
    ):
        """
        Returns all three SAM candidate masks for a
        box prompt, with their scores.
        """

        with self.lock:

            self.set_image(
                image_path
            )

            masks, scores, _ = (
                self.predictor.predict(
                    box=np.array(
                        box,
                        dtype=np.float32,
                    ),
                    multimask_output=True,
                )
            )

        return (
            masks.astype(bool),
            scores,
        )

    def segment_from_box(
        self,
        image_path: str,
        box: list[float],
    ):

        with self.lock:

            self.set_image(
                image_path
            )

            # A box prompt is unambiguous, so SAM 2
            # recommends a single mask output here.
            # multimask_output=True tends to return
            # small sub-parts inside the box.
            masks, scores, _ = (
                self.predictor.predict(
                    box=np.array(
                        box,
                        dtype=np.float32,
                    ),
                    multimask_output=False,
                )
            )

        return (
            masks[0].astype(bool),
            float(
                scores[0]
            ),
        )

    def segment_from_point(
        self,
        image_path: str,
        x: float,
        y: float,
    ):

        point_coords = np.array(
            [[x, y]],
            dtype=np.float32,
        )

        point_labels = np.array(
            [1],
            dtype=np.int32,
        )

        with self.lock:

            self.set_image(
                image_path
            )

            width, height = (
                self._image_size
            )

            masks, scores, _ = (
                self.predictor.predict(
                    point_coords=point_coords,
                    point_labels=point_labels,
                    multimask_output=True,
                )
            )

        image_area = (
            width * height
        )

        candidates = []

        # -------------------------------------------------
        # Evaluate every SAM candidate
        # -------------------------------------------------

        for index, mask in enumerate(
            masks
        ):

            mask_bool = (
                mask.astype(bool)
            )

            area = float(
                np.sum(mask_bool)
            )

            if area <= 0:
                continue

            area_ratio = (
                area / image_area
            )

            # The selected point must actually
            # belong to the candidate mask.
            px = int(
                max(
                    0,
                    min(
                        width - 1,
                        round(x),
                    ),
                )
            )

            py = int(
                max(
                    0,
                    min(
                        height - 1,
                        round(y),
                    ),
                )
            )

            if not mask_bool[py, px]:
                continue

            candidates.append(
                {
                    "index": index,
                    "mask": mask_bool,
                    "sam_score": float(
                        scores[index]
                    ),
                    "area_ratio": area_ratio,
                }
            )

        if not candidates:
            raise ValueError(
                "SAM did not produce a valid surface."
            )

        # -------------------------------------------------
        # Reject obviously catastrophic masks.
        # -------------------------------------------------

        usable = [
            candidate
            for candidate in candidates
            if candidate["area_ratio"] < 0.55
        ]

        if usable:
            candidates = usable

        # -------------------------------------------------
        # Prefer a reasonably sized local surface.
        #
        # We don't simply choose the smallest mask
        # because that can produce tiny fragments.
        # -------------------------------------------------

        def candidate_score(candidate):

            sam_score = (
                candidate["sam_score"]
            )

            area_ratio = (
                candidate["area_ratio"]
            )

            # Strong penalty for enormous regions.
            if area_ratio > 0.35:

                area_penalty = 0.25

            elif area_ratio > 0.20:

                area_penalty = 0.50

            elif area_ratio > 0.08:

                area_penalty = 0.85

            else:

                area_penalty = 1.0

            return (
                sam_score
                * area_penalty
            )

        best = max(
            candidates,
            key=candidate_score,
        )

        return (
            best["mask"],
            best["sam_score"],
        )


sam_service = SAMService()
