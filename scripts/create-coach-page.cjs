const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
html=html.replace('<title>Freedom Bank — Свобода быть собой</title>','<title>AI Coach — Freedom Workspace</title>')
 .replace('Концепция первого экрана Freedom Bank. Свобода быть собой.','Персональная практика общения с клиентами по результатам проверок сотрудника.')
 .replace('<body>','<body class="coach-page">')
 .replace(/<div class="site-background" data-video-surface[\s\S]*?<\/div><\/div>/,'')
 .replace('<script src="media.js" defer></script>','')
 .replace('<link rel="stylesheet" href="auth.css">','<link rel="stylesheet" href="auth.css"><link rel="stylesheet" href="coach.css"><link rel="stylesheet" href="workforce.css">')
 .replace('<script src="app.js" defer></script>','<script src="app.js" defer></script><script src="coach-config.js" defer></script><script src="coach.js" defer></script>')
 .replace('class="brand" href="#"','class="brand" href="/"')
 .replace(/  <section class="hero"[\s\S]*?  <\/section>/,'  <section id="coach-root" aria-label="Персональный AI Coach"><noscript>Для тренировки включите JavaScript.</noscript></section>')
 .replaceAll('aria-checked="true" tabindex="0" data-panel="card"','aria-checked="false" tabindex="-1" data-panel="card" data-page-route="/"')
 .replaceAll('aria-checked="false" tabindex="-1" data-panel="coach" data-page-route="coach.html"','aria-checked="true" tabindex="0" data-panel="coach"');
fs.writeFileSync(path.join(root,'coach.html'),html);
