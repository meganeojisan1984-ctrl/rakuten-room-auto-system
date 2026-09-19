"use strict";
/**
 * Stream Deck プラグイン本体。
 * Codex / Claude の残量を定期取得し、キー画像（SVG）として描画する。
 *
 * Stream Deck から次の引数で起動される:
 *   -port <n> -pluginUUID <uuid> -registerEvent <event> -info <json>
 */

const { WsClient } = require("./lib/ws-client");
const { getUsage } = require("./lib/usage");
const { renderKeySvg, toDataUri, ACCENTS } = require("./lib/render");
const { formatRemaining } = require("./lib/jst");

const TICK_MS = 5000; // 更新期限のチェック間隔
const DEFAULT_REFRESH_SECONDS = 60;
const MIN_REFRESH_SECONDS = 15;
const STALE_AFTER_MS = 15 * 60 * 1000; // これ以上古い記録は「古いデータ」印を付ける

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key && key.startsWith("-")) {
      args[key.slice(1)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

/** 設定の穴埋め（プロパティインスペクタ未設定でもそれらしく動くように） */
function withDefaults(settings) {
  const s = settings && typeof settings === "object" ? settings : {};
  const provider = s.provider === "claude" ? "claude" : "codex";
  const allowedWindows = provider === "claude" ? ["5h", "weekly", "weekly_opus"] : ["5h", "weekly"];
  const window = allowedWindows.includes(s.window) ? s.window : "weekly";
  const refreshSeconds = Math.max(MIN_REFRESH_SECONDS, Number(s.refreshSeconds) || DEFAULT_REFRESH_SECONDS);
  return {
    provider,
    window,
    label: typeof s.label === "string" && s.label.trim() ? s.label.trim() : provider.toUpperCase(),
    lang: s.lang === "en" ? "en" : "ja",
    accent: typeof s.accent === "string" && s.accent.trim() ? s.accent.trim() : null,
    refreshSeconds,
  };
}

class Plugin {
  constructor(args) {
    this.args = args;
    /** @type {Map<string, {settings: object, lastRenderAt: number}>} */
    this.contexts = new Map();
    this.propertyInspectors = new Set();
    this.ws = new WsClient({ port: Number(args.port) });
  }

  start() {
    this.ws.on("open", () => {
      this.ws.send({ event: this.args.registerEvent, uuid: this.args.pluginUUID });
      this.timer = setInterval(() => this.tick(), TICK_MS);
      if (this.timer.unref) this.timer.unref();
    });
    this.ws.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      this.handleEvent(message).catch((err) => this.log(`イベント処理に失敗: ${String(err)}`));
    });
    this.ws.on("error", (err) => this.log(`WebSocket エラー: ${String(err && err.message ? err.message : err)}`));
    this.ws.on("close", () => process.exit(0));
    this.ws.connect();
  }

  log(message) {
    this.ws.send({ event: "logMessage", payload: { message: `[ai-usage] ${message}` } });
  }

  async handleEvent(message) {
    const { event, context } = message;
    switch (event) {
      case "willAppear":
        this.contexts.set(context, { settings: message.payload && message.payload.settings, lastRenderAt: 0 });
        await this.refreshContext(context);
        break;
      case "willDisappear":
        this.contexts.delete(context);
        break;
      case "didReceiveSettings": {
        const entry = this.contexts.get(context);
        if (entry) entry.settings = message.payload && message.payload.settings;
        await this.refreshContext(context, { force: true });
        break;
      }
      case "keyDown":
        // 押したら即時再取得（キャッシュを無視）
        await this.refreshContext(context, { force: true });
        this.ws.send({ event: "showOk", context });
        break;
      case "propertyInspectorDidAppear":
        this.propertyInspectors.add(context);
        await this.sendStatusToPI(context);
        break;
      case "propertyInspectorDidDisappear":
        this.propertyInspectors.delete(context);
        break;
      case "sendToPlugin":
        if (message.payload && message.payload.command === "refresh") {
          await this.refreshContext(context, { force: true });
          await this.sendStatusToPI(context);
        }
        break;
      default:
        break;
    }
  }

  tick() {
    const now = Date.now();
    for (const [context, entry] of this.contexts) {
      const settings = withDefaults(entry.settings);
      if (now - entry.lastRenderAt < settings.refreshSeconds * 1000) continue;
      this.refreshContext(context).catch((err) => this.log(`更新に失敗: ${String(err)}`));
    }
  }

  /** 1 キー分のスナップショットを取り、描画する */
  async buildState(settings, options = {}) {
    const snapshot = await getUsage(settings.provider, {
      ttlMs: Math.max(MIN_REFRESH_SECONDS, settings.refreshSeconds) * 1000,
      force: Boolean(options.force),
    });
    const win = snapshot.windows ? snapshot.windows[settings.window] : null;
    const observedAt = snapshot.observedAt ? new Date(snapshot.observedAt).getTime() : 0;
    const stale = !snapshot.ok || (observedAt > 0 && Date.now() - observedAt > STALE_AFTER_MS);
    return {
      snapshot,
      window: win,
      svg: renderKeySvg({
        provider: settings.provider === "claude" && settings.window === "weekly_opus" ? "claude_opus" : settings.provider,
        label: settings.label,
        window: settings.window,
        remainingPercent: win ? win.remainingPercent : null,
        resetAt: win && win.resetAt ? new Date(win.resetAt) : null,
        lang: settings.lang,
        accent: settings.accent,
        stale,
      }),
    };
  }

  async refreshContext(context, options = {}) {
    const entry = this.contexts.get(context);
    if (!entry) return;
    const settings = withDefaults(entry.settings);
    const state = await this.buildState(settings, options);
    entry.lastRenderAt = Date.now();
    entry.lastState = state;
    this.ws.send({ event: "setImage", context, payload: { image: toDataUri(state.svg), target: 0 } });
    this.ws.send({ event: "setTitle", context, payload: { title: "", target: 0 } });
    if (!state.snapshot.ok && state.snapshot.error) this.log(`${settings.provider}: ${state.snapshot.error}`);
    for (const pi of this.propertyInspectors) {
      if (pi === context) await this.sendStatusToPI(context);
    }
  }

  /** プロパティインスペクタに現在の取得状況を返す（設定画面での確認用） */
  async sendStatusToPI(context) {
    const entry = this.contexts.get(context);
    if (!entry) return;
    const settings = withDefaults(entry.settings);
    const state = entry.lastState || (await this.buildState(settings));
    const win = state.window;
    this.ws.send({
      event: "sendToPropertyInspector",
      context,
      action: "jp.rakutenroom.aiusage.meter",
      payload: {
        ok: Boolean(state.snapshot.ok && win),
        error: state.snapshot.error || (win ? null : `${settings.window} の情報が取得できていません`),
        source: state.snapshot.source,
        remainingPercent: win ? win.remainingPercent : null,
        resetAt: win && win.resetAt ? new Date(win.resetAt).toISOString() : null,
        remainingText: win && win.resetAt ? formatRemaining(new Date(win.resetAt).getTime() - Date.now()) : null,
        availableWindows: Object.keys(state.snapshot.windows || {}),
        accents: ACCENTS,
      },
    });
  }
}

const args = parseArgs(process.argv.slice(2));
if (!args.port || !args.registerEvent || !args.pluginUUID) {
  console.error("Stream Deck から起動してください（-port / -pluginUUID / -registerEvent が必要）");
  process.exit(1);
}
new Plugin(args).start();
