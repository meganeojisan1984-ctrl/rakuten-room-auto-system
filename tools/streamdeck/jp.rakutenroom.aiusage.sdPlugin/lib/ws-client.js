"use strict";
/**
 * 依存パッケージ無しの最小 WebSocket クライアント（RFC 6455 / テキストフレームのみ）。
 * Stream Deck のプラグイン Node ランタイムは npm install 済みモジュールを持たないため、
 * net + crypto だけで localhost のプラグイン用 WebSocket に接続する。
 */

const net = require("net");
const crypto = require("crypto");
const { EventEmitter } = require("events");

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const OPCODE = { CONTINUATION: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

/** クライアント→サーバのフレームは必ずマスクする */
function encodeFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), "utf8");
  const length = data.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode; // FIN + opcode
  const mask = crypto.randomBytes(4);
  const masked = Buffer.allocUnsafe(length);
  for (let i = 0; i < length; i++) masked[i] = data[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

/**
 * バッファから 1 フレーム取り出す。足りなければ null。
 * @returns {{fin: boolean, opcode: number, payload: Buffer, rest: Buffer}|null}
 */
function decodeFrame(buffer) {
  if (buffer.length < 2) return null;
  const fin = (buffer[0] & 0x80) !== 0;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    const big = buffer.readBigUInt64BE(offset);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("フレームが大きすぎます");
    length = Number(big);
    offset += 8;
  }
  let mask = null;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  return { fin, opcode, payload, rest: buffer.subarray(offset + length) };
}

class WsClient extends EventEmitter {
  /** @param {{port: number, host?: string, path?: string}} options */
  constructor(options) {
    super();
    this.port = options.port;
    this.host = options.host || "127.0.0.1";
    this.path = options.path || "/";
    this.socket = null;
    this.handshaked = false;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOpcode = null;
  }

  connect() {
    const key = crypto.randomBytes(16).toString("base64");
    this.expectedAccept = crypto.createHash("sha1").update(key + GUID).digest("base64");
    this.socket = net.connect({ host: this.host, port: this.port }, () => {
      this.socket.write(
        [
          `GET ${this.path} HTTP/1.1`,
          `Host: ${this.host}:${this.port}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n")
      );
    });
    this.socket.on("data", (chunk) => this._onData(chunk));
    this.socket.on("error", (err) => this.emit("error", err));
    this.socket.on("close", () => this.emit("close"));
    return this;
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (!this.handshaked) {
      const end = this.buffer.indexOf("\r\n\r\n");
      if (end === -1) return;
      const header = this.buffer.subarray(0, end).toString("utf8");
      this.buffer = this.buffer.subarray(end + 4);
      if (!/^HTTP\/1\.1 101/i.test(header)) {
        this.emit("error", new Error(`WebSocket ハンドシェイク失敗: ${header.split("\r\n")[0]}`));
        this.close();
        return;
      }
      this.handshaked = true;
      this.emit("open");
    }
    this._drain();
  }

  _drain() {
    for (;;) {
      let frame;
      try {
        frame = decodeFrame(this.buffer);
      } catch (err) {
        this.emit("error", err);
        this.close();
        return;
      }
      if (!frame) return;
      this.buffer = frame.rest;
      this._handleFrame(frame);
    }
  }

  _handleFrame(frame) {
    switch (frame.opcode) {
      case OPCODE.PING:
        this._write(encodeFrame(OPCODE.PONG, frame.payload));
        return;
      case OPCODE.PONG:
        return;
      case OPCODE.CLOSE:
        this.close();
        return;
      case OPCODE.CONTINUATION:
        this.fragments.push(frame.payload);
        break;
      default:
        this.fragments = [frame.payload];
        this.fragmentOpcode = frame.opcode;
    }
    if (!frame.fin) return;
    const payload = Buffer.concat(this.fragments);
    this.fragments = [];
    if (this.fragmentOpcode === OPCODE.TEXT) this.emit("message", payload.toString("utf8"));
    this.fragmentOpcode = null;
  }

  _write(buffer) {
    if (this.socket && !this.socket.destroyed) this.socket.write(buffer);
  }

  /** @param {string|object} message */
  send(message) {
    const text = typeof message === "string" ? message : JSON.stringify(message);
    this._write(encodeFrame(OPCODE.TEXT, text));
  }

  close() {
    if (!this.socket || this.socket.destroyed) return;
    try {
      this._write(encodeFrame(OPCODE.CLOSE, Buffer.alloc(0)));
    } catch {}
    this.socket.destroy();
  }
}

module.exports = { WsClient, encodeFrame, decodeFrame, OPCODE };
