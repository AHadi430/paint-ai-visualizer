from pathlib import Path

import numpy as np
import torch
from PIL import Image

from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor

from .device_lock import inference_lock


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
        # set_image + predict must run atomically. The
        # lock is shared with the other models because
        # MPS cannot run two threads' work at once.
        self.lock = inference_lock

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

    def point_candidates(
        self,
        image_path: str,
        x: float,
        y: float,
    ):
        """
        SAM's three candidate masks for a tap, roughly a
        small part, a larger section and the whole object,
        with their scores.
        """

        with self.lock:

            self.set_image(
                image_path
            )

            masks, scores, _ = (
                self.predictor.predict(
                    point_coords=np.array(
                        [[x, y]],
                        dtype=np.float32,
                    ),
                    point_labels=np.array(
                        [1],
                        dtype=np.int32,
                    ),
                    multimask_output=True,
                )
            )

        return (
            masks.astype(bool),
            scores,
        )

    def segment_at(
        self,
        image_path: str,
        x: float,
        y: float,
        within: np.ndarray | None = None,
        level: int | None = None,
    ):
        """
        The surface under a tap.

        SAM offers areas of different sizes for a tap.
        They are listed smallest first ("levels"), and
        `level` picks one; by default the most likely.

        With `within` (the mask of a surface the tap is
        on, e.g. a whole facade), only parts of that
        surface clearly smaller than it are offered: the
        frame, beam or panel under the finger.

        Returns (mask, score, level, number of levels).
        """

        masks, scores = self.point_candidates(
            image_path,
            x,
            y,
        )

        height, width = masks.shape[1:]
        image_area = width * height

        px = int(max(0, min(width - 1, round(x))))
        py = int(max(0, min(height - 1, round(y))))

        levels = []

        for mask, score in zip(masks, scores):

            if within is not None:

                mask = mask & within

            # The tapped point must belong to the area.
            if not mask[py, px]:
                continue

            area = float(mask.sum())

            if within is not None and (
                area < image_area * 0.001
                or area > within.sum() * 0.7
            ):
                continue

            # SAM sometimes offers the same area twice.
            if any(
                self._iou(mask, kept["mask"]) > 0.9
                for kept in levels
            ):
                continue

            levels.append(
                {
                    "mask": mask,
                    "sam_score": float(score),
                    "area_ratio": area / image_area,
                }
            )

        if not levels:
            raise ValueError(
                "SAM did not produce a valid surface."
            )

        levels.sort(
            key=lambda item: item["area_ratio"]
        )

        if level is None:

            level = (
                # A part of a surface: SAM's most
                # confident part.
                max(
                    range(len(levels)),
                    key=lambda index: levels[index]["sam_score"],
                )
                if within is not None
                else self._best_surface_level(levels)
            )

        level = max(0, min(len(levels) - 1, level))
        chosen = levels[level]

        return (
            chosen["mask"],
            chosen["sam_score"],
            level,
            len(levels),
        )

    @staticmethod
    def _iou(a: np.ndarray, b: np.ndarray) -> float:

        union = np.logical_or(a, b).sum()

        return float(np.logical_and(a, b).sum() / union) if union else 0.0

    @staticmethod
    def _best_surface_level(levels: list[dict]) -> int:
        """
        The most likely whole surface for a tap on a
        part of the photo no surface covers yet.
        """

        # Reject obviously catastrophic masks.
        usable = [
            index
            for index, item in enumerate(levels)
            if item["area_ratio"] < 0.55
        ] or list(range(len(levels)))

        # Prefer a reasonably sized local surface. We
        # don't simply choose the smallest mask because
        # that can produce tiny fragments.
        def candidate_score(index):

            area_ratio = levels[index]["area_ratio"]

            # Strong penalty for enormous regions.
            if area_ratio > 0.35:
                area_penalty = 0.25
            elif area_ratio > 0.20:
                area_penalty = 0.50
            elif area_ratio > 0.08:
                area_penalty = 0.85
            # Slivers and specks: people tap to paint a
            # surface, so a whole wall beats a fragment.
            elif area_ratio < 0.003:
                area_penalty = 0.3
            elif area_ratio < 0.01:
                area_penalty = 0.6
            else:
                area_penalty = 1.0

            return levels[index]["sam_score"] * area_penalty

        return max(usable, key=candidate_score)

    def segment_from_point(
        self,
        image_path: str,
        x: float,
        y: float,
    ):

        mask, score, _, _ = self.segment_at(
            image_path,
            x,
            y,
        )

        return mask, score


sam_service = SAMService()
