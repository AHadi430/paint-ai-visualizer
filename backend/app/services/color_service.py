"""
Colour science for the colour picker: converting between sRGB and
CIE Lab, measuring how different two colours look (CIEDE2000),
describing a colour in words and matching it to the shade card.
"""

import math

import numpy as np

# D65 reference white, matching sRGB.
_WHITE = np.array([95.047, 100.0, 108.883])

_RGB_TO_XYZ = np.array(
    [
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ]
)

_XYZ_TO_RGB = np.linalg.inv(_RGB_TO_XYZ)


def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """sRGB values 0-255, shape (..., 3), to CIE Lab (D65)."""

    c = np.asarray(rgb, dtype=np.float64) / 255.0

    linear = np.where(
        c <= 0.04045,
        c / 12.92,
        ((c + 0.055) / 1.055) ** 2.4,
    )

    xyz = linear @ _RGB_TO_XYZ.T * 100.0 / _WHITE

    f = np.where(
        xyz > (6 / 29) ** 3,
        np.cbrt(xyz),
        xyz / (3 * (6 / 29) ** 2) + 4 / 29,
    )

    return np.stack(
        [
            116 * f[..., 1] - 16,
            500 * (f[..., 0] - f[..., 1]),
            200 * (f[..., 1] - f[..., 2]),
        ],
        axis=-1,
    )


def lab_to_rgb(lab: np.ndarray) -> np.ndarray:
    """CIE Lab to sRGB 0-255 (clipped to the sRGB gamut)."""

    lab = np.asarray(lab, dtype=np.float64)

    fy = (lab[..., 0] + 16) / 116
    fx = fy + lab[..., 1] / 500
    fz = fy - lab[..., 2] / 200

    f = np.stack([fx, fy, fz], axis=-1)

    xyz = np.where(
        f > 6 / 29,
        f ** 3,
        3 * (6 / 29) ** 2 * (f - 4 / 29),
    ) * _WHITE / 100.0

    linear = np.clip(xyz @ _XYZ_TO_RGB.T, 0.0, 1.0)

    c = np.where(
        linear <= 0.0031308,
        linear * 12.92,
        1.055 * linear ** (1 / 2.4) - 0.055,
    )

    return np.clip(np.round(c * 255.0), 0, 255)


def hex_to_rgb(value: str) -> np.ndarray:

    value = value.strip().lstrip("#")

    return np.array(
        [int(value[i:i + 2], 16) for i in (0, 2, 4)],
        dtype=np.float64,
    )


def rgb_to_hex(rgb) -> str:

    return "#" + "".join(
        f"{int(round(v)):02X}" for v in rgb
    )


def delta_e_2000(lab1: np.ndarray, lab2: np.ndarray) -> np.ndarray:
    """
    CIEDE2000 colour difference (Sharma, Wu & Dalal, 2005).
    About 1 is the smallest difference most people notice;
    under 2 is a very close match for paint.
    """

    lab1 = np.asarray(lab1, dtype=np.float64)
    lab2 = np.asarray(lab2, dtype=np.float64)

    L1, a1, b1 = lab1[..., 0], lab1[..., 1], lab1[..., 2]
    L2, a2, b2 = lab2[..., 0], lab2[..., 1], lab2[..., 2]

    c_bar = (np.hypot(a1, b1) + np.hypot(a2, b2)) / 2
    g = 0.5 * (1 - np.sqrt(c_bar ** 7 / (c_bar ** 7 + 25 ** 7)))

    a1p = (1 + g) * a1
    a2p = (1 + g) * a2

    c1p = np.hypot(a1p, b1)
    c2p = np.hypot(a2p, b2)

    h1p = np.degrees(np.arctan2(b1, a1p)) % 360
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360

    chroma_zero = (c1p * c2p) == 0

    dh = h2p - h1p
    dh = np.where(dh > 180, dh - 360, dh)
    dh = np.where(dh < -180, dh + 360, dh)
    dh = np.where(chroma_zero, 0, dh)

    dL = L2 - L1
    dC = c2p - c1p
    dH = 2 * np.sqrt(c1p * c2p) * np.sin(np.radians(dh / 2))

    L_bar = (L1 + L2) / 2
    c_bar_p = (c1p + c2p) / 2

    h_sum = h1p + h2p
    h_bar = np.where(
        np.abs(h1p - h2p) <= 180,
        h_sum / 2,
        np.where(h_sum < 360, (h_sum + 360) / 2, (h_sum - 360) / 2),
    )
    h_bar = np.where(chroma_zero, h_sum, h_bar)

    t = (
        1
        - 0.17 * np.cos(np.radians(h_bar - 30))
        + 0.24 * np.cos(np.radians(2 * h_bar))
        + 0.32 * np.cos(np.radians(3 * h_bar + 6))
        - 0.20 * np.cos(np.radians(4 * h_bar - 63))
    )

    d_theta = 30 * np.exp(-(((h_bar - 275) / 25) ** 2))
    r_c = 2 * np.sqrt(c_bar_p ** 7 / (c_bar_p ** 7 + 25 ** 7))

    s_l = 1 + 0.015 * (L_bar - 50) ** 2 / np.sqrt(20 + (L_bar - 50) ** 2)
    s_c = 1 + 0.045 * c_bar_p
    s_h = 1 + 0.015 * c_bar_p * t

    r_t = -np.sin(np.radians(2 * d_theta)) * r_c

    return np.sqrt(
        (dL / s_l) ** 2
        + (dC / s_c) ** 2
        + (dH / s_h) ** 2
        + r_t * (dC / s_c) * (dH / s_h)
    )


