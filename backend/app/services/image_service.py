from pathlib import Path
from uuid import uuid4
from io import BytesIO

from PIL import Image, ImageOps


ALLOWED = {
    "image/jpeg",
    "image/png",
    "image/webp",
}


def save_upload(
    data: bytes,
    filename: str,
    upload_dir: str,
    max_side: int = 2400,
) -> tuple[str, Image.Image]:

    Path(upload_dir).mkdir(
        parents=True,
        exist_ok=True,
    )

    image = Image.open(
        BytesIO(data)
    )

    # Phone cameras store pixels sideways plus an EXIF
    # "rotate me" flag. Apply it, because the flag is
    # lost when the image is re-saved below.
    image = ImageOps.exif_transpose(
        image
    ).convert("RGB")

    image.thumbnail(
        (max_side, max_side),
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

