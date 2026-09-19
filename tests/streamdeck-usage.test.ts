import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const PLUGIN_DIR = path.join(__dirname, "..", "tools", "streamdeck", "jp.rakutenroom.aiusage.sdPlugin");
const lib = (name: string) => require(path.join(PLUGIN_DIR, "lib", name));

const { formatJstShort, formatRemaining } = lib("jst.js");
const codex = lib("codex.js");
const claude = lib("claude.js");
const render = lib("render.js");
const { encodeFrame, decodeFrame, OPCODE } = lib("ws-client.js");

/* ---------------- JST 整形 ---------------- */

test("formatJstShort: UTC を日本時間 MM/DD HH:MM に整形する", () => {
  assert.equal(formatJstShort(new Date("2026-09-24T09:17:00Z")), "09/24 18:17");
  // 日付をまたぐケース
  assert.equal(formatJstShort(new Date("2026-09-18T15:30:00Z")), "09/19 00:30");
});

test("formatRemaining: 残り時間を日本語表記にする", () => {
  assert.equal(formatRemaining(90 * 60 * 1000), "1時間30分");
  assert.equal(formatRemaining(50 * 60 * 60 * 1000), "2日2時間");
  assert.equal(formatRemaining(-1), "0分");
});

/* ---------------- Codex ---------------- */

test("normalizeRateLimits: primary/secondary を 5h/weekly に振り分ける", () => {
  const base = new Date("2026-09-19T09:00:00Z");
  const windows = codex.normalizeRateLimits(
    {
      primary: { used_percent: 8, window_minutes: 300, resets_in_seconds: 3600 },
      secondary: { used_percent: 32, window_minutes: 10080, resets_in_seconds: 60 * 60 * 24 * 5 },
    },
    base
  );
  assert.equal(windows["5h"].remainingPercent, 92);
  assert.equal(windows.weekly.remainingPercent, 68);
  // リセット時刻はログ記録時刻を基準に算出する
  assert.equal(windows["5h"].resetAt.toISOString(), "2026-09-19T10:00:00.000Z");
  assert.equal(formatJstShort(windows.weekly.resetAt), "09/24 18:00");
});

test("normalizeRateLimits: window_minutes が短期でも secondary を 5h 扱いにする", () => {
  const windows = codex.normalizeRateLimits({ secondary: { used_percent: 10, window_minutes: 300 } }, null);
  assert.ok(windows["5h"], "window_minutes を優先して 5h に入る");
  assert.equal(windows.weekly, undefined);
});

test("parseTailForRateLimits: 末尾の token_count 行から取り出す", () => {
  const lines = [
    '{"timestamp":"2026-09-19T00:00:00Z","type":"event_msg","payload":{"type":"agent_message","message":"hi"}}',
    '{"timestamp":"2026-09-19T01:00:00Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":5,"window_minutes":300,"resets_in_seconds":100}}}}',
    '{"timestamp":"2026-09-19T02:00:00Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":40,"window_minutes":300,"resets_in_seconds":100}}}}',
    "",
  ].join("\n");
  const parsed = codex.parseTailForRateLimits(lines);
  assert.equal(parsed.rateLimits.primary.used_percent, 40, "最後の行を採用する");
  assert.equal(parsed.at.toISOString(), "2026-09-19T02:00:00.000Z");
});

test("parseTailForRateLimits: 途中で切れた先頭行を無視できる", () => {
  const broken =
    'mp":"2026-09-19T00:00:00Z","rate_limits":{"primary":{"used_percent":1}}}\n' +
    '{"timestamp":"2026-09-19T03:00:00Z","payload":{"rate_limits":{"secondary":{"used_percent":20,"window_minutes":10080}}}}\n';
  const parsed = codex.parseTailForRateLimits(broken);
  assert.equal(parsed.rateLimits.secondary.used_percent, 20);
});