# ---------------------------------------------------------
# Describing a colour in words
# ---------------------------------------------------------

def _hue_name(hue: float, lightness: float, chroma: float) -> tuple[str, str]:
    """(name, family) for a chromatic colour from its Lab hue angle."""

    if hue >= 345 or hue < 25:
        return ("Pink", "Pinks") if lightness > 65 else ("Rose", "Reds & Oranges")

    if hue < 50:
        if lightness < 40:
            return "Maroon", "Reds & Oranges"
        if lightness > 72:
            return "Blush", "Pinks"
        return "Red", "Reds & Oranges"

    if hue < 75:
        if chroma < 30 and lightness < 55:
            return "Brown", "Browns"
        if chroma < 30:
            return "Peach", "Reds & Oranges"
        return ("Terracotta", "Reds & Oranges") if lightness < 60 else ("Orange", "Reds & Oranges")

    if hue < 100:
        if lightness < 50:
            return "Brown", "Browns"
        if chroma < 30:
            return ("Beige", "Neutrals") if lightness > 70 else ("Tan", "Browns")
        return "Mustard", "Yellows"

    if hue < 125:
        if lightness < 55:
            return "Olive", "Greens"
        return ("Cream", "Neutrals") if chroma < 30 else ("Yellow", "Yellows")

    if hue < 165:
        if chroma < 25:
            return "Sage", "Greens"
        return "Green", "Greens"

    if hue < 215:
        return "Teal", "Blues"

    if hue < 290:
        return "Blue", "Blues"

    if hue < 320:
        return ("Lavender", "Purples") if lightness > 65 else ("Violet", "Purples")

    return ("Lilac", "Purples") if lightness > 65 else ("Purple", "Purples")


def describe_lab(lab) -> dict:
    """
    A plain-language description, e.g. "Light Beige", with the
    colour family, warm/cool temperature and lightness.
    """

    lightness, a, b = (float(v) for v in lab)
    chroma = math.hypot(a, b)
    hue = math.degrees(math.atan2(b, a)) % 360

    if chroma < 6:
        # Whites, greys and blacks, with a hint of warmth.
        if lightness > 92:
            base = "White"
        elif lightness > 80:
            base = "Off-White"
        elif lightness > 62:
            base = "Light Grey"
        elif lightness > 42:
            base = "Grey"
        elif lightness > 22:
            base = "Charcoal"
        else:
            base = "Black"

        tint = (
            "Warm "
            if chroma > 2.5 and b > 0
            else "Cool "
            if chroma > 2.5 and b < 0
            else ""
        )

        name = tint + base
        family = "Whites" if lightness > 80 else "Neutrals"

    else:
        base, family = _hue_name(hue, lightness, chroma)

        if lightness > 82:
            tone = "Pale "
        elif lightness > 67:
            tone = "Light "
        elif lightness < 30:
            tone = "Deep "
        elif lightness < 45:
            tone = "Dark "
        else:
            tone = ""

        if chroma < 15:
            mood = "Muted "
        elif chroma > 55:
            mood = "Vivid "
        else:
            mood = ""

        name = f"{tone}{mood}{base}"

    if chroma < 6:
        temperature = (
            "Warm" if chroma > 2.5 and b > 0
            else "Cool" if chroma > 2.5 and b < 0
            else "Neutral"
        )
    elif hue < 110 or hue >= 330:
        temperature = "Warm"
    elif 150 <= hue < 300:
        temperature = "Cool"
    else:
        temperature = "Neutral"

    # Same thresholds as the "Light"/"Dark" words in the name.
    level = (
        "Light" if lightness > 67
        else "Medium" if lightness >= 45
        else "Dark"
    )

    return {
        "name": name,
        "family": family,
        "temperature": temperature,
        "lightness": level,
    }


