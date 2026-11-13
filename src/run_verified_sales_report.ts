import { verifiedSalesReport } from './affiliate/verified-sales-report';
import {writeFileSync,renameSync,mkdirSync} from 'fs';
import {dirname,resolve} from 'path';
const output=resolve('data/verified-sales-report.json');
const report=verifiedSalesReport(resolve('data/sales.sqlite'),new Date());
mkdirSync(dirname(output),{recursive:true});
const temp=output+'.'+process.pid+'.tmp';
writeFileSync(temp,JSON.stringify(report,null,2)+'\n',{flag:'wx'});renameSync(temp,output);
console.log(JSON.stringify({status:report.status,from:report.from,to:report.to,decisionAllowed:false}));
