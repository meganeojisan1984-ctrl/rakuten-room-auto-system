import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { validateBrowserPostBundle, verifyBrowserPostImage } from '../src/browser-post-bundle';
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
function chunk(type:string, data:Buffer) {
  const b=Buffer.alloc(data.length+12); b.writeUInt32BE(data.length); b.write(type,4); data.copy(b,8);
  let c=0xffffffff; for(const x of b.subarray(4,-4)){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);} b.writeUInt32BE((c^0xffffffff)>>>0,b.length-4); return b;
}
function png(){const h=Buffer.alloc(13);h.writeUInt32BE(1);h.writeUInt32BE(1,4);h[8]=8;h[9]=6;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.from([0,255,0,0,255]))),chunk('IEND',Buffer.alloc(0))]);}
function fixture(t:any) {
  const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'browser-bundle-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const item={roomCollectUrl:'https://room.rakuten.co.jp/mix/collect?itemcode=12345',itemCode:'shop:product',itemName:'Test product',itemUrl:'https://item.rakuten.co.jp/shop/product/',itemPrice:1000,itemCaption:'Description',imageUrl:'https://example.com/image.jpg',shopName:'Shop',pointRate:1,hasCoupon:false,hasPointBonus:false,availability:1,secret:'must strip'};
  const contents:Record<string,Buffer>={product:Buffer.from(JSON.stringify(item)),prompt:Buffer.from('/showcase\nTest product'),caption:Buffer.from('商品のご紹介'),image:png()};
  const m:any={version:1,id:'test-bundle',item:{itemCode:item.itemCode,itemName:item.itemName,itemUrl:item.itemUrl,roomCollectUrl:item.roomCollectUrl},files:{},provenance:{source:'ChatGPT Web',model:'user-selected model',mode:'image generation',generatedAt:'2026-11-11T00:00:00Z'},review:{reviewer:'operator',reviewedAt:'2026-11-11T00:01:00Z',visualFidelity:true,groundedCopy:true,productDestination:true,hashes:{}}};
  for(const [k,b] of Object.entries(contents)){m.files[k]={path:k,sha256:hash(b)};m.review.hashes[k]=hash(b);fs.writeFileSync(path.join(dir,k),b);}m.files.image.mimeType='image/png';
  const manifest=path.join(dir,'manifest.json');
  const save=()=>{fs.writeFileSync(manifest,JSON.stringify(m));return manifest;};
  const replace=(k:string,b:Buffer)=>{fs.writeFileSync(path.join(dir,k),b);m.files[k].sha256=hash(b);m.review.hashes[k]=hash(b);};
  return {dir,m,item,save,replace};
}
test('valid bundle binds exact bytes, strips extras and keeps immutable image snapshot',t=>{
 const f=fixture(t),result=validateBrowserPostBundle(f.save());assert.equal(result.item.itemCode,f.item.itemCode);assert.equal((result.item as any).secret,undefined);assert.equal(result.caption,'商品のご紹介');assert.equal(result.manifestHash,hash(fs.readFileSync(f.save())));
 const bytes=result.image.bytes;bytes.fill(0);fs.writeFileSync(path.join(f.dir,'image'),'changed');assert.deepEqual(verifyBrowserPostImage(result.image,result.item.itemCode),png());
 assert.throws(()=>verifyBrowserPostImage(result.image,'other:product'),/itemCode/);assert.throws(()=>verifyBrowserPostImage({...result.image,bytes:Buffer.from('tampered')},result.item.itemCode),/hash/);
});
for(const key of ['product','prompt','caption','image']) test(`${key} changed bytes rejected`,t=>{const f=fixture(t);fs.appendFileSync(path.join(f.dir,key),'x');assert.throws(()=>validateBrowserPostBundle(f.save()),/hash mismatch/);});
for(const key of ['product','prompt','caption','image']) test(`${key} stale review rejected`,t=>{const f=fixture(t);f.m.review.hashes[key]='0'.repeat(64);assert.throws(()=>validateBrowserPostBundle(f.save()),/review .* hash mismatch/);});
for(const key of ['itemCode','itemName','itemUrl']) test(`selected ${key} mismatch rejected`,t=>{const f=fixture(t);f.m.item[key]=key==='itemUrl'?'https://item.rakuten.co.jp/shop/other/':'wrong';assert.throws(()=>validateBrowserPostBundle(f.save()),/selected product mismatch/);});
test('product URL/code mismatch rejected',t=>{const f=fixture(t);f.item.itemCode='other:product';f.replace('product',Buffer.from(JSON.stringify(f.item)));assert.throws(()=>validateBrowserPostBundle(f.save()),/itemCode\/URL/);});
test('required production fields required',t=>{const f=fixture(t);delete (f.item as any).hasCoupon;f.replace('product',Buffer.from(JSON.stringify(f.item)));assert.throws(()=>validateBrowserPostBundle(f.save()),/flags/);});
for(const caption of ['', '😀'.repeat(251)]) test(`invalid caption ${caption.length} units`,t=>{const f=fixture(t);f.replace('caption',Buffer.from(caption));assert.throws(()=>validateBrowserPostBundle(f.save()));});
test('exact 500 UTF-16 units accepted',t=>{const f=fixture(t);f.replace('caption',Buffer.from('😀'.repeat(250)));assert.equal(validateBrowserPostBundle(f.save()).caption.length,500);});
for(const prompt of [' /showcase test','/showcaseevil','\uFEFF/showcase test']) test('non-exact showcase prefix rejected',t=>{const f=fixture(t);f.replace('prompt',Buffer.from(prompt));assert.throws(()=>validateBrowserPostBundle(f.save()),/prompt/);});
for(const p of ['../outside','/etc/passwd','sub/../../image','sub\\image']) test(`unsafe path ${p}`,t=>{const f=fixture(t);f.m.files.image.path=p;assert.throws(()=>validateBrowserPostBundle(f.save()),/relative descendant/);});
test('file symlink rejected',t=>{const f=fixture(t);fs.renameSync(path.join(f.dir,'image'),path.join(f.dir,'real'));fs.symlinkSync('real',path.join(f.dir,'image'));assert.throws(()=>validateBrowserPostBundle(f.save()),/symlink/);});
test('directory symlink rejected',t=>{const f=fixture(t);fs.mkdirSync(path.join(f.dir,'real'));fs.renameSync(path.join(f.dir,'image'),path.join(f.dir,'real/image'));fs.symlinkSync('real',path.join(f.dir,'alias'));f.m.files.image.path='alias/image';assert.throws(()=>validateBrowserPostBundle(f.save()),/symlink/);});
test('oversized image rejected before reading',t=>{const f=fixture(t);fs.truncateSync(path.join(f.dir,'image'),8*1024*1024+1);assert.throws(()=>validateBrowserPostBundle(f.save()),/oversized/);});
for(const mime of ['image/gif','image/jpeg']) test(`invalid image MIME ${mime}`,t=>{const f=fixture(t);f.m.files.image.mimeType=mime;assert.throws(()=>validateBrowserPostBundle(f.save()),/MIME|JPEG/);});
for(const b of [Buffer.from('89504e470d0a1a0a','hex'),png().subarray(0,-1),Buffer.from('<svg/>')]) test('malformed PNG rejected',t=>{const f=fixture(t);f.replace('image',b);assert.throws(()=>validateBrowserPostBundle(f.save()),/PNG/);});
test('PNG CRC mismatch rejected',t=>{const f=fixture(t);const b=png();b[30]^=1;f.replace('image',b);assert.throws(()=>validateBrowserPostBundle(f.save()),/CRC/);});
test('fake JPEG markers rejected',t=>{const f=fixture(t);f.m.files.image.mimeType='image/jpeg';f.replace('image',Buffer.from([255,216,255,217]));assert.throws(()=>validateBrowserPostBundle(f.save()),/JPEG/);});
test('unreviewed bundle rejected',t=>{const f=fixture(t);delete f.m.review;assert.throws(()=>validateBrowserPostBundle(f.save()));});
test('false fidelity claim rejected',t=>{const f=fixture(t);f.m.review.visualFidelity=false;assert.throws(()=>validateBrowserPostBundle(f.save()),/review claims/);});
test('provenance source required',t=>{const f=fixture(t);f.m.provenance.source='API';assert.throws(()=>validateBrowserPostBundle(f.save()),/provenance/);});
test('malformed UTF-8 and JSON rejected',t=>{const f=fixture(t);f.replace('product',Buffer.from([0xff]));assert.throws(()=>validateBrowserPostBundle(f.save()));});

