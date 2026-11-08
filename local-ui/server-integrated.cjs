const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const port=Number(process.env.PORT||4173);
const backendPort=Number(process.env.CQA_BACKEND_PORT||8088);
const root=path.join(__dirname,'dist');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.mjs':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4','.webm':'video/webm','.woff2':'font/woff2','.ttf':'font/ttf'};
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
http.createServer((req,res)=>{
 let parsed;try{parsed=new URL(req.url,'http://127.0.0.1:'+port);}catch{return json(res,400,{error:'Неверный адрес'});}
 if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host))return json(res,403,{error:'Host запрещён'});
 if(parsed.pathname.startsWith('/api/')){
  const origin=req.headers.origin;
  if(origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(origin))return json(res,403,{error:'Origin запрещён'});
  if(!['GET','POST'].includes(req.method))return json(res,405,{error:'Метод не поддерживается'});
  const target=parsed.pathname.startsWith('/api/cqa/')?'/api/'+parsed.pathname.slice('/api/cqa/'.length):parsed.pathname;
  const headers={...req.headers,host:'127.0.0.1:'+backendPort,origin:'http://127.0.0.1:'+backendPort,'x-cqa-client':'web'};
  delete headers.cookie;delete headers.authorization;
  const upstream=http.request({host:'127.0.0.1',port:backendPort,path:target+parsed.search,method:req.method,headers},response=>{
   const replyHeaders={...response.headers};delete replyHeaders['access-control-allow-origin'];delete replyHeaders['access-control-allow-credentials'];
   res.writeHead(response.statusCode,replyHeaders);response.pipe(res);
  });
  upstream.on('error',()=>{if(!res.headersSent)json(res,503,{error:'Сервер CQA не запущен. Откройте «Запустить Freedom CQA.cmd».'});else res.end();});
  upstream.setTimeout(30000,()=>upstream.destroy());req.pipe(upstream);return;
 }
 if(parsed.pathname==='/model-lab.html'){
  const reportPath=path.resolve(__dirname,'../docs/benchmark_report.html');
  fs.readFile(reportPath,(error,body)=>{if(error)return json(res,404,{error:'Отчёт тестирования ещё не создан'});
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   res.end(req.method==='HEAD'?undefined:body);});return;
 }
 let filename;try{const decoded=decodeURIComponent(parsed.pathname);if(decoded.split('/').some(x=>x.startsWith('.')))return json(res,403,{error:'Служебный путь закрыт'});filename=path.resolve(root,'.'+decoded);}catch{return json(res,400,{error:'Неверный путь'});}
 if(filename===root)filename=path.join(root,'index.html');if(!filename.startsWith(root+path.sep))return json(res,403,{error:'Путь закрыт'});
 fs.stat(filename,(error,stat)=>{
  if(error||!stat.isFile()){res.writeHead(404).end('Not found');return;}
  const headers={'Content-Type':types[path.extname(filename)]||'application/octet-stream','Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'};
  let start=0,end=stat.size-1,status=200;
  if(req.headers.range){const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!match){res.writeHead(416).end();return;}start=match[1]?Number(match[1]):Math.max(0,stat.size-Number(match[2]));end=match[1]&&match[2]?Math.min(Number(match[2]),stat.size-1):stat.size-1;status=206;if(start>end||start>=stat.size){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`}).end();return;}headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;}
  res.writeHead(status,{...headers,'Content-Length':end-start+1});if(req.method==='HEAD'){res.end();return;}fs.createReadStream(filename,{start,end}).pipe(res);
 });
}).listen(port,'127.0.0.1',()=>console.log(`Freedom CQA: http://127.0.0.1:${port}/check.html`));
