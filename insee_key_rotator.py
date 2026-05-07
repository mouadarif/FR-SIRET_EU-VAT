"""
insee_key_rotator.py — Round-robin INSEE API key selector + global rate limiter.

Usage
-----
from insee_key_rotator import get_next_insee_key, throttle_insee

key = get_next_insee_key()   # next key in the rotation (1→2→…→10→1→…)
throttle_insee()             # block if needed to stay ≤ 290 calls/min globally

Override the rate via .env:
    INSEE_GLOBAL_CALLS_PER_MINUTE=290
"""
from __future__ import annotations

import os
import time

from dotenv import load_dotenv

load_dotenv()

# ─── Key dictionary  (index 1-10 → env var name → resolved value) ───────────
_KEY_MAP: dict[int, str] = {
    1:  "VITE_INSEE_API_KEY",
    2:  "VITE_INSEE_API_KEY2",
    3:  "VITE_INSEE_API_KEY3",
    4:  "VITE_INSEE_API_KEY4",
    5:  "VITE_INSEE_API_KEY5",
    6:  "VITE_INSEE_API_KEY6",
    7:  "VITE_INSEE_API_KEY7",
    8:  "VITE_INSEE_API_KEY8",
    9:  "VITE_INSEE_API_KEY9",
    10: "VITE_INSEE_API_KEY10",
}

KEYS: dict[int, str] = {
    idx: (os.environ.get(name) or "")
    for idx, name in _KEY_MAP.items()
}

# ─── Rotating index  (1 → 2 → … → 10 → 1 → …) ──────────────────────────────
_index: int = 1


def get_next_insee_key() -> str:
    """Return the API key for the current index, then advance the index.

    Rotation rule:
        if _index < 10  →  _index += 1
        else            →  _index = 1
    """
    global _index
    key = KEYS.get(_index, "")
    _index = _index + 1 if _index < 10 else 1
    return key


# ─── Global rate limiter (all keys combined) ─────────────────────────────────
def _parse_float(name: str, default: float) -> float:
    v = os.environ.get(name)
    if not v:
        return default
    try:
        return float(v)
    except ValueError:
        return default


INSEE_GLOBAL_CPM: float = _parse_float("INSEE_GLOBAL_CALLS_PER_MINUTE", 290.0)

_last_call_ts: float = 0.0


def throttle_insee() -> None:
    """Block just long enough to keep global INSEE throughput ≤ INSEE_GLOBAL_CPM.

    Formula: minimum gap between consecutive calls = 60 / CPM seconds.
    With 290 CPM the gap is ≈ 0.207 s — much faster than the old 2.5 s/call.
    """
    global _last_call_ts
    if INSEE_GLOBAL_CPM <= 0:
        return
    gap = 60.0 / INSEE_GLOBAL_CPM
    now = time.monotonic()
    wait = gap - (now - _last_call_ts)
    if wait > 0:
        time.sleep(wait)
    _last_call_ts = time.monotonic()


# ─── Helpers ─────────────────────────────────────────────────────────────────
def active_keys() -> list[str]:
    """Return only keys that are actually configured (non-empty)."""
    return [v for v in KEYS.values() if v]


def current_index() -> int:
    """Return current index (useful for logging / tests)."""
    return _index
