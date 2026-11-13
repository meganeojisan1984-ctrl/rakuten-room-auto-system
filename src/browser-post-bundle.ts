/** Local byte-integrity checks only. Provenance and review are unverified claims,
 * not proof of model identity, visual fidelity, or legal/policy authorization. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import type { RakutenItem } from './fetcher';

export interface BrowserPostImage {
  readonly itemCode: string;
  readonly path: string;
  readonly sha256: string;
  readonly mimeType: 'image/png' | 'image/jpeg';
  /** A fresh copy of the immutable, validated snapshot on every access. */
  readonly bytes: Buffer;
}
export interface ValidatedBrowserPostBundle {
  readonly manifestId: string;
  readonly manifestHash: string;
  readonly collectUrl: string;
  readonly item: RakutenItem;
  readonly caption: string;
  readonly prompt: string;
  readonly image: BrowserPostImage;
}
const MAX_IMAGE = 8 * 1024 * 1024;
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(`Browser post bundle: ${message}`); }
function obj(v: unknown): Record<string, any> { check(v !== null && typeof v === 'object' && !Array.isArray(v), 'expected object'); return v as Record<string, any>; }
function str(v: unknown, max = 4096): string { check(typeof v === 'string' && v.trim().length > 0 && v.length <= max && !v.includes('\0'), 'invalid string'); return v; }
function digest(v: unknown): string { check(typeof v === 'string' && /^[a-f0-9]{64}$/.test(v), 'invalid SHA-256'); return v; }
function date(v: unknown) { check(typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v) && Number.isFinite(Date.parse(v)), 'invalid timestamp'); return Date.parse(v); }
function noSymlinks(p: string) {
  let current = path.parse(p).root;
  for (const part of p.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    check(!fs.lstatSync(current).isSymbolicLink(), 'symlink rejected');
  }
}
function read(p: string, max: number): Buffer {
  noSymlinks(p);
  const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd);
    check(before.isFile() && before.size > 0 && before.size <= max, 'file missing, empty, nonregular, or oversized');
    const b = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < b.length) { const n = fs.readSync(fd, b, offset, b.length - offset, offset); check(n > 0, 'file changed during read'); offset += n; }
    const after = fs.fstatSync(fd);
    noSymlinks(p);
    const named = fs.statSync(p);
    check(before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && named.ino === after.ino && named.dev === after.dev, 'file changed during read');
    return b;
  } finally { fs.closeSync(fd); }
}
function utf8(b: Buffer): string { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(b); }
function json(b: Buffer) { return obj(JSON.parse(utf8(b))); }
function crc32(b: Buffer) { let c = 0xffffffff; for (const v of b) { c ^= v; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }
function dimensions(w: number, h: number) { check(w > 0 && h > 0 && w <= 10000 && h <= 10000 && w * h <= 20_000_000, 'invalid image dimensions'); }
function validateImage(b: Buffer, mime: string) {
  check(b.length > 0 && b.length <= MAX_IMAGE, 'oversized/empty image');
  if (mime === 'image/png') {
    check(b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'invalid PNG signature');
    let pos = 8, width = 0, height = 0, depth = 0, color = 0, ended = false, idatEnded = false, palette = false;
    const data: Buffer[] = [];
    while (pos < b.length) {
      check(pos + 12 <= b.length, 'truncated PNG chunk');
      const n = b.readUInt32BE(pos), end = pos + 12 + n;
      check(end <= b.length, 'truncated PNG payload');
      const type = b.toString('ascii', pos + 4, pos + 8), payload = b.subarray(pos + 8, pos + 8 + n);
      check(/^[A-Za-z]{4}$/.test(type) && crc32(b.subarray(pos + 4, pos + 8 + n)) === b.readUInt32BE(pos + 8 + n), 'invalid PNG CRC/type');
      check(pos !== 8 || type === 'IHDR', 'PNG IHDR required first');
      if (type === 'IHDR') {
        check(pos === 8 && n === 13, 'invalid PNG IHDR');
        width = payload.readUInt32BE(0); height = payload.readUInt32BE(4); dimensions(width, height);
        depth = payload[8]!; color = payload[9]!;
        check(({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]} as Record<number, number[]>)[color]?.includes(depth), 'unsupported PNG color/depth');
        check(payload[10] === 0 && payload[11] === 0 && payload[12] === 0, 'unsupported PNG compression/filter/interlace');
      } else if (type === 'PLTE') {
        check(!palette && !data.length && n > 0 && n % 3 === 0 && n <= 768 && color !== 0 && color !== 4, 'invalid PNG palette'); palette = true;
      } else if (type === 'IDAT') { check(!idatEnded && (color !== 3 || palette), 'invalid PNG IDAT order'); data.push(payload); }
      else if (type === 'IEND') { check(n === 0 && data.length > 0 && end === b.length, 'invalid PNG IEND'); ended = true; }
      else { check(type[0] === type[0]!.toLowerCase(), 'unknown critical PNG chunk'); }
      if (data.length && type !== 'IDAT') idatEnded = true;
      pos = end;
    }
    check(ended, 'PNG missing IEND');
    const channels = ({0:1,2:3,3:1,4:2,6:4} as Record<number,number>)[color]!;
    const row = Math.ceil(width * channels * depth / 8) + 1;
    check(row * height <= 160_000_000, 'PNG decoded size too large');
    const decoded = inflateSync(Buffer.concat(data), {maxOutputLength: row * height + 1});
    check(decoded.length === row * height, 'invalid PNG scanline size');
    for (let y = 0; y < height; y++) check(decoded[y * row]! <= 4, 'invalid PNG filter');
  } else {
    check(mime === 'image/jpeg' && b[0] === 0xff && b[1] === 0xd8, 'invalid image MIME/JPEG signature');
    let p = 2, frame = false, scan = false, ended = false, quant = false, huffman = false;
    while (p < b.length) {
      check(b[p++] === 0xff, 'invalid JPEG marker');
      while (b[p] === 0xff) p++;
      const marker = b[p++];
      if (marker === 0xd9) { check(frame && scan && quant && huffman && p === b.length, 'invalid JPEG EOI'); ended = true; break; }
      check(marker !== undefined && marker !== 0 && marker !== 0xd8 && !(marker >= 0xd0 && marker <= 0xd7) && p + 2 <= b.length, 'invalid JPEG segment');
      const n = b.readUInt16BE(p); check(n >= 2 && p + n <= b.length, 'truncated JPEG segment');
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        check(!frame && n >= 11 && b[p+2] === 8, 'invalid JPEG frame');
        dimensions(b.readUInt16BE(p+5), b.readUInt16BE(p+3));
        const components = b[p+7]!; check([1,3,4].includes(components) && n === 8 + 3 * components, 'invalid JPEG components'); frame = true;
      } else if (marker === 0xdb) {
        let q = p + 2;
        while (q < p + n) {
          const info = b[q++]!;
          check((info >> 4) <= 1 && (info & 15) <= 3, 'invalid JPEG quantization table');
          q += 64 * ((info >> 4) + 1);
          check(q <= p + n, 'truncated JPEG quantization table');
        }
        check(q === p + n && n > 2, 'invalid JPEG quantization table'); quant = true;
      } else if (marker === 0xc4) {
        let q = p + 2;
        while (q < p + n) {
          check(q + 17 <= p + n, 'truncated JPEG Huffman table');
          const info = b[q++]!;
          check((info >> 4) <= 1 && (info & 15) <= 3, 'invalid JPEG Huffman table');
          let count = 0, remaining = 1;
          for (let i = 0; i < 16; i++) { const k = b[q++]!; count += k; remaining = remaining * 2 - k; check(remaining >= 0, 'oversubscribed JPEG Huffman table'); }
          check(count > 0 && count <= 256 && q + count <= p + n, 'invalid JPEG Huffman symbols'); q += count;
        }
        check(n > 2, 'empty JPEG Huffman table'); huffman = true;
      } else if (marker === 0xdd) {
        check(n === 4, 'invalid JPEG restart interval');
      } else if (marker === 0xda) {
        check(frame && n >= 8 && n === 6 + 2 * b[p+2]!, 'invalid JPEG scan'); scan = true;
      } else check([0xc4,0xdb,0xdd,0xfe,...Array.from({length:16},(_,i)=>0xe0+i)].includes(marker), 'unsupported JPEG marker');
      p += n;
      if (marker === 0xda) {
        const start = p;
        while (p < b.length) {
          if (b[p] !== 0xff) { p++; continue; }
          if (b[p+1] === 0 || (b[p+1]! >= 0xd0 && b[p+1]! <= 0xd7)) { p += 2; continue; }
          break;
        }
        check(p > start, 'empty JPEG scan');
      }
    }
    check(ended, 'JPEG missing EOI');
  }
}
function canonical(v: unknown): string {
  const s = str(v); const u = new URL(s);
  check(u.protocol === 'https:' && u.hostname === 'item.rakuten.co.jp' && !u.port && !u.username && !u.password && !u.search && !u.hash && /^\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+\/$/.test(u.pathname) && u.href === s, 'noncanonical Rakuten product URL'); return s;
}
export function canonicalRoomCollectUrl(value: unknown): string {
  const url = new URL(str(value));
  const codes = url.searchParams.getAll("itemcode");
  check(url.protocol === "https:" && url.hostname === "room.rakuten.co.jp" && !url.port && !url.username && !url.password && !url.hash && url.pathname === "/mix/collect" && codes.length === 1 && /^\d{1,30}$/.test(codes[0]!), "invalid ROOM collect URL");
  return url.origin + url.pathname + "?itemcode=" + codes[0];
}

