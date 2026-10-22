"""
Per-visitor usage limits for when the backend is reachable from the
internet (e.g. through a Cloudflare Tunnel), so nobody can overload
this computer.

Visitors are told apart by the IP address Cloudflare reports in the
CF-Connecting-IP header. Requests without it come from this computer
or its network and are not limited.
"""

import threading
import time
from collections import defaultdict, deque

# The heavy AI steps: a new photo, wall detection, clean-up.
HEAVY_PATHS = (
    "/api/visualizer/upload",
    "/api/visualizer/analyze",
    "/api/visualizer/clean",
)


class RateLimiter:

    def __init__(
        self,
        per_minute: int,
        heavy_per_10_minutes: int,
    ):
        self.limits = {
            # (window seconds, max requests)
            "all": (60, per_minute),
            "heavy": (600, heavy_per_10_minutes),
        }
        self._hits: dict[tuple[str, str], deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, client: str, path: str) -> int | None:
        """
        Record a request. Returns None if allowed, otherwise the
        number of seconds until the visitor may try again.
        """

        buckets = ["all"]

        if path.startswith(HEAVY_PATHS):
            buckets.append("heavy")

        now = time.monotonic()

        with self._lock:

            for bucket in buckets:
                window, limit = self.limits[bucket]
                hits = self._hits[(client, bucket)]

                while hits and hits[0] <= now - window:
                    hits.popleft()

                if len(hits) >= limit:
                    return int(hits[0] + window - now) + 1

            for bucket in buckets:
                self._hits[(client, bucket)].append(now)

            # Forget visitors who have been quiet for a while.
            if len(self._hits) > 5000:
                for key in [
                    key
                    for key, hits in self._hits.items()
                    if not hits or hits[-1] <= now - 600
                ]:
                    del self._hits[key]

        return None
