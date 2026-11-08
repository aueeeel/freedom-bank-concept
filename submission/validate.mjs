import fs from 'node:fs';
import {recordsFrom,checkSplit,validate} from './lib.mjs';
const args=process.argv.slice(2),get=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};
try{
  const file=get('file'),split=get('split');if(!file||!['dev','prod'].includes(split))throw Error('Запуск: node submission/validate.mjs --split dev|prod --file results/<split>/results.json [--input исходный-набор.json]');
  const input=get('input');const records=input?recordsFrom(JSON.parse(fs.readFileSync(input,'utf8').replace(/^\uFEFF/,''))):undefined;if(records)checkSplit(records,split);
  const stats=validate(JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')),{split,records});console.log(JSON.stringify({file,split,...stats}));
  if(args.includes('--require-success')&&stats.errors)throw Error(`В файле ${stats.errors} ошибок обработки.`);
}catch(e){console.error(e.message);process.exitCode=1;}
