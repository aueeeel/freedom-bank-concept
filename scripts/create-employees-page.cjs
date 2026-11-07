const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
html=html.replace('<title>Freedom Bank — Свобода быть собой</title>','<title>Сотрудники — Freedom Bank</title>')
  .replace('Концепция первого экрана Freedom Bank. Свобода быть собой.','Рабочий кабинет Freedom: личные разговоры, оценки, рейтинг и апелляции.')
  .replace('<body>','<body class="employees-page secondary-page">')
  .replace(/<div class="site-background" data-video-surface[\s\S]*?<\/div><\/div>/,'<div class="site-background wave-background" aria-hidden="true"></div>')
  .replace('<script src="media.js" defer></script>','<script src="wave-background.js" defer></script>')
  .replace('<link rel="stylesheet" href="auth.css">','<link rel="stylesheet" href="auth.css"><link rel="stylesheet" href="secondary.css"><link rel="stylesheet" href="team.css"><link rel="stylesheet" href="workforce.css">')
  .replace('<script src="app.js" defer></script>','<script src="app.js" defer></script><script src="employees.js" defer></script>')
  .replace('class="brand" href="#"','class="brand" href="/"')
  .replace(/  <section class="hero"[\s\S]*?  <\/section>/,'  <section id="employees-root" class="team-content" aria-label="Сотрудники"><noscript><h1>Наша команда</h1><p>Для просмотра интерактивных бейджей нужен JavaScript.</p></noscript></section>')
  .replaceAll('aria-checked="true" tabindex="0" data-panel="card"','aria-checked="false" tabindex="-1" data-panel="card" data-page-route="/"')
  // «Проверка» видна на всех страницах; «Сотрудники» ведёт на список, чтобы уйти со вкладки «Апелляции».
  .replaceAll('aria-checked="false" tabindex="-1" data-panel="employees" data-page-route="employees.html"','aria-checked="true" tabindex="0" data-panel="employees" data-page-route="employees.html"');
fs.writeFileSync(path.join(root,'employees.html'),html);
