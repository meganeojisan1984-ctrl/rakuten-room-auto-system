# -*- coding: utf-8 -*-
"""prompts.py の内容を、コピーできる確認用ページとして書き出す。"""
import argparse
import html
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import prompts as P

BLOCKS = [
    ("spec", "共通", "絶対規格ブロック",
     "工程3以降のプロンプトの先頭に毎回貼る。ここが全工程の基準になる。", P.SPEC),
    ("s3", "工程3", "モーション動画生成",
     "今回いちばん損をした工程。背景が途中で情景に変わり、動画1本がまるごと使えなくなった。", P.STEP3),
    ("s4", "工程4", "APNG変換",
     "申請時のアップロードエラーの原因はここ。規格と、出力前の機械検証を必須にしてある。", P.STEP4),
    ("s5", "工程5", "選定・並び順",
     "24点の採用と並び順を決める。代案を出させず、最善の1案だけを返させる。", P.STEP5),
    ("s6", "工程6", "申請メタデータ",
     "コピペシートは使わない。日本語で全項目 → 英語で全項目の順に、1案だけ出させる。", P.STEP6),
    ("s7", "工程7", "タグ設定",
     "LINE側に一括設定の手段は無い。24点×3個の割り当てを先に決めて、画面ではクリックするだけにする。", P.STEP7),
]


def render():
    rows = "\n".join(f"""        <tr>
          <td class="sym">{html.escape(sym)}</td>
          <td><strong>{html.escape(what)}</strong><br><span class="why">{html.escape(why)}</span></td>
          <td class="step">{html.escape(step)}</td>
          <td>{html.escape(fix)}</td>
        </tr>""" for what, why, step, fix in
        [(w, y, s, f) for w, y, s, f in P.FAILURES]
        for sym in ["!"])
    blocks = "\n".join(f"""      <article class="block" id="{bid}">
        <div class="bhead">
          <div class="btitle">
            <span class="badge">{html.escape(step)}</span>
            <h3>{html.escape(name)}</h3>
          </div>
          <button type="button" class="copy" data-target="p-{bid}">コピー</button>
        </div>
        <p class="bnote">{html.escape(note)}</p>
        <pre id="p-{bid}">{html.escape(body)}</pre>
      </article>""" for bid, step, name, note, body in BLOCKS)
    return TEMPLATE.replace("{{ROWS}}", rows).replace("{{BLOCKS}}", blocks)


