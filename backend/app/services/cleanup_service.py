import time
from pathlib import Path


def delete_old_files(
    directories: list[str],
    max_age_days: int,
) -> int:
    """
    Delete files older than max_age_days from the given
    directories (not recursive, hidden files are kept).

    Every upload, clean render and paint job writes new
    images, so without this uploads/ and outputs/ grow
    forever.
    """

    if max_age_days <= 0:
        return 0

    cutoff = time.time() - max_age_days * 86400
    removed = 0

    for directory in directories:

        folder = Path(directory)

        if not folder.is_dir():
            continue

        for path in folder.iterdir():

            if not path.is_file() or path.name.startswith("."):
                continue

            try:
                if path.stat().st_mtime < cutoff:
                    path.unlink()
                    removed += 1

            except FileNotFoundError:
                # Removed by a concurrent request.
                pass

    return removed
