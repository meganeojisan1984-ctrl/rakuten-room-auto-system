"""Assemble the LINE submission zip: main.png + tab.png + 01.png..NN.png."""
import argparse
import json
import os
import shutil
import sys
import zipfile

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as B
from apng import write_apng
from keying import read_frames, key_frame, seal_interior, clean_specks

TAB_MARGIN = 6  # the tab thumbnail is displayed tiny; LINE sets no margin rule for it


def render(cut, canvas, margin, n_frames):
    """Key one cut and lay it out on an arbitrary canvas size."""
    raw = read_frames(cut["src"], cut["start"], cut["count"], tuple(cut["size"]))
    keyed = []
    for fr in raw:
        r = key_frame(fr)
        r, _ = seal_interior(r)
        keyed.append(clean_specks(r))
    union = np.any([f[..., 3] >= 100 for f in keyed], 0)
    ys, xs = np.where(union.any(1))[0], np.where(union.any(0))[0]
    bbox = (int(xs[0]), int(ys[0]), int(xs[-1]) + 1, int(ys[-1]) + 1)
    old_canvas, old_margin, old_content = B.CANVAS, B.MARGIN, B.CONTENT
    B.CANVAS = canvas
    B.MARGIN = margin
    B.CONTENT = (canvas[0] - 2 * margin, canvas[1] - 2 * margin)
    try:
        fitted = B.fit_canvas(keyed, bbox)
    finally:
        B.CANVAS, B.MARGIN, B.CONTENT = old_canvas, old_margin, old_content
    idx = np.linspace(0, len(fitted), n_frames, endpoint=False).round().astype(int)
    return [fitted[i] for i in idx]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", required=True)
    ap.add_argument("--select", required=True, help="comma separated cut ids, in order")
    ap.add_argument("--cand", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--hero", required=True, help="cut id used for main.png")
    ap.add_argument("--tab", help="cut id used for tab.png (defaults to --hero)")
    args = ap.parse_args()

    cuts = {c["id"]: c for c in json.load(open(args.plan))["cuts"]}
    chosen = [s.strip() for s in args.select.split(",") if s.strip()]
    os.makedirs(args.out, exist_ok=True)

    manifest = []
    for i, cid in enumerate(chosen, 1):
        dst = os.path.join(args.out, f"{i:02d}.png")
        shutil.copy(os.path.join(args.cand, cid + ".png"), dst)
        manifest.append({"file": f"{i:02d}.png", "cut": cid,
                         "bytes": os.path.getsize(dst)})

    hero = cuts[args.hero]
    # main.png: 240x240 APNG, same 2.000s loop as the stickers.
    frames = render(hero, (240, 240), 10, 20)
    pal, idx = B.quantise(frames, 128)
    n = write_apng(os.path.join(args.out, "main.png"), frames, 1, 10, palette=(pal, idx))
    if n > B.MAX_BYTES:
        frames = frames[::2]
        pal, idx = B.quantise(frames, 64)
        n = write_apng(os.path.join(args.out, "main.png"), frames, 1, 5, palette=(pal, idx))

    # tab.png: single static transparent frame.
    tab = render(cuts[args.tab or args.hero], (96, 74), TAB_MARGIN, 1)[0]
    Image.fromarray(tab).save(os.path.join(args.out, "tab.png"), optimize=True)

    zip_path = os.path.join(os.path.dirname(args.out.rstrip("/")),
                            os.path.basename(args.out.rstrip("/")) + ".zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for name in ["main.png", "tab.png"] + [m["file"] for m in manifest]:
            z.write(os.path.join(args.out, name), name)

    json.dump({"hero": args.hero, "tab": args.tab or args.hero,
               "stickers": manifest, "zip": zip_path},
              open(os.path.join(args.out, "manifest.json"), "w"), indent=1)
    print(f"main.png {n / 1024:.1f}KB   tab.png "
          f"{os.path.getsize(os.path.join(args.out, 'tab.png')) / 1024:.1f}KB")
    print(f"{len(manifest)} stickers -> {zip_path} "
          f"({os.path.getsize(zip_path) / 1024 / 1024:.2f}MB)")


if __name__ == "__main__":
    main()
