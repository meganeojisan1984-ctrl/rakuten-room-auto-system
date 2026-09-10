"""Check built stickers against the LINE animation-sticker requirements."""
import struct
import sys
import glob
import os

import numpy as np
from PIL import Image
from scipy import ndimage

# LINE Creators Market limits: 1MB per file, 1-4 loops, 4s of total playback.
MAX_BYTES = 1024 * 1024
OK_SECONDS = (1.0, 2.0, 3.0, 4.0)
MAX_TOTAL_SECONDS = 4.0


def read_actl(path):
    """Parse acTL / fcTL directly: frame count, loop count, exact total duration."""
    blob = open(path, "rb").read()
    if blob[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    colour_type = blob[25]
    pos, n_frames, plays, total = 8, None, None, 0.0
    while pos < len(blob):
        ln = struct.unpack(">I", blob[pos:pos + 4])[0]
        tag = blob[pos + 4:pos + 8]
        data = blob[pos + 8:pos + 8 + ln]
        if tag == b"acTL":
            n_frames, plays = struct.unpack(">II", data)
        elif tag == b"fcTL":
            num, den = struct.unpack(">HH", data[20:24])
            total += num / (den or 100)
        pos += 12 + ln
    return n_frames, plays, total, colour_type


def check(path):
    errs = []
    size = os.path.getsize(path)
    n_frames, plays, total, colour_type = read_actl(path)
    if n_frames is None:
        errs.append("not an APNG (no acTL)")
    if size > MAX_BYTES:
        errs.append(f"size {size / 1024:.1f}KB > 300KB")
    if not (5 <= (n_frames or 0) <= 20):
        errs.append(f"frame count {n_frames} outside 5-20")
    if colour_type != 6:
        # An indexed-colour APNG is valid PNG but LINE requires RGB colour mode
        # and its uploader rejects the file outright.
        errs.append(f"colour type {colour_type} is not 6 (RGBA)")
    if not 1 <= (plays or 0) <= 4:
        errs.append(f"loop count {plays} outside LINE's 1-4")
    if not any(abs(total - s) < 1e-6 for s in OK_SECONDS):
        errs.append(f"duration {total:.6f}s is not exactly 1/2/3/4s")
    if total * (plays or 0) > MAX_TOTAL_SECONDS + 1e-6:
        errs.append(f"total playback {total * (plays or 0):.3f}s exceeds 4s")

    im = Image.open(path)
    if im.size != (320, 270):
        errs.append(f"canvas {im.size} != (320, 270)")

    margin = 10 ** 9
    for i in range(im.n_frames):
        im.seek(i)
        a = np.asarray(im.convert("RGBA"))[..., 3]
        core = a >= 250
        if not core.any():
            errs.append(f"frame {i}: empty")
            continue
        pockets = ndimage.binary_fill_holes(core) & ~core & (a < 250)
        if pockets.any():
            errs.append(f"frame {i}: {int(pockets.sum())} transparent px enclosed by artwork")
        ys, xs = np.where(a.any(1))[0], np.where(a.any(0))[0]
        margin = min(margin, int(ys[0]), int(xs[0]),
                     im.size[1] - 1 - int(ys[-1]), im.size[0] - 1 - int(xs[-1]))
    if margin < 10:
        errs.append(f"margin {margin}px < 10px")
    return {"file": os.path.basename(path), "kb": round(size / 1024, 1),
            "frames": n_frames, "seconds": round(total, 4), "loops": plays,
            "margin": margin, "errors": errs}


def main():
    rows = [check(p) for p in sorted(glob.glob(sys.argv[1]))]
    bad = 0
    for r in rows:
        flag = "NG" if r["errors"] else "ok"
        print(f"{flag}  {r['file']:<28} {r['kb']:>6.1f}KB  {r['frames']:>2}f  "
              f"{r['seconds']}s x{r['loops']}  margin={r['margin']}px")
        for e in r["errors"]:
            print(f"      -> {e}")
            bad += 1
    print(f"\n{len(rows)} files, {bad} problems")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
