import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initDb,replaceSalesDay,getVerifiedSalesWindow,completedJstWindow,getSalesByDateRange} from '../src/affiliate/sales-db';
import {parseOrderCsv} from '../src/affiliate/report-parser';
const ev={fetchedAt:'2026-11-13T03:00:00Z',sourceMonth:'2026-11',sha256:'a'.repeat(64)};
const row={date:'2026-11-12',itemCode:'shop:1',trackingId:'ROOM',clicks:0,orders:1,reward:10};
const header='"注文別成果: 2026.11"\n'+'date,rewards,rate,amount,genre_name,shop_name,item_name,status,link_type,device_type,measurement_id';
test('missing day differs from verified empty day',()=>{const db=initDb(':memory:');assert.equal(getVerifiedSalesWindow(db,row.date,row.date).rows,null);replaceSalesDay(db,row.date,[],ev);assert.deepEqual(getVerifiedSalesWindow(db,row.date,row.date).rows,[]);db.close();});
test('same-day rerun replaces rather than doubles and can correct to zero',()=>{const db=initDb(':memory:');replaceSalesDay(db,row.date,[row],ev);replaceSalesDay(db,row.date,[{...row,reward:12}],ev);assert.equal(getSalesByDateRange(db,row.date,row.date)[0].reward,12);replaceSalesDay(db,row.date,[],ev);assert.deepEqual(getVerifiedSalesWindow(db,row.date,row.date).rows,[]);db.close();});
test('failed validation preserves all previous data',()=>{const db=initDb(':memory:');replaceSalesDay(db,row.date,[row],ev);assert.throws(()=>replaceSalesDay(db,row.date,[{...row,reward:NaN}],ev));assert.equal(getSalesByDateRange(db,row.date,row.date)[0].reward,10);db.close();});
test('transaction failure rolls back deletion and coverage',()=>{const db=initDb(':memory:');replaceSalesDay(db,row.date,[row],ev);db.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON sales BEGIN SELECT RAISE(ABORT,'test failure'); END");assert.throws(()=>replaceSalesDay(db,row.date,[{...row,reward:20}],ev));assert.equal(getSalesByDateRange(db,row.date,row.date)[0].reward,10);assert.equal(getVerifiedSalesWindow(db,row.date,row.date).status,'complete');db.close();});
test('missing day blocks full window and row-count mismatch is unknown',()=>{const db=initDb(':memory:');replaceSalesDay(db,row.date,[row],ev);assert.deepEqual(getVerifiedSalesWindow(db,'2026-11-11',row.date).missingDates,['2026-11-11']);db.exec("DELETE FROM sales");assert.equal(getVerifiedSalesWindow(db,row.date,row.date).status,'missing');db.close();});
test('JST completed window excludes current day and contains exactly N days',()=>{assert.deepEqual(completedJstWindow(new Date('2026-11-12T22:00:00Z'),14),{from:'2026-10-29',to:'2026-11-11'});assert.throws(()=>completedJstWindow(new Date('bad'),14));});
test('strict CSV accepts valid empty report but rejects truncation and bad reward/date',()=>{assert.deepEqual(parseOrderCsv(header+'\n',{targetDate:row.date,strict:true}),[]);for(const line of ['bad,row','"2026-11-12 01:00:00",oops,3,100,g,s,i,0,1,1,ROOM','"2026-10-12 01:00:00",10,3,100,g,s,i,0,1,1,ROOM','"2026-11-31 01:00:00",10,3,100,g,s,i,0,1,1,ROOM']) assert.throws(()=>parseOrderCsv(header+'\n'+line,{targetDate:row.date,strict:true}));});
test('strict CSV valid row preserves stable mapping',()=>{const rows=parseOrderCsv(header+'\n"2026-11-12 01:00:00",10,3,100,g,s,i,0,1,1,ROOM',{targetDate:row.date,strict:true});assert.equal(rows.length,1);assert.equal(rows[0].reward,10);});
test('invalid coverage evidence or duplicate key never writes',()=>{const db=initDb(':memory:');assert.throws(()=>replaceSalesDay(db,row.date,[row,row],ev));assert.throws(()=>replaceSalesDay(db,row.date,[row],{...ev,sourceMonth:'2026-10'}));assert.equal(getVerifiedSalesWindow(db,row.date,row.date).status,'missing');db.close();});
import {verifiedSalesReport} from '../src/affiliate/verified-sales-report';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
test('report missing DB is unknown and does not create DB',()=>{const d=mkdtempSync(join(tmpdir(),'sales-'));try{const p=join(d,'missing.sqlite');const r=verifiedSalesReport(p,new Date('2026-11-13T03:00:00Z'),1);assert.equal(r.status,'unavailable');assert.equal(r.reward,null);assert.equal(existsSync(p),false);}finally{rmSync(d,{recursive:true});}});
test('report is read-only and distinguishes known zero from missing coverage',()=>{const d=mkdtempSync(join(tmpdir(),'sales-'));try{const p=join(d,'db.sqlite');const db=initDb(p);replaceSalesDay(db,row.date,[],ev);db.close();const r=verifiedSalesReport(p,new Date('2026-11-13T03:00:00Z'),1);assert.equal(r.status,'complete');assert.equal(r.reward,0);assert.equal(r.clicks,null);assert.equal(r.decisionAllowed,false);const other=verifiedSalesReport(p,new Date('2026-11-13T03:00:00Z'),2);assert.equal(other.reward,null);}finally{rmSync(d,{recursive:true});}});

test('strict parser rejects missing date, invalid time and unverified report month',()=>{
 for(const line of [',10,3,100,g,s,i,0,1,1,ROOM','"2026-11-12 99:99:99",10,3,100,g,s,i,0,1,1,ROOM']) assert.throws(()=>parseOrderCsv(header+'\n'+line,{targetDate:row.date,strict:true}));
 assert.throws(()=>parseOrderCsv(header.replace('2026.11','2026.10'),{targetDate:row.date,strict:true}));
});
test('same-row-count tampering invalidates verified evidence',()=>{const db=initDb(':memory:');replaceSalesDay(db,row.date,[row],ev);db.exec('UPDATE sales SET reward=99');assert.equal(getVerifiedSalesWindow(db,row.date,row.date).status,'missing');db.close();});

import {latestAvailableSalesDay} from '../src/affiliate/sales-db';
test('official noon JST boundary prevents premature zero coverage',()=>{
 assert.equal(latestAvailableSalesDay(new Date('2026-11-13T02:59:59Z')),'2026-11-11');
 assert.equal(latestAvailableSalesDay(new Date('2026-11-13T03:00:00Z')),'2026-11-12');
 const db=initDb(':memory:');
 assert.throws(()=>replaceSalesDay(db,row.date,[],{...ev,fetchedAt:'2026-11-13T02:59:59Z'}));
 assert.equal(getVerifiedSalesWindow(db,row.date,row.date).status,'missing');
 replaceSalesDay(db,row.date,[],ev);
 db.prepare('UPDATE sales_coverage SET fetched_at=?').run('2026-11-13T02:00:00Z');
 assert.equal(getVerifiedSalesWindow(db,row.date,row.date).status,'missing');db.close();
});
