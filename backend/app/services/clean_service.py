import math
import threading
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import torch
from PIL import Image

from ..ai.architectural_map import (
    architectural_map_service,
)
from ..ai.sam import sam_service


BASE_DIR = Path(__file__).resolve().parents[3]

# LaMa (Large Mask inpainting), TorchScript export.
# https://github.com/enesmsahin/simple-lama-inpainting
LAMA_CHECKPOINT = (
    BASE_DIR
    / "models"
    / "big-lama.pt"
)

LAMA_URL = (
    "https://github.com/enesmsahin/"
    "simple-lama-inpainting/releases/download/"
    "v0.1.0/big-lama.pt"
)


# ---------------------------------------------------------
# Things that are not part of the architecture and
# should disappear from a clean render.
# ---------------------------------------------------------

# Grounding DINO scores drop as the prompt gets longer,
# so the classes are queried in small groups.
CLUTTER_GROUPS = {
    "vehicles": [
        "motorcycle",
        "bicycle",
        "car",
        "truck",
        "rickshaw",
    ],
    "people and animals": [
        "person",
        "dog",
        "cat",
        "cow",
        "goat",
    ],
    "poles": [
        "utility pole",
        "electric pole",
        "concrete pole",
        "street lamp",
    ],
    "loose objects": [
        "cot",
        "wooden bed",
        "bench",
        "chair",
        "trash can",
        "bucket",
    ],
}