function product(v: Record<string, any>): RakutenItem {
  const itemCode = str(v.itemCode), itemUrl = canonical(v.itemUrl);
  check(/^[a-zA-Z0-9_-]+:[a-zA-Z0-9_.-]+$/.test(itemCode), 'invalid itemCode');
  check(new URL(itemUrl).pathname.split('/')[1] === itemCode.split(':')[0], 'itemCode/URL mismatch');
  for (const k of ['itemPrice','pointRate']) check(typeof v[k] === 'number' && Number.isFinite(v[k]) && v[k] >= 0, `invalid ${k}`);
  check(v.availability === 1 && typeof v.hasCoupon === 'boolean' && typeof v.hasPointBonus === 'boolean', 'invalid product availability/flags');
  check(typeof v.itemCaption === 'string' && v.itemCaption.length <= 100000, 'invalid itemCaption');
  const imageUrl = str(v.imageUrl); const u = new URL(imageUrl); check(u.protocol === 'https:' && !u.username && !u.password, 'invalid product imageUrl');
  return Object.freeze({itemCode,itemUrl,itemName:str(v.itemName),itemPrice:v.itemPrice,itemCaption:v.itemCaption,imageUrl,shopName:str(v.shopName),pointRate:v.pointRate,hasCoupon:v.hasCoupon,hasPointBonus:v.hasPointBonus,availability:v.availability});
}
export function verifyBrowserPostImage(image: BrowserPostImage, itemCode: string): Buffer {
  check(image.itemCode === itemCode, 'image itemCode mismatch');
  const bytes = Buffer.from(image.bytes);
  check(hash(bytes) === digest(image.sha256), 'image hash mismatch'); validateImage(bytes, image.mimeType); return bytes;
}
export function validateBrowserPostBundle(manifestPath: string): ValidatedBrowserPostBundle {
  const absolute = path.resolve(manifestPath), root = path.dirname(absolute), raw = read(absolute, 64 * 1024), m = json(raw);
  check(m.version === 1, 'unsupported manifest version'); const id = str(m.id,128); check(/^[A-Za-z0-9_-]+$/.test(id), 'invalid manifest id');
  const files = obj(m.files), hashes: Record<string,string> = {}, paths: Record<string,string> = {};
  const buffers: Record<string,Buffer> = {};
  for (const [key, limit] of Object.entries({product:256*1024,prompt:64*1024,caption:4096,image:MAX_IMAGE})) {
    const f = obj(files[key]), relative = str(f.path);
    check(!path.isAbsolute(relative) && !relative.includes('\\') && relative.split('/').every(x => x !== '' && x !== '.' && x !== '..'), 'path must be a relative descendant');
    const p = path.resolve(root, relative); check(p.startsWith(root + path.sep) && p !== absolute && !Object.values(paths).includes(p), 'duplicate/outside file path');
    paths[key] = p; buffers[key] = read(p, limit); hashes[key] = hash(buffers[key]!); check(hashes[key] === digest(f.sha256), `${key} hash mismatch`);
  }
  const productData = json(buffers.product!);
  const item = product(productData), selection = obj(m.item);
  const collectUrl = canonicalRoomCollectUrl(productData.roomCollectUrl);
  check(collectUrl === canonicalRoomCollectUrl(selection.roomCollectUrl), "selected collect URL mismatch");
  check(item.itemCode === selection.itemCode && item.itemName === selection.itemName && item.itemUrl === canonical(selection.itemUrl), 'selected product mismatch');
  const prompt = utf8(buffers.prompt!), caption = utf8(buffers.caption!);
  if (caption.includes("\r")) throw new Error("BROWSER_CAPTION_REQUIRES_LF_NEWLINES");
  check(/^\/showcase(?:\s|$)/.test(prompt), 'prompt must start exactly /showcase');
  check(caption.trim().length > 0 && caption.length <= 500 && !caption.includes('\0'), 'caption must be 1–500 UTF-16 units');
  const provenance = obj(m.provenance); check(provenance.source === 'ChatGPT Web', 'ChatGPT Web provenance claim required'); str(provenance.model,128); str(provenance.mode,128); const generated = date(provenance.generatedAt);
  const review = obj(m.review); str(review.reviewer,256); check(date(review.reviewedAt) >= generated, 'review predates generation');
  check(review.visualFidelity === true && review.groundedCopy === true && review.productDestination === true, 'visual fidelity and grounded copy review claims required');
  const reviewed = obj(review.hashes); for (const key of Object.keys(hashes)) check(digest(reviewed[key]) === hashes[key], `review ${key} hash mismatch`);
  const mime = files.image.mimeType; check(mime === 'image/png' || mime === 'image/jpeg', 'invalid image MIME'); validateImage(buffers.image!, mime);
  const snapshot = Buffer.from(buffers.image!);
  const image: BrowserPostImage = Object.freeze({ itemCode:item.itemCode,path:paths.image!,sha256:hashes.image!,mimeType:mime,get bytes(){return Buffer.from(snapshot);} });
  return Object.freeze({manifestId:id,manifestHash:hash(raw),collectUrl,item,caption,prompt,image});
}