# ---------------------------------------------------------
# Matching to the shade card
# ---------------------------------------------------------

def match_label(delta_e: float) -> str:

    if delta_e < 2:
        return "Excellent match"
    if delta_e < 5:
        return "Very close"
    if delta_e < 10:
        return "Similar"
    return "Nearest available"


def closest_shades(lab, shades: list[dict], count: int = 3) -> list[dict]:
    """The shade-card entries that look most like `lab`."""

    if not shades:
        return []

    shade_labs = rgb_to_lab(
        np.array([hex_to_rgb(shade["hex"]) for shade in shades])
    )

    distances = delta_e_2000(
        np.broadcast_to(np.asarray(lab, dtype=np.float64), shade_labs.shape),
        shade_labs,
    )

    results = []

    for index in np.argsort(distances)[:count]:
        shade = shades[int(index)]
        delta = float(distances[index])

        results.append(
            {
                **shade,
                "delta_e": round(delta, 1),
                "match": match_label(delta),
            }
        )

    return results


def color_report(lab, shades: list[dict]) -> dict:
    """Everything the colour picker shows for one colour."""

    lab = np.asarray(lab, dtype=np.float64)
    rgb = lab_to_rgb(lab)

    return {
        "hex": rgb_to_hex(rgb),
        "rgb": [int(v) for v in rgb],
        "lab": [round(float(v), 1) for v in lab],
        **describe_lab(lab),
        "matches": closest_shades(lab, shades),
    }


def representative_lab(pixels_rgb: np.ndarray) -> tuple[np.ndarray, float]:
    """
    The typical colour of a set of pixels (e.g. one wall), and how
    much the lighting varies across them.

    The darkest and brightest pixels (shadows, highlights, fixtures)
    are dropped before taking the median, so the result reflects
    the surface itself.
    """

    lab = rgb_to_lab(pixels_rgb.reshape(-1, 3))

    lightness = lab[:, 0]
    low, high = np.percentile(lightness, [20, 90])

    kept = lab[(lightness >= low) & (lightness <= high)]

    if len(kept) < 10:
        kept = lab

    return np.median(kept, axis=0), float(np.std(kept[:, 0]))


def dominant_colors(
    image_rgb: np.ndarray,
    max_colors: int = 5,
    min_share: float = 0.04,
) -> list[tuple[np.ndarray, float]]:
    """
    The main colours of a photo as (lab, share of the photo), most
    common first. Visually near-identical clusters are merged.
    """

    import cv2

    height, width = image_rgb.shape[:2]
    scale = 160 / max(height, width)

    small = cv2.resize(
        image_rgb,
        (max(1, int(width * scale)), max(1, int(height * scale))),
        interpolation=cv2.INTER_AREA,
    )

    lab = rgb_to_lab(small.reshape(-1, 3)).astype(np.float32)

    criteria = (
        cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER,
        30,
        0.5,
    )

    # Fixed seed so the same photo gives the same palette.
    cv2.setRNGSeed(7)

    _, labels, centers = cv2.kmeans(
        lab, 8, None, criteria, 3, cv2.KMEANS_PP_CENTERS
    )

    shares = np.bincount(labels.flatten(), minlength=len(centers)) / len(labels)

    merged: list[list] = []

    for index in np.argsort(-shares):
        center = centers[index].astype(np.float64)

        for entry in merged:
            if delta_e_2000(entry[0], center) < 8:
                entry[1] += shares[index]
                break
        else:
            merged.append([center, float(shares[index])])

    return [
        (center, share)
        for center, share in merged
        if share >= min_share
    ][:max_colors]