class CleanService:
    """
    Produces a "clean render" of a photo: vehicles,
    people, poles, overhead wires and loose objects are
    removed and the background is reconstructed, so
    only the architecture remains.
    """

    def __init__(self):

        self._lama = None
        self._lama_device = None
        self._lock = threading.Lock()

    # -----------------------------------------------------
    # LaMa model
    # -----------------------------------------------------

    def _load_lama(self):

        if self._lama is not None:
            return

        if not LAMA_CHECKPOINT.exists():
            raise RuntimeError(
                "Inpainting model not found at "
                f"{LAMA_CHECKPOINT}. Download it with:\n"
                f"curl -L -o {LAMA_CHECKPOINT} {LAMA_URL}"
            )

        # On Apple Silicon MPS is ~30x faster than the
        # CPU for LaMa (about 2s vs 60s at 1600px).
        if torch.cuda.is_available():
            device = "cuda"
        elif torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"

        print(
            f"Loading LaMa inpainting on {device}..."
        )

        model = torch.jit.load(
            str(LAMA_CHECKPOINT),
            map_location=device,
        )

        model.eval()

        self._lama = model
        self._lama_device = device

        print(
            "LaMa loaded successfully."
        )

    def inpaint(
        self,
        image_rgb: np.ndarray,
        mask: np.ndarray,
        max_side: int = 1600,
    ) -> np.ndarray:
        """
        Fill the masked pixels with plausible background.
        Pixels outside the mask are returned unchanged.
        """

        if not mask.any():
            return image_rgb.copy()

        # Small edits (e.g. a few brush strokes) only need
        # the surrounding region, which is much faster
        # than inpainting the whole photo.
        height, width = image_rgb.shape[:2]

        ys, xs = np.nonzero(mask)

        box_w = xs.max() - xs.min() + 1
        box_h = ys.max() - ys.min() + 1

        margin = max(
            64,
            int(max(box_w, box_h) * 0.25),
        )

        x1 = max(0, xs.min() - margin)
        y1 = max(0, ys.min() - margin)
        x2 = min(width, xs.max() + 1 + margin)
        y2 = min(height, ys.max() + 1 + margin)

        if (x2 - x1) * (y2 - y1) < 0.6 * width * height:

            result = image_rgb.copy()

            result[y1:y2, x1:x2] = self._inpaint_full(
                image_rgb[y1:y2, x1:x2],
                mask[y1:y2, x1:x2],
                max_side,
            )

            return result

        return self._inpaint_full(
            image_rgb,
            mask,
            max_side,
        )

    def _run_lama(
        self,
        image: torch.Tensor,
        mask: torch.Tensor,
    ) -> torch.Tensor:

        with torch.inference_mode():

            try:
                output = self._lama(
                    image.to(self._lama_device),
                    mask.to(self._lama_device),
                )

                if not torch.isfinite(output).all():
                    raise RuntimeError(
                        "non-finite output"
                    )

                return output

            except Exception as exc:

                if self._lama_device == "cpu":
                    raise

                print(
                    f"LaMa failed on {self._lama_device} "
                    f"({exc}); falling back to CPU."
                )

                self._lama = self._lama.to("cpu")
                self._lama_device = "cpu"

                return self._lama(
                    image,
                    mask,
                )

    def _inpaint_full(
        self,
        image_rgb: np.ndarray,
        mask: np.ndarray,
        max_side: int,
    ) -> np.ndarray:

        with self._lock:

            self._load_lama()

            height, width = image_rgb.shape[:2]

            scale = min(
                1.0,
                max_side / max(height, width),
            )

            work_w = int(round(width * scale))
            work_h = int(round(height * scale))

            work_image = cv2.resize(
                image_rgb,
                (work_w, work_h),
                interpolation=cv2.INTER_AREA,
            ) if scale < 1.0 else image_rgb

            work_mask = cv2.resize(
                mask.astype(np.uint8),
                (work_w, work_h),
                interpolation=cv2.INTER_NEAREST,
            ) if scale < 1.0 else mask.astype(np.uint8)

            # LaMa needs sides divisible by 8.
            pad_h = (8 - work_h % 8) % 8
            pad_w = (8 - work_w % 8) % 8

            padded_image = np.pad(
                work_image,
                ((0, pad_h), (0, pad_w), (0, 0)),
                mode="symmetric",
            )

            padded_mask = np.pad(
                work_mask,
                ((0, pad_h), (0, pad_w)),
                mode="symmetric",
            )

            image_tensor = (
                torch.from_numpy(padded_image)
                .permute(2, 0, 1)
                .unsqueeze(0)
                .float()
                / 255.0
            )

            mask_tensor = (
                torch.from_numpy(
                    (padded_mask > 0).astype(np.float32)
                )
                .unsqueeze(0)
                .unsqueeze(0)
            )

            output = self._run_lama(
                image_tensor,
                mask_tensor,
            )

            result = (
                output[0]
                .permute(1, 2, 0)
                .cpu()
                .numpy()
            )

        result = np.clip(
            result * 255.0,
            0,
            255,
        ).astype(np.uint8)[:work_h, :work_w]

        if scale < 1.0:
            result = cv2.resize(
                result,
                (width, height),
                interpolation=cv2.INTER_CUBIC,
            )

        # Only replace the masked pixels, with a soft
        # edge, so the rest of the photo keeps its
        # full original detail.
        alpha = cv2.GaussianBlur(
            mask.astype(np.float32),
            (0, 0),
            1.5,
        )

        alpha = np.maximum(
            alpha,
            mask.astype(np.float32),
        )[:, :, None]

        blended = (
            image_rgb.astype(np.float32) * (1.0 - alpha)
            + result.astype(np.float32) * alpha
        )

        return np.clip(
            blended,
            0,
            255,
        ).astype(np.uint8)

    # -----------------------------------------------------
    # Detection
    # -----------------------------------------------------

    @staticmethod
    def _sky_mask(
        image_rgb: np.ndarray,
    ) -> np.ndarray:
        """
        Bright, low-texture area connected to the top of
        the photo. Used to tell overhead wires (which run
        through the sky) apart from architectural lines.
        """

        height, width = image_rgb.shape[:2]

        gray = cv2.cvtColor(
            image_rgb,
            cv2.COLOR_RGB2GRAY,
        )

        hsv = cv2.cvtColor(
            image_rgb,
            cv2.COLOR_RGB2HSV,
        )

        # Remove thin dark lines (the wires themselves)
        # before judging brightness and texture.
        closed = cv2.morphologyEx(
            gray,
            cv2.MORPH_CLOSE,
            cv2.getStructuringElement(
                cv2.MORPH_ELLIPSE,
                (15, 15),
            ),
        )

        blur = cv2.GaussianBlur(
            closed.astype(np.float32),
            (0, 0),
            5,
        )

        variance = cv2.GaussianBlur(
            (closed.astype(np.float32) - blur) ** 2,
            (0, 0),
            5,
        )

        # Clear or overcast sky: bright and flat, or
        # distinctly blue.
        candidate = (
            (
                (closed > 170)
                | (
                    (hsv[:, :, 0] > 90)
                    & (hsv[:, :, 0] < 130)
                    & (hsv[:, :, 1] > 60)
                    & (hsv[:, :, 2] > 120)
                )
            )
            & (variance < 60)
        ).astype(np.uint8)

        count, labels = cv2.connectedComponents(
            candidate,
            connectivity=4,
        )

        top_labels = set(
            np.unique(labels[0, :]).tolist()
        ) - {0}

        sky = np.isin(
            labels,
            list(top_labels),
        )

        # Sky rarely extends into the lower part of a
        # street photo.
        sky[int(height * 0.75):, :] = False

        return sky

    @staticmethod
    def detect_wires(
        image_rgb: np.ndarray,
    ) -> np.ndarray:
        """
        Overhead power / telephone lines.

        Wires are long, thin, dark lines with plain
        background on both sides that pass through the
        sky. Architectural lines (railings, gate slats,
        stair edges, tile joints) either don't reach the
        sky or sit inside dense texture, so they are kept.
        """

        height, width = image_rgb.shape[:2]
        longest = max(height, width)

        gray = cv2.cvtColor(
            image_rgb,
            cv2.COLOR_RGB2GRAY,
        )

        # Dark features thinner than the kernel.
        kernel_size = max(
            9,
            int(longest * 0.011) | 1,
        )

        blackhat = cv2.morphologyEx(
            gray,
            cv2.MORPH_BLACKHAT,
            cv2.getStructuringElement(
                cv2.MORPH_ELLIPSE,
                (kernel_size, kernel_size),
            ),
        )

        thin = (blackhat > 30).astype(np.uint8)

        sky = CleanService._sky_mask(image_rgb)

        min_length = int(longest * 0.15)

        lines = cv2.HoughLinesP(
            thin * 255,
            1,
            np.pi / 720,
            threshold=int(min_length * 0.5),
            minLineLength=min_length,
            maxLineGap=int(longest * 0.01),
        )

        band = np.zeros(
            (height, width),
            dtype=np.uint8,
        )

        if lines is None:
            return band.astype(bool)

        core = int(longest * 0.002) + 2
        side_near = int(longest * 0.004) + 3
        side_far = int(longest * 0.009) + 6
        window = max(15, int(longest * 0.012))
        min_run = int(longest * 0.03)
        min_sky_run = int(longest * 0.06)

        for x1, y1, x2, y2 in lines[:, 0]:

            length = int(
                math.hypot(x2 - x1, y2 - y1)
            )

            if length < 2:
                continue

            ux = (x2 - x1) / length
            uy = (y2 - y1) / length
            nx, ny = -uy, ux

            steps = np.arange(length + 1)
            px = x1 + ux * steps
            py = y1 + uy * steps

            def sample(source, offset):
                xs = np.clip(
                    np.round(px + nx * offset).astype(int),
                    0,
                    width - 1,
                )
                ys = np.clip(
                    np.round(py + ny * offset).astype(int),
                    0,
                    height - 1,
                )
                return source[ys, xs]

            on_line = np.max(
                [
                    sample(thin, offset)
                    for offset in range(-core, core + 1)
                ],
                axis=0,
            )

            # How busy the surroundings are. A wire has
            # plain background beside it; texture does not.
            beside = np.mean(
                [
                    sample(thin, sign * offset)
                    for offset in range(side_near, side_far + 1)
                    for sign in (-1, 1)
                ],
                axis=0,
            )

            beside = np.convolve(
                beside,
                np.ones(window) / window,
                mode="same",
            )

            good = (on_line > 0) & (beside < 0.18)

            # -------------------------------------------
            # Anchor: only accept lines that are clearly
            # wires somewhere along their length.
            #
            # 1. They run through open sky, or
            # 2. they are long, isolated lines in the upper
            #    part of the photo that leave the frame
            #    (wires come from outside the picture;
            #    architectural lines end at the building).
            # -------------------------------------------

            in_sky = good & (sample(sky, 0) > 0)

            sky_run = np.convolve(
                in_sky.astype(float),
                np.ones(min_sky_run),
                mode="same",
            ).max()

            border = int(longest * 0.03)

            touches_border = any(
                x < border
                or x > width - 1 - border
                for x in (x1, x2)
            )

            leaves_frame = (
                touches_border
                and length > width * 0.35
                and max(y1, y2) < height * 0.75
                and good.mean() > 0.5
            )

            if sky_run < min_sky_run * 0.8 and not leaves_frame:
                continue

            # Once a line is confirmed as a wire, follow it
            # across the facade too: the isolation test is
            # no longer needed, only the dark line itself.
            good = np.convolve(
                (on_line > 0).astype(float),
                np.ones(int(longest * 0.01) | 1),
                mode="same",
            ) > 0

            edges = np.flatnonzero(
                np.diff(
                    np.concatenate(
                        [[0], good.astype(int), [0]]
                    )
                )
            )

            for start, end in zip(
                edges[::2],
                edges[1::2],
            ):
                if end - start < min_run:
                    continue

                cv2.line(
                    band,
                    (int(px[start]), int(py[start])),
                    (int(px[end - 1]), int(py[end - 1])),
                    1,
                    2 * core + 3,
                )

        wires = cv2.dilate(
            band & thin,
            np.ones((3, 3), np.uint8),
            iterations=2,
        )

        return wires.astype(bool)

    @staticmethod
    def detect_objects(
        image_path: str,
        image: Image.Image,
    ) -> tuple[np.ndarray, list[str]]:
        """
        Vehicles, people, animals, poles and loose
        furniture, segmented precisely with SAM 2.
        """

        width, height = image.size
        image_area = width * height

        detections = []

        for group_name, classes in CLUTTER_GROUPS.items():
            for detection in architectural_map_service._detect(
                image,
                classes,
                threshold=0.28,
                text_threshold=0.25,
            ):
                # Report the group rather than the raw
                # label, which is often a mix of classes.
                detection["group"] = group_name
                detections.append(detection)

        combined = np.zeros(
            (height, width),
            dtype=bool,
        )

        removed = []

        for detection in detections:

            try:
                mask, _ = sam_service.segment_from_box(
                    image_path,
                    detection["box"],
                )

            except Exception as exc:
                print(
                    "Clutter mask failed:",
                    exc,
                )
                continue

            area_ratio = float(mask.sum()) / image_area

            # A huge mask means the detector confused
            # part of the building with an object.
            if area_ratio > 0.25 or area_ratio < 0.0005:
                continue

            combined |= mask
            removed.append(detection["group"])

        return combined, removed

    # -----------------------------------------------------
    # Public API
    # -----------------------------------------------------

    def clean(
        self,
        image_path: str,
        output_path: str,
        auto: bool = True,
        extra_mask: np.ndarray | None = None,
    ) -> dict[str, Any]:

        image = Image.open(
            image_path
        ).convert("RGB")

        image_rgb = np.array(image)

        height, width = image_rgb.shape[:2]
        longest = max(height, width)

        removal = np.zeros(
            (height, width),
            dtype=bool,
        )

        removed: list[str] = []

        if auto:

            objects, labels = self.detect_objects(
                image_path,
                image,
            )

            if objects.any():
                # Grow the masks to include soft edges and
                # contact shadows.
                grow = max(3, int(longest * 0.008))

                objects = cv2.dilate(
                    objects.astype(np.uint8),
                    cv2.getStructuringElement(
                        cv2.MORPH_ELLIPSE,
                        (2 * grow + 1, 2 * grow + 1),
                    ),
                ).astype(bool)

                removal |= objects
                removed.extend(sorted(set(labels)))

            wires = self.detect_wires(image_rgb)

            if wires.any():
                removal |= wires
                removed.append("overhead wires")

        if extra_mask is not None:
            removal |= extra_mask.astype(bool)

        result = self.inpaint(
            image_rgb,
            removal,
        )

        Image.fromarray(result).save(
            output_path,
            "JPEG",
            quality=95,
        )

        return {
            "removed": removed,
            "removed_ratio": float(removal.mean()),
            "mask": removal,
        }


clean_service = CleanService()
