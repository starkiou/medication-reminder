(function () {
  'use strict';

  const ACCESS_CODE_KEY = 'accessCode';

  const screens = {
    install: document.getElementById('install-screen'),
    access: document.getElementById('access-screen'),
    onboarding: document.getElementById('onboarding-screen'),
    notif: document.getElementById('notif-screen'),
    main: document.getElementById('main-screen'),
    history: document.getElementById('history-screen'),
  };

  function showScreen(name) {
    Object.values(screens).forEach((el) => el.classList.add('hidden'));
    screens[name].classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  function showDebugError(message) {
    let el = document.getElementById('debug-error');
    if (!el) {
      el = document.createElement('div');
      el.id = 'debug-error';
      el.style.cssText =
        'position:fixed;bottom:0;left:0;right:0;background:#4a1f2b;color:#fff;' +
        'padding:12px 16px;font-size:13px;font-family:monospace;z-index:9999;' +
        'white-space:pre-wrap;max-height:40vh;overflow:auto;';
      document.body.appendChild(el);
    }
    el.textContent = 'Erreur : ' + message;
  }

  function isStandalone() {
    return (
      window.navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches
    );
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  }

  // Seul iOS/Safari exige une installation "écran d'accueil" pour autoriser les
  // notifications. Sur ordinateur ou Android, un simple onglet suffit pour tester.
  function needsInstallGate() {
    return isIOS() && !isStandalone();
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  // Conservées entre l'écran d'onboarding et l'écran de notification
  let pendingPackStartDate = null;
  let pendingPackNumber = null;

  // Réglages du suivi (durées du cycle, heure du rappel, nom du médicament),
  // envoyés par le serveur avec l'état.
  let config = null;

  /** Erreur levée quand le serveur refuse le code d'accès. */
  class AccessDeniedError extends Error {}

  function getAccessCode() {
    try {
      return window.localStorage.getItem(ACCESS_CODE_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function setAccessCode(code) {
    try {
      window.localStorage.setItem(ACCESS_CODE_KEY, code);
    } catch (e) {
      // stockage indisponible : le code sera redemandé à la prochaine ouverture
    }
  }

  async function requestJson(url, options = {}) {
    const headers = { ...(options.headers || {}), 'X-Access-Code': getAccessCode() };
    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      throw new AccessDeniedError(data.error || 'Non autorisé');
    }
    if (!res.ok) {
      throw new Error(data.error || `Erreur serveur (${res.status})`);
    }
    return data;
  }

  async function requestJsonPost(url, payload) {
    return requestJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  /** Affiche l'erreur, ou l'écran du code d'accès si c'est lui qui est refusé. */
  function handleError(err) {
    console.error(err);
    if (err instanceof AccessDeniedError) {
      showAccessScreen(getAccessCode() !== '');
      return;
    }
    showDebugError(err.message || String(err));
  }

  async function fetchState() {
    const state = await requestJson('/api/state');
    if (state.config) applyConfig(state.config);
    return state;
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    return navigator.serviceWorker.register('/sw.js');
  }

  async function subscribeToPush(packStartDate, packNumberInBox) {
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await requestJson('/api/vapid-public-key');

    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    await requestJsonPost('/api/subscribe', { subscription, packStartDate, packNumberInBox });
  }

  function formatHour(hour) {
    return `${hour}h`;
  }

  /** Remplit tous les textes qui dépendent des réglages du suivi. */
  function applyConfig(newConfig) {
    config = newConfig;

    document.getElementById('med-name').textContent = config.medName || 'Mon traitement';

    const details = document.getElementById('med-details');
    details.innerHTML = '';
    config.medDetails.forEach((line, i) => {
      const p = document.createElement('p');
      p.className = i === 0 ? 'med-dosage' : 'med-detail';
      p.textContent = line;
      details.appendChild(p);
    });

    document.getElementById('med-cycle').textContent = config.pauseDays > 0
      ? `Cycle : ${config.pillDays} jours de prise, ${config.pauseDays} jours de pause`
      : `Cycle : ${config.pillDays} jours de prise, sans pause`;
    document.getElementById('legend-pause').classList.toggle('hidden', config.pauseDays === 0);

    document.getElementById('pack-number-label').textContent =
      `Quelle plaquette de la boîte (sur ${config.packsPerBox}) ?`;
    const select = document.getElementById('pack-number');
    const previous = select.value;
    select.innerHTML = '';
    for (let n = 1; n <= config.packsPerBox; n++) {
      const option = document.createElement('option');
      option.value = String(n);
      option.textContent = `Plaquette ${n}`;
      select.appendChild(option);
    }
    if (previous) select.value = previous;

    document.getElementById('notif-intro').textContent =
      `Tu recevras un rappel chaque jour à ${formatHour(config.reminderHour)}, même téléphone verrouillé.`;

    const backup = config.backupHour === null
      ? ''
      : `, puis un rappel de secours à ${formatHour(config.backupHour)} si la prise n'a pas été confirmée`;
    document.getElementById('footer-note').textContent =
      `Rappel à ${formatHour(config.reminderHour)}${backup}. Ce suivi ne remplace pas la notice de ton médicament.`;
  }

  function renderRing(days) {
    const svg = document.getElementById('ring-svg');
    const size = 260;
    const center = size / 2;
    const radius = 108;
    const dotRadius = 6.5;
    const ns = 'http://www.w3.org/2000/svg';

    svg.innerHTML = '';
    const total = days.length;

    days.forEach((day, i) => {
      const angle = (i / total) * 2 * Math.PI - Math.PI / 2; // jour 1 en haut, sens horaire
      const cx = center + radius * Math.cos(angle);
      const cy = center + radius * Math.sin(angle);

      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('cx', cx.toFixed(2));
      circle.setAttribute('cy', cy.toFixed(2));

      let r = dotRadius;
      let fill = 'rgba(180, 169, 201, 0.25)'; // future, neutre
      let stroke = 'none';

      const color = day.phase === 'pill' ? 'var(--rose)' : 'var(--gold)';

      if (day.status === 'past') {
        fill = color;
      } else if (day.status === 'today') {
        fill = color;
        r = dotRadius + 2.5;
        stroke = color;
      } else {
        // future : contour de la couleur de phase, centre vide
        fill = 'transparent';
        stroke = color;
      }

      circle.setAttribute('r', r.toFixed(2));
      circle.setAttribute('fill', fill);
      if (stroke !== 'none') {
        circle.setAttribute('stroke', stroke);
        circle.setAttribute('stroke-width', day.status === 'today' ? '2' : '1');
        circle.setAttribute('stroke-opacity', day.status === 'today' ? '0.5' : '0.7');
      }
      svg.appendChild(circle);
    });
  }

  function formatDateShort(iso) {
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
  }

  function renderMain(state) {
    document.getElementById('pack-label').textContent =
      `Plaquette ${state.packNumberInBox} / ${config.packsPerBox}`;
    document.getElementById('ring-day').textContent = state.cycleDay;
    document.getElementById('ring-total').textContent = `/ ${config.cycleLength} jours`;

    renderRing(state.days);

    const statusPill = document.getElementById('status-pill');
    if (state.phase === 'pill') {
      statusPill.textContent =
        state.cycleDay === 1
          ? `Jour 1/${config.pillDays} — reprise après la pause, prends ${config.yours}`
          : `Jour ${state.cycleDay}/${config.pillDays} — prends ${config.yours}`;
      statusPill.classList.remove('pause');
    } else {
      statusPill.textContent = `Pause ${state.pauseDayNumber}/${config.pauseDays} — repos`;
      statusPill.classList.add('pause');
    }

    document.getElementById('pills-remaining').textContent =
      state.phase === 'pill' ? state.pillsRemainingInPack : '—';

    document.getElementById('notif-status').textContent =
      state.hasPushSubscription && Notification.permission === 'granted' ? 'Actives' : 'Inactives';

    document.getElementById('new-box-banner').classList.toggle('hidden', !state.needsNewBox);

    const confirmBtn = document.getElementById('confirm-btn');
    if (state.phase === 'pill') {
      confirmBtn.classList.remove('hidden');
      if (state.confirmedToday) {
        confirmBtn.textContent = '✓ Prise confirmée aujourd\'hui';
        confirmBtn.disabled = true;
      } else {
        confirmBtn.textContent = `✓ J'ai pris ${config.mine} aujourd'hui`;
        confirmBtn.disabled = false;
      }
    } else {
      confirmBtn.classList.add('hidden');
    }

    const resumeBanner = document.getElementById('resume-banner');
    if (state.phase === 'pause') {
      const urgent = state.daysUntilResume === 1;
      resumeBanner.textContent = urgent
        ? `Dernier jour de pause — tu reprends ${config.the} demain !`
        : `Reprise le ${formatDateShort(state.nextPackStartDate)}`;
      resumeBanner.classList.remove('hidden');
      resumeBanner.classList.toggle('urgent', urgent);
    } else {
      resumeBanner.classList.add('hidden');
    }

    showScreen('main');
  }

  async function refreshMain() {
    const state = await fetchState();
    if (state.onboarded) renderMain(state);
  }

  async function fetchHistory() {
    return requestJson('/api/history');
  }

  const DAY_NAMES = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

  function formatDayLabel(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return `${DAY_NAMES[date.getUTCDay()]} ${formatDateShort(iso)}/${y}`;
  }

  /** Ligne « nom du médicament + heure du rappel » de l'historique. */
  function buildIntakeCell(main) {
    const title = document.createElement('div');
    title.className = 'history-row-title';
    title.textContent = config.medName || 'Prise';
    const time = document.createElement('div');
    time.className = 'history-row-time';
    time.textContent = `${String(config.reminderHour).padStart(2, '0')}:00`;
    main.appendChild(title);
    main.appendChild(time);
  }

  function renderHistory(data) {
    const days = data.days || [];
    const list = document.getElementById('history-list');
    list.innerHTML = '';

    document.getElementById('history-subtitle').textContent = data.startDate
      ? `Depuis le ${formatDateShort(data.startDate)}`
      : 'Depuis le début du suivi';

    // Plus récent en premier, comme un relevé.
    [...days].reverse().forEach((day) => {
      const label = document.createElement('div');
      label.className = 'history-day-label';
      label.textContent = day.isToday ? "Aujourd'hui" : formatDayLabel(day.date);
      list.appendChild(label);

      // Les jours de prise se corrigent d'un appui ; les jours de pause n'ont rien à corriger
      const editable = day.phase === 'pill';
      const row = document.createElement(editable ? 'button' : 'div');
      row.className = 'history-row' + (day.isToday ? ' today' : '') + (editable ? ' editable' : '');

      const icon = document.createElement('div');
      icon.className = 'history-row-icon';

      const main = document.createElement('div');
      main.className = 'history-row-main';

      const status = document.createElement('div');
      status.className = 'history-row-status';

      if (day.missed) {
        icon.style.background = '#E0555A';
        buildIntakeCell(main);
        status.textContent = '✕ Oublié';
        status.classList.add('missed');
      } else if (day.phase === 'pill' && day.confirmed) {
        icon.style.background = 'var(--rose)';
        buildIntakeCell(main);
        status.textContent = '✓ Prise';
        status.classList.add('taken');
      } else if (day.phase === 'pill') {
        // Ni confirmée ni signalée comme oubliée : on ne prétend pas qu'elle a été prise
        icon.style.background = 'var(--text-muted)';
        buildIntakeCell(main);
        status.textContent = day.isToday ? 'À prendre' : 'Non confirmée';
        status.classList.add('pending');
      } else {
        icon.style.background = 'var(--gold)';
        const title = document.createElement('div');
        title.className = 'history-row-title';
        title.textContent = 'Jour de pause';
        main.appendChild(title);
        status.textContent = 'Pause';
        status.classList.add('pause');
      }

      row.appendChild(icon);
      row.appendChild(main);
      row.appendChild(status);
      list.appendChild(row);

      if (editable) {
        const current = day.missed ? 'missed' : day.confirmed ? 'taken' : 'unknown';
        row.type = 'button';
        row.setAttribute('aria-expanded', 'false');
        row.onclick = () => toggleDayEditor(row, day.date, current);
      }
    });
  }

  const DAY_CHOICES = [
    { status: 'taken', label: '✓ Prise' },
    { status: 'missed', label: '✕ Oubliée' },
    { status: 'unknown', label: 'Je ne sais plus' },
  ];

  /** Ouvre ou referme, sous une journée, les boutons qui permettent de la corriger. */
  function toggleDayEditor(row, dateISO, current) {
    const next = row.nextElementSibling;
    const wasOpen = !!next && next.classList.contains('history-editor');
    document.querySelectorAll('.history-editor').forEach((el) => el.remove());
    document.querySelectorAll('.history-row.editable').forEach((el) => el.setAttribute('aria-expanded', 'false'));
    if (wasOpen) return;

    const editor = document.createElement('div');
    editor.className = 'history-editor';
    DAY_CHOICES.forEach((choice) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'history-choice' + (choice.status === current ? ' current' : '');
      btn.textContent = choice.label;
      btn.onclick = async () => {
        try {
          await requestJsonPost('/api/state', { action: 'set_day_status', date: dateISO, status: choice.status });
          // On recharge l'historique sans perdre l'endroit où on en était dans la liste
          const scrollY = window.scrollY;
          renderHistory(await fetchHistory());
          window.scrollTo(0, scrollY);
        } catch (err) {
          handleError(err);
        }
      };
      editor.appendChild(btn);
    });
    row.setAttribute('aria-expanded', 'true');
    row.after(editor);
  }

  function bindHistoryButtons() {
    document.getElementById('history-btn').onclick = async () => {
      try {
        const data = await fetchHistory();
        renderHistory(data);
        showScreen('history');
      } catch (err) {
        handleError(err);
      }
    };

    // Un bouton en haut, qui reste visible pendant le défilement, et un en bas de liste
    ['history-back-top-btn', 'history-back-btn'].forEach((id) => {
      document.getElementById(id).onclick = () => showScreen('main');
    });
  }

  function bindOnboardingForm(prefill) {
    const form = document.getElementById('onboarding-form');
    const dateInput = document.getElementById('pack-start-date');
    const numberSelect = document.getElementById('pack-number');

    if (prefill) {
      dateInput.value = prefill.packStartDate;
      numberSelect.value = String(prefill.packNumberInBox);
    } else {
      dateInput.value = new Date().toISOString().slice(0, 10);
    }

    form.onsubmit = async (e) => {
      e.preventDefault();
      const packStartDate = dateInput.value;
      const packNumberInBox = parseInt(numberSelect.value, 10);

      if (prefill) {
        // Re-configuration depuis l'écran principal : on a déjà un abonnement push
        try {
          await requestJsonPost('/api/state', {
            action: 'update_pack_start',
            packStartDate,
            packNumberInBox,
          });
          await refreshMain();
        } catch (err) {
          handleError(err);
        }
        return;
      }

      pendingPackStartDate = packStartDate;
      pendingPackNumber = packNumberInBox;
      showScreen('notif');
    };
  }

  function bindNotifButton() {
    const btn = document.getElementById('enable-notif-btn');
    const errorEl = document.getElementById('notif-error');

    btn.onclick = async () => {
      errorEl.classList.add('hidden');
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          errorEl.textContent = 'Sans autorisation, les rappels ne pourront pas s\'afficher.';
          errorEl.classList.remove('hidden');
          return;
        }
        await subscribeToPush(pendingPackStartDate, pendingPackNumber);
        await refreshMain();
      } catch (err) {
        if (err instanceof AccessDeniedError) {
          handleError(err);
          return;
        }
        errorEl.textContent = err.message || 'Une erreur est survenue, réessaie.';
        errorEl.classList.remove('hidden');
        console.error(err);
      }
    };
  }

  function bindConfirmButton() {
    document.getElementById('confirm-btn').onclick = async () => {
      try {
        await requestJsonPost('/api/state', { action: 'confirm_taken_today' });
        await refreshMain();
      } catch (err) {
        handleError(err);
      }
    };
  }

  function bindForgotButton() {
    document.getElementById('forgot-btn').onclick = async () => {
      try {
        await requestJsonPost('/api/state', { action: 'mark_forgot_yesterday' });
        const btn = document.getElementById('forgot-btn');
        const original = btn.textContent;
        btn.textContent = 'Noté ✓';
        setTimeout(() => (btn.textContent = original), 1500);
      } catch (err) {
        handleError(err);
      }
    };
  }

  function bindSettingsButton() {
    document.getElementById('settings-btn').onclick = async () => {
      try {
        const state = await fetchState();
        bindOnboardingForm({
          packStartDate: state.effectivePackStartDate,
          packNumberInBox: state.packNumberInBox,
        });
        showScreen('onboarding');
      } catch (err) {
        handleError(err);
      }
    };
  }

  /** Demande le code d'accès ; `rejected` signale qu'un code vient d'être refusé. */
  function showAccessScreen(rejected) {
    const errorEl = document.getElementById('access-error');
    errorEl.textContent = 'Code incorrect, réessaie.';
    errorEl.classList.toggle('hidden', !rejected);
    document.getElementById('access-code').value = '';
    showScreen('access');
  }

  function bindAccessForm() {
    document.getElementById('access-form').onsubmit = async (e) => {
      e.preventDefault();
      setAccessCode(document.getElementById('access-code').value.trim());
      await start();
    };
  }

  async function init() {
    try {
      const installBypassBtn = document.getElementById('install-bypass-btn');
      if (installBypassBtn) {
        installBypassBtn.onclick = () => proceedPastInstallGate();
      }

      if (needsInstallGate()) {
        showScreen('install');
        return;
      }

      await proceedPastInstallGate();
    } catch (err) {
      handleError(err);
    }
  }

  async function proceedPastInstallGate() {
    try {
      await registerServiceWorker();
      bindAccessForm();
      bindNotifButton();
      bindConfirmButton();
      bindForgotButton();
      bindSettingsButton();
      bindHistoryButtons();
      await start();
    } catch (err) {
      handleError(err);
    }
  }

  /**
   * Renvoie au serveur l'abonnement push de cet appareil. Le serveur n'en garde
   * qu'un : celui du dernier appareil qui s'est abonné. Sans ce renvoi à chaque
   * ouverture, un abonnement pris ailleurs (un autre téléphone, un navigateur de
   * test) détournait les rappels pour de bon, alors que l'application affichait
   * toujours « notifications actives ».
   */
  async function resyncPushSubscription(state) {
    try {
      await subscribeToPush(state.effectivePackStartDate, state.packNumberInBox);
      if (!state.hasPushSubscription) await refreshMain();
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        handleError(err);
        return;
      }
      // L'application reste utilisable même si l'abonnement n'a pas pu être renvoyé
      console.error('abonnement push non renvoyé', err);
    }
  }

  /** Charge l'état et affiche l'écran qui convient. Rejouée après la saisie du code d'accès. */
  async function start() {
    try {
      const state = await fetchState();

      if (!state.onboarded) {
        bindOnboardingForm(null);
        showScreen('onboarding');
        return;
      }

      if (Notification.permission !== 'granted') {
        pendingPackStartDate = state.effectivePackStartDate;
        pendingPackNumber = state.packNumberInBox;
        showScreen('notif');
        return;
      }

      renderMain(state);
      resyncPushSubscription(state);
    } catch (err) {
      handleError(err);
    }
  }

  init();
})();
