const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
html=html.replace('<title>Freedom Bank — Свобода быть собой</title>','<title>Проверка чатов — Freedom CQA</title>')
 .replace('Концепция первого экрана Freedom Bank. Свобода быть собой.','Рабочее пространство для проверки клиентских чатов и записей разговоров по чек-листу качества.')
 .replace('<body>','<body class="check-page">')
 .replace(/<div class="site-background" data-video-surface[\s\S]*?<\/div><\/div>/,'')
 .replace('<script src="media.js" defer></script>','')
 .replace('<link rel="stylesheet" href="auth.css">','<link rel="stylesheet" href="auth.css"><link rel="stylesheet" href="qa.css">')
 .replace('<script src="app.js" defer></script>','<script src="app.js" defer></script><script src="qa-config.js" defer></script><script src="qa.js" defer></script>')
 .replace('class="brand" href="#"','class="brand" href="/"')
 .replace(/  <section class="hero"[\s\S]*?  <\/section>/,'  <section id="qa-root" aria-label="Проверка качества диалогов"><noscript>Для проверки файлов включите JavaScript.</noscript></section>')
 .replaceAll('aria-checked="true" tabindex="0" data-panel="card"','aria-checked="false" tabindex="-1" data-panel="card" data-page-route="/"')
 .replaceAll('aria-checked="false" tabindex="-1" data-panel="check" data-page-route="check.html"','aria-checked="true" tabindex="0" data-panel="check"');
fs.writeFileSync(path.join(root,'check.html'),html);
