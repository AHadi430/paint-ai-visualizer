from pathlib import Path

from PIL import Image

from app.ai.sam import sam_service


IMAGE = Path("../test_room.jpg")

if not IMAGE.exists():
    raise FileNotFoundError(
        f"Put a test image at {IMAGE.resolve()}"
    )

image = Image.open(IMAGE)

print("Image size:", image.size)

# Temporary test point.
# Change these coordinates to a point INSIDE a wall.
x = image.width // 2
y = image.height // 2

mask, score = sam_service.segment_from_point(
    str(IMAGE),
    x,
    y,
)

print("Mask shape:", mask.shape)
print("Mask pixels:", mask.sum())
print("Confidence:", score)