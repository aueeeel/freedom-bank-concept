const fs=require('node:fs');const path=require('node:path');const root=path.resolve(__dirname,'..');
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
html=html.replace('<title>Freedom Bank — Свобода быть собой</title>','<title>Приглашение в рабочий кабинет — Freedom Workspace</title>')
 .replace('<body>','<body class="invite-page">')
 .replace(/<div class="site-background" data-video-surface[\s\S]*?<\/div><\/div>/,'')
 .replace('<script src="media.js" defer></script>','')
 .replace('<link rel="stylesheet" href="auth.css">','<link rel="stylesheet" href="auth.css"><link rel="stylesheet" href="workforce.css">')
 .replace('<script src="app.js" defer></script>','<script src="app.js" defer></script><script src="invite.js" defer></script>')
 .replace('class="brand" href="#"','class="brand" href="/"')
 .replace(/  <section class="hero"[\s\S]*?  <\/section>/,`<section class="wf-invite-card" aria-label="Приглашение сотрудника"><span class="wf-kicker">FREEDOM WORKSPACE</span><h1 id="invite-title">Ваш рабочий кабинет.</h1><p id="invite-status" role="status">Проверяем приглашение…</p><form id="invite-password-form" class="wf-form" hidden><label>Придумайте пароль<input type="password" name="password" autocomplete="new-password" minlength="8" required placeholder="Не менее 8 символов"></label><label>Повторите пароль<input type="password" name="confirm" autocomplete="new-password" minlength="8" required></label><button class="button button-primary" type="submit">Сохранить и открыть кабинет</button></form><a id="invite-next" class="button button-primary" href="employees.html?mine=1" hidden>Открыть мой кабинет</a><a class="wf-link" href="employees.html?mine=1">Уже есть аккаунт? Войти</a><noscript>Для принятия приглашения включите JavaScript.</noscript></section>`)
 .replaceAll('aria-checked="true" tabindex="0" data-panel="card"','aria-checked="false" tabindex="-1" data-panel="card" data-page-route="/"');
fs.writeFileSync(path.join(root,'invite.html'),html);