test('valid JPEG structure accepted',t=>{const f=fixture(t);f.m.files.image.mimeType='image/jpeg';f.replace('image',Buffer.from('/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+L6KKK/lM/38P//Z','base64'));assert.equal(validateBrowserPostBundle(f.save()).image.mimeType,'image/jpeg');});

test('Rakuten item ID may differ from canonical URL slug',t=>{const f=fixture(t);f.item.itemCode='shop:10000001';f.m.item.itemCode=f.item.itemCode;f.replace('product',Buffer.from(JSON.stringify(f.item)));assert.equal(validateBrowserPostBundle(f.save()).item.itemCode,'shop:10000001');});

test('caption CRLF is rejected rather than normalized after review',t=>{const f=fixture(t);f.replace('caption',Buffer.from('line\r\nline'));assert.throws(()=>validateBrowserPostBundle(f.save()),/LF_NEWLINES/);});
for (const mode of ['missing','duplicate','host','mismatch','unreviewed']) test('collect destination binding rejects '+mode,t=>{
 const f=fixture(t); if(mode==='missing')delete (f.item as any).roomCollectUrl; if(mode==='duplicate')f.item.roomCollectUrl+='&itemcode=99'; if(mode==='host')f.item.roomCollectUrl=f.item.roomCollectUrl.replace('room.rakuten.co.jp','evil.test'); if(mode==='mismatch')f.m.item.roomCollectUrl=f.item.roomCollectUrl.replace('12345','999'); if(mode==='unreviewed')f.m.review.productDestination=false;
 f.replace('product',Buffer.from(JSON.stringify(f.item))); assert.throws(()=>validateBrowserPostBundle(f.save()));
});
