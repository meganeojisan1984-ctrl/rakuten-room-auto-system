"""Turn green-screen motion clips into LINE animation-sticker APNGs.

Output per sticker: 320x270 APNG, 5-20 frames, exactly 2.000s per loop,
>=10px margin on every side, fully transparent background, <=300KB.
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apng import write_apng
from keying import read_frames, key_frame, seal_interior, clean_specks

CANVAS = (320, 270)
MARGIN = 10
CONTENT = (CANVAS[0] - 2 * MARGIN, CANVAS[1] - 2 * MARGIN)  # 300 x 250
MAX_BYTES = 300 * 1024

# (frame count, delay numerator, delay denominator) -- every row loops in 2.000s.
# Palette depth barely matters for flat cartoon art (64 colours is visually
# identical to full RGBA here), so spend the byte budget on frame count first.
LADDER = [
    (20, 1, 10), (20, 1, 10), (20, 1, 10), (16, 1, 8),
    (12, 1, 6), (10, 1, 5), (8, 1, 4), (6, 1, 3),
]
COLOURS = [128, 96, 64, 64, 64, 48, 32, 24]


def premultiply(rgba):
    a = rgba[..., 3:4].astype(np.float32) / 255.0
    return np.concatenate([rgba[..., :3].astype(np.float32) * a, rgba[..., 3:4]], -1)


def unpremultiply(pm):
    a = np.clip(pm[..., 3:4], 0, 255)
    rgb = np.where(a > 0.5, pm[..., :3] / np.maximum(a / 255.0, 1e-3), 0)
    return np.concatenate([np.clip(rgb, 0, 255), a], -1)


def fit_canvas(frames, bbox):
    """Scale by the clip-wide bbox so the character does not jitter, then centre."""
    x0, y0, x1, y1 = bbox
    bw, bh = x1 - x0, y1 - y0
    scale = min(CONTENT[0] / bw, CONTENT[1] / bh)
    nw, nh = max(1, int(round(bw * scale))), max(1, int(round(bh * scale)))
    ox, oy = (CANVAS[0] - nw) // 2, (CANVAS[1] - nh) // 2
    out = []
    for fr in frames:
        crop = fr[y0:y1, x0:x1]
        pm = premultiply(crop)
        # Resize premultiplied so transparent pixels cannot bleed colour into edges.
        small = np.stack([
            np.asarray(Image.fromarray(pm[..., c]).resize((nw, nh), Image.LANCZOS))
            for c in range(4)], -1)
        rgba = unpremultiply(small).round().clip(0, 255).astype(np.uint8)
        canvas = np.zeros((CANVAS[1], CANVAS[0], 4), np.uint8)
        canvas[oy:oy + nh, ox:ox + nw] = rgba
        a = canvas[..., 3]
        a[a < 10] = 0
        a[a > 246] = 255
        canvas[..., :3][a == 0] = 0
        canvas, _ = seal_interior(canvas)
        out.append(canvas)
    return out


def _median_cut(colours, counts, k):
    """Weighted median cut in RGBA space -- fast and deterministic."""
    boxes = [np.arange(len(colours))]
    while len(boxes) < k:
        widths = []
        for b in boxes:
            if len(b) < 2:
                widths.append(-1.0)
                continue
            c = colours[b]
            widths.append(float((c.max(0) - c.min(0)).max()) * float(np.log1p(counts[b].sum())))
        i = int(np.argmax(widths))
        if widths[i] <= 0:
            break
        b = boxes.pop(i)
        c = colours[b]
        axis = int(np.argmax(c.max(0) - c.min(0)))
        order = b[np.argsort(c[:, axis], kind="stable")]
        cum = np.cumsum(counts[order])
        cut = int(np.searchsorted(cum, cum[-1] / 2.0)) + 1
        cut = min(max(cut, 1), len(order) - 1)
        boxes += [order[:cut], order[cut:]]
    pal = []
    for b in boxes:
        w = counts[b].astype(np.float64)
        pal.append((colours[b] * w[:, None]).sum(0) / w.sum())
    return np.array(pal, np.float32)


def quantise(frames, ncolours):
    """Build one global RGBA palette shared by every frame (APNG requires it)."""
    px = np.concatenate([f.reshape(-1, 4) for f in frames])
    opaque = px[px[:, 3] > 0]
    colours, counts = np.unique(opaque, axis=0, return_counts=True)
    # Alpha errors are far more visible than colour errors, so weight it up.
    w = np.array([1.0, 1.0, 1.0, 3.0], np.float32)
    k = min(ncolours - 1, len(colours))
    cent = _median_cut(colours.astype(np.float32) * w, counts, k) / w
    pal = np.vstack([np.zeros((1, 4), np.float32), cent])
    pal = pal.round().clip(0, 255).astype(np.uint8)
    pal[0] = 0
    # Snap near-extremes so the palette itself cannot introduce a pinhole.
    pal[:, 3][pal[:, 3] >= 250] = 255
    pal[:, 3][pal[:, 3] <= 5] = 0
    # Fully transparent entries first so tRNS stays short.
    pal = pal[np.argsort(pal[:, 3], kind="stable")]
    clear = int(np.argmin(pal[:, 3]))

    opaque_ids = np.where(pal[:, 3] == 255)[0]
    if len(opaque_ids) == 0:
        opaque_ids = np.array([int(np.argmax(pal[:, 3]))])
        pal[opaque_ids[0], 3] = 255
    tree = cKDTree(pal.astype(np.float32) * w)
    # Opaque source pixels are matched against opaque entries only. Letting one
    # drift to a semi-transparent entry is what leaves the invisible holes
    # inside the artwork that the LINE review rejects.
    otree = cKDTree(pal[opaque_ids][:, :3].astype(np.float32))

    idx_frames = []
    for f in frames:
        flat = f.reshape(-1, 4)
        _, i = tree.query(flat.astype(np.float32) * w, workers=-1)
        i = i.astype(np.uint8)
        solid = flat[:, 3] == 255
        if solid.any():
            _, j = otree.query(flat[solid][:, :3].astype(np.float32), workers=-1)
            i[solid] = opaque_ids[j].astype(np.uint8)
        i[flat[:, 3] == 0] = clear
        idx_frames.append(i.reshape(f.shape[:2]))

    # Final guard, run on the palette indices that actually get written: any
    # pixel walled in by opaque artwork is forced to its nearest opaque entry.
    _, remap = otree.query(pal[:, :3].astype(np.float32), workers=-1)
    remap = opaque_ids[remap].astype(np.uint8)
    alpha_of = pal[:, 3]
    for i in idx_frames:
        core = alpha_of[i] == 255
        pockets = ndimage.binary_fill_holes(core) & ~core
        if pockets.any():
            i[pockets] = remap[i[pockets]]
    return pal, idx_frames


def encode(path, frames):
    """Walk the quality ladder until the file fits under 300KB."""
    for (n, dn, dd), ncol in zip(LADDER, COLOURS):
        idx = np.linspace(0, len(frames), n, endpoint=False).round().astype(int)
        idx = np.clip(idx, 0, len(frames) - 1)
        sel = [frames[i] for i in idx]
        if ncol is None:
            size = write_apng(path, sel, dn, dd)
        else:
            pal, ifr = quantise(sel, ncol)
            size = write_apng(path, sel, dn, dd, palette=(pal, ifr))
        if size <= MAX_BYTES:
            return {"frames": n, "delay": f"{dn}/{dd}", "seconds": round(n * dn / dd, 3),
                    "colours": ncol or "rgba8888", "bytes": size}
    return {"frames": n, "delay": f"{dn}/{dd}", "seconds": round(n * dn / dd, 3),
            "colours": ncol, "bytes": size, "over_limit": True}


def build_cut(src, start, count, size, out_path):
    raw = read_frames(src, start, count, size)
    keyed, sealed = [], 0
    for fr in raw:
        r = key_frame(fr)
        r, n = seal_interior(r)
        r = clean_specks(r)
        keyed.append(r)
        sealed += n
    masks = [f[..., 3] >= 100 for f in keyed]
    union = np.any(masks, 0)
    ys, xs = np.where(union.any(1))[0], np.where(union.any(0))[0]
    bbox = (int(xs[0]), int(ys[0]), int(xs[-1]) + 1, int(ys[-1]) + 1)
    fitted = fit_canvas(keyed, bbox)
    info = encode(out_path, fitted)
    info["sealed_px"] = int(sealed)
    return info, fitted


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    plan = json.load(open(args.plan))
    os.makedirs(args.out, exist_ok=True)
    report = []
    for cut in plan["cuts"]:
        path = os.path.join(args.out, cut["id"] + ".png")
        info, _ = build_cut(cut["src"], cut["start"], cut["count"],
                            tuple(cut["size"]), path)
        info.update(id=cut["id"], src=os.path.basename(cut["src"]),
                    start=cut["start"])
        report.append(info)
        print(f"{cut['id']:>8}  {info['frames']:>2}f  {info['seconds']}s  "
              f"{str(info['colours']):>9}  {info['bytes'] / 1024:6.1f}KB  "
              f"sealed={info['sealed_px']}", flush=True)
    json.dump(report, open(os.path.join(args.out, "report.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
