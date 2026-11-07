(() => {
  'use strict';
  const root = document.querySelector('#freedom-app');
  const video = root.querySelector('#card-video');
  const backgroundVideo = document.querySelector('#background-video');
  const dialog = root.querySelector('.panel');
  const content = root.querySelector('#panel-content');
  const hero = root.querySelector('.hero');
  const visual = root.querySelector('.card-visual');
  const stage = root.querySelector('.card-stage');
  const menuButton = root.querySelector('.menu-button');
  const menu = root.querySelector('.mobile-menu');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const panels = {
    card: '<div class="eyebrow">FREEDOM CARD</div><h2>Твоя карта.<br>Твой характер.</h2><p>В центре этого концепта — карта Freedom с космическим дизайном. Рассмотри её со всех сторон и выбери свой следующий шаг.</p><button class="button button-primary" data-panel="order">Выбрать свободу</button><small>Дизайн-концепт. Условия и доступность карты необходимо уточнить у банка.</small>',
    benefits: '<div class="eyebrow">ТВОЯ ЕЖЕДНЕВНАЯ СВОБОДА</div><h2>Больше места<br>для твоих планов.</h2><ul class="panel-list"><li>Выразительный дизайн карты</li><li>Банк всегда под рукой</li><li>Твой ритм, твои решения</li></ul><p>Тарифы, доступные услуги и условия обслуживания — на официальном сайте банка.</p><a class="button button-primary" href="https://bankffin.kz/" target="_blank" rel="noopener noreferrer">Перейти в Freedom Bank</a>',
    app: '<div class="eyebrow">FREEDOM SUPERAPP</div><h2>Твоя свобода.<br>Всегда рядом.</h2><p>Узнай о приложении и доступных сервисах на официальном сайте Freedom Bank.</p><a class="button button-primary" href="https://bankffin.kz/" target="_blank" rel="noopener noreferrer">На сайт банка</a>',
    order: '<div class="eyebrow">СЛЕДУЮЩИЙ ШАГ</div><h2>Начни со<br>своей свободы.</h2><p>Этот экран — интерактивный дизайн-концепт. Для выбора и оформления доступной карты перейди на официальный сайт Freedom Bank.</p><a class="button button-primary" href="https://bankffin.kz/" target="_blank" rel="noopener noreferrer">Перейти в банк</a><small>Здесь мы не собираем персональные данные и не отправляем заявки.</small>',
    support: '<div class="eyebrow">НА СВЯЗИ</div><h2>Давай поможем.</h2><p>Контакты и каналы поддержки доступны на официальном сайте Freedom Bank.</p><a class="button button-primary" href="https://bankffin.kz/" target="_blank" rel="noopener noreferrer">Связаться с банком</a>',
    language: '<div class="eyebrow">ЯЗЫК ИНТЕРФЕЙСА</div><h2>Говорим на твоём.</h2><button class="lang-choice" data-close>Русский · выбран</button><p>Этот первый экран подготовлен на русском. Казахскую и английскую версии можно добавить на следующем этапе.</p>'
  };
  // Keep the supplied video spinning while the whole card follows the pointer.
  // Measure the stationary stage so the transformed card cannot feed back into its target.
  let x = 0, y = 0, horizontal = 0, vertical = 0;
  let targetX = 0, targetY = 0, targetHorizontal = 0, targetVertical = 0;
  let frame = 0, previousTime = 0;
  function animateTilt(time) {
    const elapsed = previousTime ? Math.min(time - previousTime, 64) : 16;
    previousTime = time;
    const smoothing = 1 - Math.exp(-elapsed / 120);
    x += (targetX - x) * smoothing;
    y += (targetY - y) * smoothing;
    horizontal += (targetHorizontal - horizontal) * smoothing;
    vertical += (targetVertical - vertical) * smoothing;
    visual.style.setProperty('--tilt-x', `${x.toFixed(3)}deg`);
    visual.style.setProperty('--tilt-y', `${y.toFixed(3)}deg`);
    visual.style.setProperty('--card-shift-x', `${horizontal.toFixed(3)}px`);
    visual.style.setProperty('--card-shift-y', `${vertical.toFixed(3)}px`);
    if (Math.abs(targetX - x) + Math.abs(targetY - y) + Math.abs(targetHorizontal - horizontal) + Math.abs(targetVertical - vertical) > 0.015) frame = requestAnimationFrame(animateTilt);
    else { frame = 0; previousTime = 0; }
  }
  function scheduleTilt() { if (!frame) frame = requestAnimationFrame(animateTilt); }
  function resetTilt() {
    if (!visual) return;
    targetX = targetY = targetHorizontal = targetVertical = 0;
    if (reducedMotion.matches) {
      cancelAnimationFrame(frame);frame = previousTime = 0;
      x = y = horizontal = vertical = 0;
      for (const property of ['--tilt-x','--tilt-y','--card-shift-x','--card-shift-y']) visual.style.removeProperty(property);
    } else scheduleTilt();
  }
  hero?.addEventListener('pointermove', event => {
    if (!visual || !stage || reducedMotion.matches || event.pointerType === 'touch') return;
    const rect = stage.getBoundingClientRect();
    const pointerX = Math.max(-1, Math.min(1, (event.clientX - rect.left - rect.width / 2) / (rect.width * .38)));
    const pointerY = Math.max(-1, Math.min(1, (event.clientY - rect.top - rect.height / 2) / (rect.height * .38)));
    targetX = -pointerY * 14;
    targetY = pointerX * 22;
    targetHorizontal = pointerX * 14;
    targetVertical = pointerY * 10;
    scheduleTilt();
  }, {passive: true});
  hero?.addEventListener('pointerleave', resetTilt);
  hero?.addEventListener('pointercancel', resetTilt);
  window.addEventListener('blur', resetTilt);
  window.addEventListener('resize', resetTilt, {passive:true});
  reducedMotion.addEventListener('change', resetTilt);
  function closeMenu() { menu.hidden = true; menuButton.setAttribute('aria-expanded', 'false'); }
  menuButton.addEventListener('click', () => { menu.hidden = !menu.hidden; menuButton.setAttribute('aria-expanded', String(!menu.hidden)); });
  function openPanel(name) {
    closeMenu();
    content.innerHTML = panels[name];
    dialog.setAttribute('aria-label', content.querySelector('h2').textContent);
    if (!dialog.open) dialog.showModal();
  }
  root.addEventListener('click', event => {
    const pageTrigger = event.target.closest('[data-page-route]');
    if (pageTrigger) {
      closeMenu();
      window.location.assign(pageTrigger.dataset.pageRoute);
      return;
    }
    const authTrigger = event.target.closest('[data-auth]');
    if (authTrigger) {
      closeMenu();
      window.FreedomAuth.open(authTrigger.dataset.auth);
      return;
    }
    const trigger = event.target.closest('[data-panel]');
    if (trigger && panels[trigger.dataset.panel]) {
      openPanel(trigger.dataset.panel);
    }
    if (event.target.closest('[data-close]')) dialog.close();
  });
  root.querySelector('.panel-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
  function keepRotating() {
    if (video?.paused) video.play().catch(() => {});
    if (!reducedMotion.matches && backgroundVideo?.paused) backgroundVideo.play().catch(() => {});
  }
  function backgroundMotion() {
    if (!backgroundVideo) return;
    if (reducedMotion.matches) { backgroundVideo.autoplay = false;backgroundVideo.pause(); }
    else backgroundVideo.play().catch(() => {});
  }
  reducedMotion.addEventListener('change', backgroundMotion);
  backgroundVideo?.addEventListener('loadeddata', backgroundMotion);
  video?.addEventListener('loadeddata', keepRotating);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) keepRotating(); });
  root.addEventListener('pointerdown', keepRotating, {passive: true});
  keepRotating();
})();

