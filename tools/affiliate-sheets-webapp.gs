/**
 * affiliate-sheets-webapp.gs
 *
 * Googleスプレッドシートに内蔵するスクリプト（Apps Script）。
 * 「Webアプリ」としてデプロイすると、GitHub Actions から案件素材を受け取り、
 * 案件ごとに新しいタブを作成して書き込みます。
 * サービスアカウント鍵が作れない環境でも使えます（鍵不要）。
 *
 * 使い方（スマホのブラウザ・PC版表示）:
 *  1. 対象のスプレッドシートを開く →「拡張機能」→「Apps Script」
 *  2. このファイルの中身を全部貼り付け、下の TOKEN をお好きな合言葉に変更
 *  3. 右上「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *       次のユーザーとして実行: 自分
 *       アクセスできるユーザー: 全員
 *     →「デプロイ」→ 権限を承認 → 表示される「ウェブアプリのURL」をコピー
 *  4. GitHub の Secrets に登録:
 *       AFFILIATE_SHEETS_WEBAPP_URL = コピーしたURL
 *       AFFILIATE_SHEETS_TOKEN      = 下で設定した合言葉
 */

// ★ お好きな合言葉に変更し、GitHubの AFFILIATE_SHEETS_TOKEN と一致させてください
const TOKEN = 'change-me-please';

const DEDUP_SHEET = '_dedup';
const INDEX_SHEET = '_index';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (TOKEN && body.token !== TOKEN) {
      return json({ ok: false, error: 'invalid token' });
    }
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (body.action === 'dedup') {
      const sh = ss.getSheetByName(DEDUP_SHEET);
      let posts = [];
      if (sh && sh.getLastRow() > 0) {
        posts = sh.getRange(1, 1, sh.getLastRow(), 1).getValues()
          .map(function (r) { return String(r[0] || ''); })
          .filter(String);
      }
      return json({ ok: true, posts: posts });
    }

    if (body.action === 'write') {
      const tab = uniqueName(ss, String(body.tab || '案件'));
      const sh = ss.insertSheet(tab, 0); // 先頭に追加
      const rows = body.rows || [];
      if (rows.length) {
        var width = 1;
        for (var i = 0; i < rows.length; i++) width = Math.max(width, rows[i].length);
        var norm = rows.map(function (r) {
          var a = r.slice();
          while (a.length < width) a.push('');
          return a;
        });
        sh.getRange(1, 1, norm.length, width).setValues(norm);
        sh.setFrozenRows(1);
      }
      // 重複防止インデックス
      if (body.posts && body.posts.length) {
        var d = ss.getSheetByName(DEDUP_SHEET) || ss.insertSheet(DEDUP_SHEET);
        d.getRange(d.getLastRow() + 1, 1, body.posts.length, 1)
          .setValues(body.posts.map(function (p) { return [p]; }));
      }
      // 生成インデックス
      var idx = ss.getSheetByName(INDEX_SHEET) || ss.insertSheet(INDEX_SHEET);
      idx.appendRow(body.index || [new Date().toString(), tab]);

      return json({ ok: true, tab: tab, url: ss.getUrl() + '#gid=' + sh.getSheetId() });
    }

    return json({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function uniqueName(ss, base) {
  base = base.replace(/[\[\]:*?/\\]/g, '').slice(0, 90) || '案件';
  var name = base, i = 2;
  while (ss.getSheetByName(name)) { name = base + '_' + i; i++; }
  return name;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
