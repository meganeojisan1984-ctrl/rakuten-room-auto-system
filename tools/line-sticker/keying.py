"""Green-screen keying tuned for flat cartoon sticker art.

The LINE review rejects artwork that contains transparent areas *inside* the
illustration, so every region enclosed by the opaque body is forced back to
fully opaque here.
"""
import subprocess

import numpy as np
from scipy import ndimage

# Anything greener than SOLID_BG is background; anything below KEEP is kept.
KEEP = 18.0
SOLID_BG = 0.86  # fraction of the measured backdrop greenness


def read_frames(path, first, count, size):
    """Decode `count` frames starting at `first` as (n, h, w, 3) uint8 RGB."""
    w, h = size
    cmd = ["ffmpeg", "-v", "error", "-i", path,
           "-vf", f"select='between(n\\,{first}\\,{first + count - 1})'",
           "-vsync", "0", "-pix_fmt", "rgb24",
           "-sws_flags", "bicubic+full_chroma_int+accurate_rnd",
           "-f", "rawvideo", "-"]
    buf = subprocess.run(cmd, capture_output=True, check=True).stdout
    n = len(buf) // (w * h * 3)
    return np.frombuffer(buf, np.uint8)[:n * w * h * 3].reshape(n, h, w, 3)


def greenness(rgb):
    """How green a pixel is relative to its strongest other channel."""
    f = rgb.astype(np.float32)
    return f[..., 1] - np.maximum(f[..., 0], f[..., 2])


def backdrop_colour(rgb):
    """Median colour of the frame border, used as the key colour."""
    ring = np.concatenate([
        rgb[:8].reshape(-1, 3), rgb[-8:].reshape(-1, 3),
        rgb[:, :8].reshape(-1, 3), rgb[:, -8:].reshape(-1, 3)])
    return np.median(ring, axis=0).astype(np.float32)


def key_frame(rgb):
    """Chroma key one RGB frame -> (h, w, 4) uint8 RGBA, straight alpha."""
    bg = backdrop_colour(rgb)
    bg_g = max(float(bg[1] - max(bg[0], bg[2])), 40.0)
    g = greenness(rgb)

    # Linear key: greenness scales with how much backdrop shows through.
    hi = bg_g * SOLID_BG
    alpha = np.clip((hi - g) / max(hi - KEEP, 1.0), 0.0, 1.0)

    # Un-premultiply against the backdrop so anti-aliased edges lose their
    # green fringe instead of just fading it out.
    obs = rgb.astype(np.float32)
    safe = np.maximum(alpha, 1e-3)[..., None]
    fg = (obs - (1.0 - alpha)[..., None] * bg[None, None, :]) / safe
    fg = np.clip(fg, 0, 255)
    fg = np.where(alpha[..., None] > 0.995, obs, fg)

    # Despill: no part of this character is green, so cap the green channel.
    cap = np.maximum(fg[..., 0], fg[..., 2])
    spill = fg[..., 1] > cap
    fg[..., 1] = np.where(spill, cap, fg[..., 1])

    out = np.empty(rgb.shape[:2] + (4,), np.uint8)
    out[..., :3] = fg.round().astype(np.uint8)
    out[..., 3] = (alpha * 255).round().astype(np.uint8)
    return out


def seal_interior(rgba, fill=(255, 255, 255)):
    """Close every transparent pocket enclosed by the artwork.

    Returns (rgba, sealed_pixel_count). Anti-aliasing on the outer silhouette
    is left alone -- only pockets that cannot reach the canvas edge are filled.
    """
    a = rgba[..., 3]
    core = a >= 250
    if not core.any():
        return rgba, 0
    solid = ndimage.binary_fill_holes(core)
    pockets = solid & ~core
    n = int(pockets.sum())
    if n:
        rgba[..., 3][pockets] = 255
        # Pocket pixels hold leftover backdrop colour; repaint them with the
        # white outline colour that surrounds the artwork.
        rgba[..., :3][pockets] = np.array(fill, np.uint8)
    # Speckles of near-zero alpha read as noise to the reviewer; flatten them.
    faint = (a > 0) & (a < 8)
    rgba[..., 3][faint] = 0
    return rgba, n


def clean_specks(rgba, min_area=24):
    """Drop stray opaque islands left behind by compression noise."""
    mask = rgba[..., 3] >= 128
    lab, n = ndimage.label(mask)
    if n <= 1:
        return rgba
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes >= max(min_area, sizes.max() * 0.002)
    drop = ~keep[lab] & mask
    rgba[..., 3][drop] = 0
    return rgba