test("readCodexUsage: セッションログから週間残量を読み出す", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-"));
  const dir = path.join(home, "sessions", "2026", "09", "19");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "rollout-2026-09-19T09-00-00.jsonl"),
    '{"timestamp":"2026-09-19T09:00:00Z","payload":{"type":"token_count","rate_limits":' +
      '{"primary":{"used_percent":0,"window_minutes":300,"resets_in_seconds":600},' +
      '"secondary":{"used_percent":32,"window_minutes":10080,"resets_in_seconds":432000}}}}\n'
  );
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  try {
    const snapshot = codex.readCodexUsage();
    assert.equal(snapshot.ok, true, snapshot.error);
    assert.equal(snapshot.windows.weekly.remainingPercent, 68);
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

/* ---------------- Claude ---------------- */

test("normalizeUsagePayload: utilization から残量とリセット時刻を得る", () => {
  const windows = claude.normalizeUsagePayload({
    five_hour: { utilization: 0, resets_at: "2026-09-18T13:59:00Z" },
    seven_day: { utilization: 0, resets_at: "2026-09-23T23:59:00Z" },
    seven_day_opus: { utilization: 45, resets_at: "2026-09-23T23:59:00Z" },
  });
  assert.equal(windows["5h"].remainingPercent, 100);
  assert.equal(formatJstShort(windows["5h"].resetAt), "09/18 22:59");
  assert.equal(formatJstShort(windows.weekly.resetAt), "09/24 08:59");
  assert.equal(windows.weekly_opus.remainingPercent, 55);
});

test("normalizeUsagePayload: 未知形式は空を返す", () => {
  assert.deepEqual(claude.normalizeUsagePayload({ foo: "bar" }), {});
  assert.deepEqual(claude.normalizeUsagePayload(null), {});
});

test("pickAccessToken: 認証ファイルの形式差異を吸収する", () => {
  assert.equal(claude.pickAccessToken({ claudeAiOauth: { accessToken: "tok-1" } }), "tok-1");
  assert.equal(claude.pickAccessToken({ access_token: "tok-2" }), "tok-2");
  assert.equal(claude.pickAccessToken({}), null);
});

/* ---------------- 描画 ---------------- */

test("renderKeySvg: 写真と同じ 5 行が入る", () => {
  const svg = render.renderKeySvg({
    provider: "codex",
    label: "CODEX",
    window: "weekly",
    remainingPercent: 68,
    resetAt: new Date("2026-09-24T09:17:00Z"),
  });
  for (const expected of ["CODEX", "週間・残り", "68%", "リセット（日本時間）", "09/24 18:17"]) {
    assert.ok(svg.includes(expected), `${expected} が含まれること`);
  }
  assert.ok(svg.startsWith("<svg"), "SVG であること");
});

test("renderKeySvg: 取得失敗時は --% と取得失敗を出す", () => {
  const svg = render.renderKeySvg({ provider: "claude", label: "CLAUDE", window: "5h", remainingPercent: null, resetAt: null, stale: true });
  assert.ok(svg.includes("--%"));
  assert.ok(svg.includes("取得失敗"));
});

test("renderKeySvg: 残量に応じて文字色が変わる / ラベルはエスケープされる", () => {
  assert.equal(render.valueColor(80), "#ffffff");
  assert.equal(render.valueColor(25), "#ffb020");
  assert.equal(render.valueColor(5), "#ff5f5f");
  const svg = render.renderKeySvg({ label: "A&B<C>", window: "weekly", remainingPercent: 50, resetAt: null });
  assert.ok(svg.includes("A&amp;B&lt;C&gt;"));
  assert.ok(!svg.includes("A&B<C>"));
});

test("toDataUri: setImage に渡せる data URI になる", () => {
  const uri = render.toDataUri("<svg/>");
  assert.ok(uri.startsWith("data:image/svg+xml;base64,"));
  assert.equal(Buffer.from(uri.split(",")[1], "base64").toString("utf8"), "<svg/>");
});

/* ---------------- WebSocket ---------------- */

test("WebSocket フレーム: マスク付き送信をデコードできる（長短両方）", () => {
  for (const text of ["短い", "あ".repeat(200), "x".repeat(70000)]) {
    const decoded = decodeFrame(encodeFrame(OPCODE.TEXT, text));
    assert.equal(decoded.opcode, OPCODE.TEXT);
    assert.equal(decoded.fin, true);
    assert.equal(decoded.payload.toString("utf8"), text);
    assert.equal(decoded.rest.length, 0);
  }
});

test("decodeFrame: データ不足なら null を返す", () => {
  const frame = encodeFrame(OPCODE.TEXT, "hello");
  assert.equal(decodeFrame(frame.subarray(0, 4)), null);
});

/* ---------------- プラグイン結合テスト ---------------- */

/** サーバ→クライアント方向（マスク無し）のフレームを組み立てる */
function serverFrame(text: string): Buffer {
  const data = Buffer.from(text, "utf8");
  let header: Buffer;
  if (data.length < 126) {
    header = Buffer.from([0x81, data.length]);
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  }
  return Buffer.concat([header, data]);
}

/** Stream Deck 本体の代わりになる最小 WebSocket サーバ */
function startMockStreamDeck(onMessage: (message: any, send: (m: any) => void) => void) {
  return new Promise<{ port: number; close: () => void }>((resolve) => {
    const server = net.createServer((socket) => {
      let buffer = Buffer.alloc(0);
      let handshaked = false;
      const send = (message: any) => socket.write(serverFrame(JSON.stringify(message)));
      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (!handshaked) {
          const end = buffer.indexOf("\r\n\r\n");
          if (end === -1) return;
          const header = buffer.subarray(0, end).toString("utf8");
          buffer = buffer.subarray(end + 4);
          const key = /sec-websocket-key:\s*(.+)/i.exec(header)![1].trim();
          const accept = crypto
            .createHash("sha1")
            .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
            .digest("base64");
          socket.write(
            ["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`, "", ""].join("\r\n")
          );
          handshaked = true;
        }
        for (;;) {
          const frame = decodeFrame(buffer);
          if (!frame) break;
          buffer = frame.rest;
          if (frame.opcode === OPCODE.TEXT) onMessage(JSON.parse(frame.payload.toString("utf8")), send);
        }
      });
      socket.on("error", () => {});
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({ port, close: () => server.close() });
    });
  });
}

