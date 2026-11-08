const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.mjs':'application/javascript; charset=utf-8','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4','.webm':'video/webm','.woff2':'font/woff2','.ttf':'font/ttf'};
// Локальная модель для автоматической оценки (только для разработки на этом компьютере).
// Включается переменной CQA_MODEL_URL, например http://127.0.0.1:8080 (llama-server).
const modelUrl = process.env.CQA_MODEL_URL || '';
const localModel = modelUrl ? require('./cqa-local-model.cjs') : null;
http.createServer((req,res) => {
  const pathname = (() => { try { return new URL(req.url,'http://localhost').pathname; } catch { return ''; } })();
  if(localModel && pathname==='/api/cqa/analyze'){localModel.handle(req,res,{modelUrl});return;}
  if(localModel && pathname==='/qa-config.js'){res.writeHead(200,{'Content-Type':types['.js'],'Cache-Control':'no-store'});res.end("window.FREEDOM_QA_CONFIG={analysisEndpoint:'/api/cqa/analyze',transcriptionEndpoint:''};");return;}
  let filename;
  try { filename = path.resolve(root, '.' + decodeURIComponent(new URL(req.url,'http://localhost').pathname)); } catch {res.writeHead(400).end();return;}
  if(filename === root) filename=path.join(root,'index.html');
  if(!filename.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.stat(filename,(err,stat)=>{
    if(err || !stat.isFile()){res.writeHead(404).end('Not found');return;}
    const headers={'Content-Type':types[path.extname(filename)]||'application/octet-stream','Accept-Ranges':'bytes'};
    const range=req.headers.range;
    if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match){res.writeHead(416).end();return;}const start=match[1]?Number(match[1]):Math.max(0,stat.size-Number(match[2]));const end=match[1]&&match[2]?Math.min(Number(match[2]),stat.size-1):stat.size-1;if(start>end||start>=stat.size){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`}).end();return;}res.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${stat.size}`,'Content-Length':end-start+1});if(req.method==='HEAD'){res.end();return;}fs.createReadStream(filename,{start,end}).pipe(res);}
    else{res.writeHead(200,{...headers,'Content-Length':stat.size});if(req.method==='HEAD'){res.end();return;}fs.createReadStream(filename).pipe(res);}
  });
}).listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log(`Freedom Bank: http://127.0.0.1:${process.env.PORT||4173}${modelUrl?` · автооценка через ${modelUrl}`:''}`));
