import Database from 'better-sqlite3';
import {completedJstWindow,getVerifiedSalesWindow} from './sales-db';

/** Read-only handoff. Missing/stale/malformed DB never becomes a zero-sale report. */
export function verifiedSalesReport(dbPath: string, now: Date, days=14) {
  const window = completedJstWindow(now,days);
  let db: Database.Database | undefined;
  try {
    db = new Database(dbPath,{readonly:true,fileMustExist:true});
    const v=getVerifiedSalesWindow(db,window.from,window.to);
    if(v.status !== 'complete') return {schemaVersion:1,status:'incomplete',...window,missingDates:v.missingDates,orders:null,reward:null,clicks:null,decisionAllowed:false};
    return {schemaVersion:1,status:'complete',...window,oldestFetchedAt:v.oldestFetchedAt,newestFetchedAt:v.newestFetchedAt,missingDates:[],orders:v.rows.reduce((n,r)=>n+r.orders,0),reward:v.rows.reduce((n,r)=>n+r.reward,0),clicks:null,decisionAllowed:false,note:'Order-report snapshot only; commissions may be provisional. No product attribution or automated strategy change.'};
  } catch {
    return {schemaVersion:1,status:'unavailable',...window,missingDates:null,orders:null,reward:null,clicks:null,decisionAllowed:false};
  } finally { db?.close(); }
}
