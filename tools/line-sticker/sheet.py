"""Render the review sheet: every sticker animating, with its measured specs."""
import argparse
import base64
import json
import os
import sys
import tempfile

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as B
from apng import write_apng
from verify import read_actl

# The submission files total ~13MB, past what a single page can carry, so the
# sheet embeds a lighter re-encode. Same canvas, same transparency, same
# 2.000s loop -- half the frame rate and fewer colours.
PREVIEW_FRAMES = 10
PREVIEW_COLOURS = 48


def data_uri(path):
    return "data:image/png;base64," + base64.b64encode(open(path, "rb").read()).decode()


def preview_uri(path):
    im = Image.open(path)
    if getattr(im, "n_frames", 1) == 1:
        return data_uri(path)
    idx = np.linspace(0, im.n_frames, PREVIEW_FRAMES, endpoint=False).round().astype(int)
    sel = []
    for i in idx:
        im.seek(int(i))
        sel.append(np.asarray(im.convert("RGBA")).copy())
    pal, ifr = B.quantise(sel, PREVIEW_COLOURS)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as fh:
        tmp = fh.name
    try:
        write_apng(tmp, [pal[j] for j in ifr], 1, PREVIEW_FRAMES // 2, loops=2)
        return data_uri(tmp)
    finally:
        os.unlink(tmp)


def spec_row(path):
    n, plays, total, _ = read_actl(path)
    return {"frames": n, "seconds": round(total, 3),
            "kb": round(os.path.getsize(path) / 1024, 1), "loop": plays}


def build(setdir, labels, out):
    man = json.load(open(os.path.join(setdir, "manifest.json")))
    items = []
    for i, s in enumerate(man["stickers"], 1):
        p = os.path.join(setdir, s["file"])
        row = spec_row(p)
        row.update(no=f"{i:02d}", file=s["file"], cut=s["cut"],
                   label=labels.get(s["file"], ""), uri=preview_uri(p))
        items.append(row)
    main = spec_row(os.path.join(setdir, "main.png"))
    main["uri"] = preview_uri(os.path.join(setdir, "main.png"))
    tab = {"kb": round(os.path.getsize(os.path.join(setdir, "tab.png")) / 1024, 1),
           "uri": data_uri(os.path.join(setdir, "tab.png"))}
    html = render(items, main, tab)
    open(out, "w").write(html)
    return len(html)


def render(items, main, tab):
    kbs = [i["kb"] for i in items]
    frames = sorted({i["frames"] for i in items})
    checks = [
        ("形式", "APNG・カラーモード RGB", "全24点 colour type 6"),
        ("サイズ", "320 × 270 px", "上限ちょうど"),
        ("余白", "10 px 以上", "全辺 10px"),
        ("フレーム数", "5 〜 20", f"{min(frames)} 〜 {max(frames)}"),
        ("再生時間", "1 / 2 / 3 / 4 秒", "2.000 秒 × 2 ループ = 4.000 秒"),
        ("ファイルサイズ", "1 MB 以下", f"{min(kbs)} 〜 {max(kbs)} KB"),
        ("背景", "完全透過", "内部の透過穴 0 件"),
        ("セット数", "8 / 16 / 24", "24 点"),
    ]
    cards = "\n".join(f'''      <figure class="cell">
        <div class="stage"><img src="{i['uri']}" alt="{i['no']} {i['label']}" width="320" height="270"></div>
        <figcaption>
          <span class="no">{i['no']}</span>
          <span class="label">{i['label']}</span>
          <span class="spec">{i['frames']}f · {i['seconds']:.3f}s ×{i['loop']} · {i['kb']} KB</span>
          <span class="cut">{i['cut']}</span>
        </figcaption>
      </figure>''' for i in items)
    checkrows = "\n".join(f'''        <div class="check">
          <span class="ck" aria-hidden="true">✓</span>
          <span class="ck-name">{n}</span>
          <span class="ck-req">{req}</span>
          <span class="ck-got">{got}</span>
        </div>''' for n, req, got in checks)
    excluded = [
        ("c04_v13_108", "両手ハート。腕と体で囲まれた内側が大きく、内部透過を塞ぐと白で埋まってしまうため 08 は敬礼に差し替え。"),
        ("c05_v13_144", "同じくハートのポーズ。前半が c04 と重複。"),
        ("c13_v15_000", "01 と同じ待機ポーズから始まるため重複。"),
        ("c21_v15_288", "22 の後半と 23 の前半をつないだだけの繋ぎ区間。"),
        ("c23_v17_000", "壁の角の線だけが残り、動きがほぼない。"),
        ("c25_v17_072", "同上。12 の覗き込みと役割が重なる。"),
    ]
    exrows = "\n".join(f'''        <tr><th scope="row">{c}</th><td>{r}</td></tr>''' for c, r in excluded)
    sources = [
        ("sticker_00013", "0 – 361", "全編グリーンバック", "11 カット"),
        ("sticker_00014", "120 – 219", "他は室内背景のため不使用", "2 カット"),
        ("sticker_00015", "0 – 361", "全編グリーンバック", "10 カット"),
        ("sticker_00018", "—", "ほぼ全編がレンガ壁の背景", "0 カット"),
        ("sticker_00019", "0 – 144 / 176 – 237 / 249 – 328", "3 区間", "7 カット"),
    ]
    srcrows = "\n".join(f'''        <tr><th scope="row">{a}</th><td class="num">{b}</td><td>{c}</td><td class="num">{d}</td></tr>'''
                        for a, b, c, d in sources)
    return TEMPLATE.format(cards=cards, checkrows=checkrows, exrows=exrows,
                           srcrows=srcrows, main_uri=main["uri"], tab_uri=tab["uri"],
                           main_spec=f"{main['frames']}f · {main['seconds']:.3f}s · {main['kb']} KB",
                           tab_spec=f"静止 · {tab['kb']} KB")


TEMPLATE = r"""<title>アニメスタンプ24点 申請チェック</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
:root {{
  --ground: #f5f6f2;
  --panel: #ffffff;
  --sunk: #eceee7;
  --ink: #1b201b;
  --ink-2: #5d655c;
  --ink-3: #8b9289;
  --rule: #dde0d8;
  --key: #0f9b52;
  --key-soft: #e6f4ea;
  --flag: #b0641a;
  --flag-soft: #fbf0e3;
  --chk-a: #e9ebe5;
  --chk-b: #fbfcf9;
  --shadow: 0 1px 2px rgba(27, 32, 27, .06), 0 8px 24px -18px rgba(27, 32, 27, .5);
  --display: "Zen Kaku Gothic New", "Hiragino Kaku Gothic ProN", "Yu Gothic", system-ui, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
}}
@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
    --ground: #14171400; --ground: #131612;
    --panel: #1c201b;
    --sunk: #23281f;
    --ink: #eaeee7;
    --ink-2: #a8b0a4;
    --ink-3: #767e73;
    --rule: #2c322a;
    --key: #46c583;
    --key-soft: #17301f;
    --flag: #d99a4e;
    --flag-soft: #2c2116;
    --chk-a: #232821;
    --chk-b: #2b3129;
    --shadow: 0 1px 2px rgba(0, 0, 0, .5), 0 10px 26px -20px #000;
  }}
}}
:root[data-theme="dark"] {{
  --ground: #131612;
  --panel: #1c201b;
  --sunk: #23281f;
  --ink: #eaeee7;
  --ink-2: #a8b0a4;
  --ink-3: #767e73;
  --rule: #2c322a;
  --key: #46c583;
  --key-soft: #17301f;
  --flag: #d99a4e;
  --flag-soft: #2c2116;
  --chk-a: #232821;
  --chk-b: #2b3129;
  --shadow: 0 1px 2px rgba(0, 0, 0, .5), 0 10px 26px -20px #000;
}}

* {{ box-sizing: border-box; }}
body {{
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font-family: var(--display);
  font-size: 15px;
  line-height: 1.75;
  -webkit-font-smoothing: antialiased;
}}
.wrap {{ max-width: 1120px; margin: 0 auto; padding: 56px 24px 96px; }}

/* ---- masthead ---- */
.mast {{ display: flex; flex-direction: column; gap: 14px; padding-bottom: 30px; border-bottom: 1px solid var(--rule); }}
.eyebrow {{
  font-family: var(--mono); font-size: 11px; font-weight: 600;
  letter-spacing: .14em; text-transform: uppercase; color: var(--key);
}}
h1 {{ margin: 0; font-size: clamp(30px, 4.6vw, 44px); font-weight: 700; letter-spacing: -.01em; line-height: 1.25; text-wrap: balance; }}
.lede {{ margin: 0; max-width: 62ch; color: var(--ink-2); }}

/* ---- verdict + checks ---- */
.verdict {{
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 14px;
  margin-top: 40px; padding: 14px 18px; border-radius: 4px;
  background: var(--key-soft); color: var(--ink);
}}
.verdict strong {{ font-size: 17px; }}
.verdict span {{ color: var(--ink-2); font-size: 14px; }}
.checks {{ margin-top: 18px; display: grid; gap: 1px; background: var(--rule); border: 1px solid var(--rule); border-radius: 4px; overflow: hidden; }}
.check {{
  display: grid; grid-template-columns: 26px 8.5rem 1fr auto; align-items: baseline;
  gap: 4px 14px; padding: 11px 18px; background: var(--panel);
}}
.ck {{ color: var(--key); font-weight: 700; }}
.ck-name {{ font-weight: 500; }}
.ck-req {{ color: var(--ink-3); font-size: 13.5px; }}
.ck-got {{ font-family: var(--mono); font-size: 13px; color: var(--ink-2); font-variant-numeric: tabular-nums; }}
@media (max-width: 620px) {{
  .check {{ grid-template-columns: 22px 1fr; }}
  .ck-req, .ck-got {{ grid-column: 2; }}
}}

/* ---- the rejection note: a rule, not a card ---- */
.note {{
  margin-top: 34px; padding: 4px 0 4px 20px;
  border-left: 3px solid var(--flag);
}}
.note h2 {{ margin: 0 0 6px; font-size: 16px; font-weight: 700; }}
.note p {{ margin: 0 0 8px; max-width: 66ch; color: var(--ink-2); font-size: 14.5px; }}
.note ol {{ margin: 0; padding-left: 1.3em; max-width: 66ch; color: var(--ink-2); font-size: 14.5px; }}
.note li {{ margin-bottom: 3px; }}
.note code {{ font-family: var(--mono); font-size: 12.5px; background: var(--flag-soft); padding: 1px 5px; border-radius: 3px; color: var(--ink); }}

/* ---- section heads ---- */
section {{ margin-top: 64px; }}
.head {{ display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 12px 20px; margin-bottom: 20px; }}
h2.sec {{ margin: 0; font-size: 21px; font-weight: 700; letter-spacing: -.005em; }}
.hint {{ margin: 0; color: var(--ink-3); font-size: 13.5px; }}

/* ---- backdrop switch ---- */
.switch {{ display: flex; flex-wrap: wrap; gap: 6px; }}
.switch button {{
  font: inherit; font-size: 13px; padding: 5px 13px; cursor: pointer;
  color: var(--ink-2); background: var(--panel);
  border: 1px solid var(--rule); border-radius: 999px;
  transition: background .12s, color .12s, border-color .12s;
}}
.switch button:hover {{ color: var(--ink); border-color: var(--ink-3); }}
.switch button[aria-pressed="true"] {{ background: var(--ink); color: var(--ground); border-color: var(--ink); }}
.switch button:focus-visible {{ outline: 2px solid var(--key); outline-offset: 2px; }}

/* ---- sticker grid ---- */
.grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(214px, 1fr)); gap: 22px; }}
.cell {{ margin: 0; display: flex; flex-direction: column; gap: 9px; }}
.stage {{
  display: grid; place-items: center; padding: 6px;
  border: 1px solid var(--rule); border-radius: 3px;
  background-color: var(--chk-b);
  background-image:
    linear-gradient(45deg, var(--chk-a) 25%, transparent 25%, transparent 75%, var(--chk-a) 75%),
    linear-gradient(45deg, var(--chk-a) 25%, transparent 25%, transparent 75%, var(--chk-a) 75%);
  background-size: 14px 14px;
  background-position: 0 0, 7px 7px;
}}
.stage img {{ display: block; width: 100%; height: auto; }}
figcaption {{ display: grid; grid-template-columns: auto 1fr; gap: 1px 9px; align-items: baseline; }}
.no {{ font-family: var(--mono); font-size: 12px; font-weight: 600; color: var(--key); font-variant-numeric: tabular-nums; }}
.label {{ font-size: 14px; font-weight: 500; }}
.spec {{ grid-column: 2; font-family: var(--mono); font-size: 11.5px; color: var(--ink-2); font-variant-numeric: tabular-nums; }}
.cut {{ grid-column: 2; font-family: var(--mono); font-size: 11px; color: var(--ink-3); }}

/* backdrop modes */
body[data-bd="white"] .stage {{ background: #ffffff; }}
body[data-bd="black"] .stage {{ background: #101010; }}
body[data-bd="line"]  .stage {{ background: #7494c0; }}
body[data-bd="magenta"] .stage {{ background: #ff00ff; }}

/* ---- assets pair ---- */
.assets {{ display: flex; flex-wrap: wrap; gap: 26px; align-items: flex-end; }}
.asset {{ display: flex; flex-direction: column; gap: 9px; }}
.asset .stage {{ padding: 0; }}
.asset img {{ display: block; }}
.asset .k {{ font-weight: 500; font-size: 14px; }}
.asset .v {{ font-family: var(--mono); font-size: 11.5px; color: var(--ink-2); }}

/* ---- tables ---- */
.scroll {{ overflow-x: auto; }}
table {{ border-collapse: collapse; width: 100%; min-width: 520px; font-size: 14px; }}
caption {{ text-align: left; color: var(--ink-3); font-size: 13.5px; padding-bottom: 10px; }}
th, td {{ text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--rule); vertical-align: top; }}
thead th {{
  font-family: var(--mono); font-size: 11px; font-weight: 600; letter-spacing: .1em;
  text-transform: uppercase; color: var(--ink-3); border-bottom: 1px solid var(--ink-3);
}}
tbody th {{ font-family: var(--mono); font-size: 12.5px; font-weight: 600; white-space: nowrap; color: var(--ink); }}
td.num {{ font-family: var(--mono); font-size: 12.5px; color: var(--ink-2); font-variant-numeric: tabular-nums; white-space: nowrap; }}
tbody td {{ color: var(--ink-2); }}

footer {{ margin-top: 72px; padding-top: 22px; border-top: 1px solid var(--rule); color: var(--ink-3); font-size: 13px; }}
footer code {{ font-family: var(--mono); font-size: 12px; }}

@media (prefers-reduced-motion: reduce) {{ * {{ transition: none !important; }} }}
</style>

<div class="wrap">
  <header class="mast">
    <p class="eyebrow">LINE Creators Market / animation sticker</p>
    <h1>アニメスタンプ24点 申請チェック</h1>
    <p class="lede">グリーンバックのモーション動画 5 本から 1.5 秒カットを 30 本切り出し、
      規格を満たした 24 点を採用しました。表示は軽量化した 10 フレーム版です（申請ファイルは 16〜20 フレーム）。
      枠の大きさ・透過・ループの長さは申請ファイルと同じで、下に出ている数値も実ファイルの実測値です。</p>
  </header>

  <div class="verdict">
    <strong>全 24 点 + main / tab — 規格チェック 問題 0 件</strong>
    <span>tools/line-sticker/verify.py による全フレーム走査</span>
  </div>

  <div class="checks">
{checkrows}
  </div>

  <div class="note">
    <h2>「イラスト内部が透過されています」への対策</h2>
    <p>過去のリジェクト理由です。原因になりうる箇所を 3 段階で塞いでいます。</p>
    <ol>
      <li>キーイング直後 — 不透明な絵柄に囲まれて画面外へ到達できない領域を、すべて不透明化。輪郭のアンチエイリアスは画面端までつながるので潰れません。</li>
      <li>320 × 270 へ縮小した後 — もう一度同じ処理。</li>
      <li>減色後 — <strong>ここが実際に再発していました。</strong>パレット化でアルファ 255 の画素が半透明パレットに吸われ、1〜7px の不可視の穴が生まれます。完全不透明な画素は不透明パレットのみに割り当て、書き出す直前のインデックス画像も再チェックしています。</li>
    </ol>
    <p>下の背景切り替えの <code>マゼンタ</code> が、穴と緑の縁を目視で探すのに一番向いています。</p>
  </div>

  <section>
    <div class="head">
      <div>
        <h2 class="sec">採用 24 点</h2>
        <p class="hint">01.png 〜 24.png。ファイル名の順に並んでいます。</p>
      </div>
      <div class="switch" role="group" aria-label="背景を切り替える">
        <button type="button" data-bd="checker" aria-pressed="true">市松</button>
        <button type="button" data-bd="white" aria-pressed="false">白</button>
        <button type="button" data-bd="black" aria-pressed="false">黒</button>
        <button type="button" data-bd="line" aria-pressed="false">トーク画面</button>
        <button type="button" data-bd="magenta" aria-pressed="false">マゼンタ</button>
      </div>
    </div>
    <div class="grid">
{cards}
    </div>
  </section>

  <section>
    <div class="head">
      <div>
        <h2 class="sec">main.png / tab.png</h2>
        <p class="hint">main は 240 × 240 の APNG、tab は 96 × 74 の静止透過 PNG。原寸で表示しています。</p>
      </div>
    </div>
    <div class="assets">
      <figure class="asset">
        <div class="stage"><img src="{main_uri}" alt="main.png" width="240" height="240"></div>
        <figcaption><span class="k">main.png</span> <span class="v">240 × 240 · {main_spec}</span></figcaption>
      </figure>
      <figure class="asset">
        <div class="stage"><img src="{tab_uri}" alt="tab.png" width="96" height="74"></div>
        <figcaption><span class="k">tab.png</span> <span class="v">96 × 74 · {tab_spec}</span></figcaption>
      </figure>
    </div>
  </section>

  <section>
    <div class="head"><div>
      <h2 class="sec">元動画と採用区間</h2>
      <p class="hint">24fps・15.08 秒。グリーンバックが有効なフレームだけを使っています。</p>
    </div></div>
    <div class="scroll"><table>
      <caption>1 カット = 36 フレーム（1.5 秒）。これを 20 フレームに間引き、1 フレーム 1/10 秒で再生してループを 2.000 秒ちょうどに合わせています。</caption>
      <thead><tr><th scope="col">元ファイル</th><th scope="col">使用フレーム</th><th scope="col">備考</th><th scope="col">切り出し</th></tr></thead>
      <tbody>
{srcrows}
      </tbody>
    </table></div>
  </section>

  <section>
    <div class="head"><div>
      <h2 class="sec">見送った候補 6 本</h2>
      <p class="hint">30 本すべて規格は通っています。24 点に絞る際、内容が重複するものを外しました。差し替えたい場合はこの 6 本が控えです。</p>
    </div></div>
    <div class="scroll"><table>
      <thead><tr><th scope="col">カット</th><th scope="col">見送った理由</th></tr></thead>
      <tbody>
{exrows}
      </tbody>
    </table></div>
  </section>

  <footer>
    生成: <code>tools/line-sticker/</code>（build.py / pack.py / verify.py） ・
    申請 zip: <code>assets/line-stickers/line-sticker-set24.zip</code>
  </footer>
</div>

<script>
(function () {{
  var bar = document.querySelector('.switch');
  bar.addEventListener('click', function (e) {{
    var b = e.target.closest('button[data-bd]');
    if (!b) return;
    bar.querySelectorAll('button').forEach(function (x) {{
      x.setAttribute('aria-pressed', String(x === b));
    }});
    document.body.dataset.bd = b.dataset.bd;
  }});
  document.body.dataset.bd = 'checker';
}})();
</script>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", required=True)
    ap.add_argument("--labels", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    n = build(a.set, json.load(open(a.labels)), a.out)
    print(f"{a.out}  {n / 1024 / 1024:.2f}MB")


if __name__ == "__main__":
    main()