test("plugin.js: 登録後 willAppear でキー画像を送る", async () => {
  // 取得結果を固定するため override ファイルを置いた一時 HOME で起動する
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "sd-home-"));
  fs.mkdirSync(path.join(home, ".ai-usage-meter"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".ai-usage-meter", "override.json"),
    JSON.stringify({ codex: { weekly: { remainingPercent: 68, resetAt: "2026-09-24T09:17:00Z" } } })
  );

  const received: any[] = [];
  let resolveImage: (svg: string) => void;
  const imagePromise = new Promise<string>((resolve) => (resolveImage = resolve));

  const mock = await startMockStreamDeck((message, send) => {
    received.push(message);
    if (message.event === "registerPlugin") {
      send({
        event: "willAppear",
        action: "jp.rakutenroom.aiusage.meter",
        context: "ctx-1",
        payload: { settings: { provider: "codex", window: "weekly", label: "CODEX" } },
      });
    }
    if (message.event === "setImage") {
      const image: string = message.payload.image;
      resolveImage(Buffer.from(image.split(",")[1], "base64").toString("utf8"));
    }
  });

  const child = spawn(
    process.execPath,
    [path.join(PLUGIN_DIR, "plugin.js"), "-port", String(mock.port), "-pluginUUID", "TESTUUID", "-registerEvent", "registerPlugin", "-info", "{}"],
    { env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: "ignore" }
  );

  try {
    const svg = await Promise.race([
      imagePromise,
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error("setImage が来ませんでした")), 10000)),
    ]);
    assert.ok(svg.includes("68%"), "残量が描画される");
    assert.ok(svg.includes("09/24 18:17"), "日本時間のリセット時刻が描画される");
    assert.ok(svg.includes("CODEX"), "見出しが描画される");
    const register = received.find((m) => m.event === "registerPlugin");
    assert.equal(register.uuid, "TESTUUID", "起動引数の pluginUUID で登録する");
  } finally {
    child.kill();
    mock.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
