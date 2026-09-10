"""Minimal APNG encoder with frame-region optimization and palette support.

Written for LINE animation sticker output: exact loop durations via the
fcTL delay_num/delay_den fraction, and per-frame diff rectangles to keep
files under the 300KB limit.
"""
import struct
import zlib

import numpy as np

SIG = b"\x89PNG\r\n\x1a\n"

DISPOSE_NONE = 0
BLEND_SOURCE = 0


def _chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def _filter_rows(raw, bpp):
    """Adaptive PNG filtering (minimum sum of absolute differences)."""
    h, stride = raw.shape
    out = bytearray()
    prev = np.zeros(stride, np.uint8)
    for y in range(h):
        cur = raw[y]
        a = np.zeros(stride, np.uint8)
        a[bpp:] = cur[:-bpp]
        b = prev
        c = np.zeros(stride, np.uint8)
        c[bpp:] = prev[:-bpp]
        cand = [
            (0, cur),
            (1, (cur.astype(np.int16) - a) % 256),
            (2, (cur.astype(np.int16) - b) % 256),
            (3, (cur.astype(np.int16) - ((a.astype(np.int16) + b) >> 1)) % 256),
        ]
        p = a.astype(np.int16) + b.astype(np.int16) - c.astype(np.int16)
        pa, pb, pc = np.abs(p - a), np.abs(p - b), np.abs(p - c)
        pred = np.where((pa <= pb) & (pa <= pc), a, np.where(pb <= pc, b, c))
        cand.append((4, (cur.astype(np.int16) - pred) % 256))
        best = min(cand, key=lambda kv: int(
            np.minimum(kv[1].astype(np.uint8), 256 - kv[1].astype(np.int16)).sum()))
        out.append(best[0])
        out += bytes(best[1].astype(np.uint8))
        prev = cur
    return bytes(out)


def _deflate(data):
    best = None
    for strategy in (zlib.Z_DEFAULT_STRATEGY, zlib.Z_FILTERED, zlib.Z_RLE):
        co = zlib.compressobj(9, zlib.DEFLATED, 15, 9, strategy)
        out = co.compress(data) + co.flush()
        if best is None or len(out) < len(best):
            best = out
    return best


def _encode(arr, bpp):
    """arr: (h, w, bpp) uint8 -> compressed IDAT payload."""
    h, w = arr.shape[:2]
    raw = arr.reshape(h, w * bpp)
    return _deflate(_filter_rows(np.ascontiguousarray(raw), bpp))


def _diff_rect(cur, prev):
    """Bounding box of pixels that differ, or None if identical."""
    d = np.any(cur != prev, axis=2)
    if not d.any():
        return None
    ys, xs = np.where(d.any(1))[0], np.where(d.any(0))[0]
    return int(xs[0]), int(ys[0]), int(xs[-1]) + 1, int(ys[-1]) + 1


def write_apng(path, frames, delay_num, delay_den, loops=1):
    """frames: list of (h, w, 4) uint8 RGBA, all the same size.

    Always written as colour type 6 (true-colour RGBA). LINE Creators Market
    requires RGB colour mode, so an indexed-colour APNG is rejected at upload
    even though it is a valid APNG -- reduce colours before calling this and
    let deflate exploit the repetition instead.
    """
    h, w = frames[0].shape[:2]
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    extra = []
    data = frames
    bpp = 4

    out = [SIG, _chunk(b"IHDR", ihdr)]
    out += extra
    out.append(_chunk(b"acTL", struct.pack(">II", len(data), loops)))

    seq = 0
    # Frame 0 always covers the whole canvas so that looping restarts cleanly
    # even in viewers that do not reset the output buffer.
    out.append(_chunk(b"fcTL", struct.pack(
        ">IIIIIHHBB", seq, w, h, 0, 0, delay_num, delay_den,
        DISPOSE_NONE, BLEND_SOURCE)))
    seq += 1
    out.append(_chunk(b"IDAT", _encode(data[0], bpp)))

    prev = data[0]
    for fr in data[1:]:
        rect = _diff_rect(fr, prev)
        if rect is None:
            rect = (0, 0, 1, 1)
        x0, y0, x1, y1 = rect
        sub = np.ascontiguousarray(fr[y0:y1, x0:x1])
        out.append(_chunk(b"fcTL", struct.pack(
            ">IIIIIHHBB", seq, x1 - x0, y1 - y0, x0, y0,
            delay_num, delay_den, DISPOSE_NONE, BLEND_SOURCE)))
        seq += 1
        out.append(_chunk(b"fdAT", struct.pack(">I", seq) + _encode(sub, bpp)))
        seq += 1
        prev = fr

    out.append(_chunk(b"IEND", b""))
    blob = b"".join(out)
    with open(path, "wb") as fh:
        fh.write(blob)
    return len(blob)