TEMPLATE = r"""<title>スタンプ工程プロンプト改訂</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
:root {
  --ground: #f5f6f2; --panel: #ffffff; --sunk: #eceee7;
  --ink: #1b201b; --ink-2: #5d655c; --ink-3: #8b9289; --rule: #dde0d8;
  --key: #0f9b52; --key-soft: #e6f4ea;
  --flag: #b0641a; --flag-soft: #fbf0e3;
  --display: "Zen Kaku Gothic New", "Hiragino Kaku Gothic ProN", "Yu Gothic", system-ui, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground: #131612; --panel: #1c201b; --sunk: #23281f;
    --ink: #eaeee7; --ink-2: #a8b0a4; --ink-3: #767e73; --rule: #2c322a;
    --key: #46c583; --key-soft: #17301f;
    --flag: #d99a4e; --flag-soft: #2c2116;
  }
}
:root[data-theme="dark"] {
  --ground: #131612; --panel: #1c201b; --sunk: #23281f;
  --ink: #eaeee7; --ink-2: #a8b0a4; --ink-3: #767e73; --rule: #2c322a;
  --key: #46c583; --key-soft: #17301f;
  --flag: #d99a4e; --flag-soft: #2c2116;
}

* { box-sizing: border-box; }
body {
  margin: 0; background: var(--ground); color: var(--ink);
  font-family: var(--display); font-size: 15px; line-height: 1.75;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1000px; margin: 0 auto; padding: 56px 24px 96px; }

.mast { display: flex; flex-direction: column; gap: 14px; padding-bottom: 30px; border-bottom: 1px solid var(--rule); }
.eyebrow { font-family: var(--mono); font-size: 11px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--key); }
h1 { margin: 0; font-size: clamp(29px, 4.4vw, 42px); font-weight: 700; letter-spacing: -.01em; line-height: 1.25; text-wrap: balance; }
.lede { margin: 0; max-width: 62ch; color: var(--ink-2); }

section { margin-top: 60px; }
h2.sec { margin: 0 0 6px; font-size: 21px; font-weight: 700; }
.hint { margin: 0 0 20px; color: var(--ink-3); font-size: 13.5px; max-width: 66ch; }

/* 失敗表: カードにせず、罫線だけで読ませる */
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; min-width: 660px; font-size: 14px; }
th, td { text-align: left; padding: 13px 14px; border-bottom: 1px solid var(--rule); vertical-align: top; }
thead th { font-family: var(--mono); font-size: 11px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); border-bottom: 1px solid var(--ink-3); }
td.sym { width: 26px; padding-right: 0; color: var(--flag); font-family: var(--mono); font-weight: 600; }
td.step { white-space: nowrap; font-family: var(--mono); font-size: 12.5px; color: var(--key); font-weight: 600; }
.why { color: var(--ink-2); font-size: 13.5px; }
tbody td { color: var(--ink-2); }
tbody td strong { color: var(--ink); font-weight: 500; }

/* プロンプト */
.blocks { display: flex; flex-direction: column; gap: 30px; }
.block { border: 1px solid var(--rule); border-radius: 4px; background: var(--panel); overflow: hidden; }
.bhead { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 15px 18px 0; }
.btitle { display: flex; align-items: baseline; gap: 11px; min-width: 0; }
.badge { font-family: var(--mono); font-size: 11px; font-weight: 600; letter-spacing: .08em; color: var(--key); background: var(--key-soft); padding: 3px 9px; border-radius: 3px; white-space: nowrap; }
.block h3 { margin: 0; font-size: 17px; font-weight: 700; }
.bnote { margin: 6px 18px 14px; color: var(--ink-3); font-size: 13.5px; max-width: 68ch; }
pre {
  margin: 0; padding: 18px; background: var(--sunk); border-top: 1px solid var(--rule);
  font-family: var(--mono); font-size: 12.5px; line-height: 1.85; color: var(--ink);
  white-space: pre-wrap; word-break: break-word; overflow-x: auto;
}
.copy {
  font: inherit; font-size: 13px; padding: 5px 15px; cursor: pointer; white-space: nowrap;
  color: var(--ink-2); background: var(--panel); border: 1px solid var(--rule); border-radius: 999px;
  transition: background .12s, color .12s, border-color .12s;
}
.copy:hover { color: var(--ink); border-color: var(--ink-3); }
.copy:focus-visible { outline: 2px solid var(--key); outline-offset: 2px; }
.copy.done { background: var(--key); border-color: var(--key); color: #fff; }

.note { margin-top: 34px; padding: 4px 0 4px 20px; border-left: 3px solid var(--flag); }
.note h3 { margin: 0 0 6px; font-size: 16px; font-weight: 700; }
.note p { margin: 0 0 8px; max-width: 66ch; color: var(--ink-2); font-size: 14.5px; }
.note p:last-child { margin-bottom: 0; }

footer { margin-top: 72px; padding-top: 22px; border-top: 1px solid var(--rule); color: var(--ink-3); font-size: 13px; }
footer code { font-family: var(--mono); font-size: 12px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>

<div class="wrap">
  <header class="mast">
    <p class="eyebrow">LINE Creators Market / prompt revision</p>
    <h1>スタンプ工程プロンプト改訂</h1>
    <p class="lede">申請時のアップロードエラーと、動画素材の歩留まりの悪さは、
      どちらも工程プロンプトの指定漏れが原因でした。原因を工程に対応づけ、
      同じ失敗が起きないよう書き直したものです。</p>
  </header>

  <section>
    <h2 class="sec">今回の失敗と、どこを直したか</h2>
    <p class="hint">工程4は申請が通らなかった直接の原因、工程3は素材の歩留まりを落としていた原因です。</p>
    <div class="scroll"><table>
      <thead><tr><th scope="col"></th><th scope="col">起きたこと</th><th scope="col">工程</th><th scope="col">プロンプトに入れた指定</th></tr></thead>
      <tbody>
{{ROWS}}
      </tbody>
    </table></div>
  </section>

  <section>
    <h2 class="sec">改訂プロンプト</h2>
    <p class="hint">工程3以降は、先頭に「絶対規格ブロック」を貼ってから各工程の本文を続けます。
      工程1（キャラクター設計）と工程2（静止画生成）は今回の失敗と無関係なので変更していません。</p>
    <div class="blocks">
{{BLOCKS}}
    </div>
  </section>

  <div class="note">
    <h3>工程6のコピペシートについて</h3>
    <p>入力欄を並べたシートは使いません。工程6のプロンプトが、申請フォームに入れる
      5項目をそのまま文章で返します。</p>
    <p>「日本語で全項目 → 英語で全項目」の順に出し、候補や代案は出させません。
      文字数は全角1文字＝2、半角1文字＝1として数え、各行末に <code>(12/40)</code> の形で
      添えさせているので、そのまま貼って上限を確認できます。</p>
    <p>クリエイター名とコピーライトだけは指定値をそのまま使わせています。
      ここをAIに創作させると、実在の名義と食い違ったまま申請してしまうためです。</p>
  </div>

  <footer>
    正本: <code>tools/line-sticker/prompts.py</code> ・
    このページ: <code>tools/line-sticker/prompts_page.py</code> で生成
  </footer>
</div>

<script>
document.querySelectorAll('.copy').forEach(function (b) {
  b.addEventListener('click', function () {
    var el = document.getElementById(b.dataset.target);
    if (!el) return;
    var done = function () {
      b.textContent = 'コピーしました';
      b.classList.add('done');
      setTimeout(function () { b.textContent = 'コピー'; b.classList.remove('done'); }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(el.textContent).then(done, function () {});
      return;
    }
    var r = document.createRange();
    r.selectNodeContents(el);
    var s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    try { document.execCommand('copy'); done(); } catch (e) {}
    s.removeAllRanges();
  });
});
</script>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    open(a.out, "w").write(render())
    print(a.out, os.path.getsize(a.out), "bytes")


if __name__ == "__main__":
    main()
