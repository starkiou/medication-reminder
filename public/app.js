(function () {
  'use strict';

  const screens = {
    install: document.getElementById('install-screen'),
    onboarding: document.getElementById('onboarding-screen'),
    notif: document.getElementById('notif-screen'),
    main: document.getElementById('main-screen'),
  };

  function showScreen(name) {
    Object.values(screens).forEach((el) => el.classList.add('hidden'));
    screens[name].classList.remove('hidden');
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

  async function fetchState() {
    const res = await fetch('/api/state');
    return res.json();
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    return navigator.serviceWorker.register('/sw.js');
  }

  async function subscribeToPush(packStartDate, packNumberInBox) {
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await fetch('/api/vapid-public-key').then((r) => r.json());

    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription, packStartDate, packNumberInBox }),
    });
  }

  function renderRing(days, cycleDay) {
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

  function renderMain(state) {
    document.getElementById('pack-label').textContent = `Plaquette ${state.packNumberInBox} / 3`;
    document.getElementById('ring-day').textContent = state.cycleDay;
    document.getElementById('ring-total').textContent = '/ 28 jours';

    renderRing(state.days, state.cycleDay);

    const statusPill = document.getElementById('status-pill');
    if (state.phase === 'pill') {
      statusPill.textContent = `Jour ${state.cycleDay}/21 — prends ta pilule`;
      statusPill.classList.remove('pause');
    } else {
      statusPill.textContent = `Pause ${state.pauseDayNumber}/7 — repos`;
      statusPill.classList.add('pause');
    }

    document.getElementById('pills-remaining').textContent =
      state.phase === 'pill' ? state.pillsRemainingInPack : '—';

    document.getElementById('notif-status').textContent =
      state.hasPushSubscription && Notification.permission === 'granted' ? 'Actives' : 'Inactives';

    document.getElementById('new-box-banner').classList.toggle('hidden', !state.needsNewBox);

    showScreen('main');
  }

  async function refreshMain() {
    const state = await fetchState();
    if (state.onboarded) renderMain(state);
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
        await fetch('/api/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update_pack_start', packStartDate, packNumberInBox }),
        });
        await refreshMain();
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
        errorEl.textContent = 'Une erreur est survenue, réessaie.';
        errorEl.classList.remove('hidden');
        console.error(err);
      }
    };
  }

  function bindForgotButton() {
    document.getElementById('forgot-btn').onclick = async () => {
      await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_forgot_yesterday' }),
      });
      const btn = document.getElementById('forgot-btn');
      const original = btn.textContent;
      btn.textContent = 'Noté ✓';
      setTimeout(() => (btn.textContent = original), 1500);
    };
  }

  function bindSettingsButton() {
    document.getElementById('settings-btn').onclick = async () => {
      const state = await fetchState();
      bindOnboardingForm({
        packStartDate: state.effectivePackStartDate,
        packNumberInBox: state.packNumberInBox,
      });
      showScreen('onboarding');
    };
  }

  async function init() {
    if (needsInstallGate()) {
      showScreen('install');
      return;
    }

    await registerServiceWorker();
    bindNotifButton();
    bindForgotButton();
    bindSettingsButton();

    const state = await fetchState();

    if (!state.onboarded) {
      bindOnboardingForm(null);
      showScreen('onboarding');
      return;
    }

    if (!state.hasPushSubscription || Notification.permission !== 'granted') {
      pendingPackStartDate = state.effectivePackStartDate;
      pendingPackNumber = state.packNumberInBox;
      showScreen('notif');
      return;
    }

    renderMain(state);
  }

  init();
})();
