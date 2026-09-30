import { appAlert, appConfirm, closeModal, el, menuItem, openModal, render, state, toast } from './app.js';
import { PIN_LENGTH, biometricAvailable, disableBiometric, disableLock, getLockConfig, registerBiometric, setPin, verifyBiometric, verifyPin, wipeAllData } from './lock.js';


// Shared keypad widget used by the lock screen, setup wizard and Change PIN.
// onPress receives the digit string ('0'..'9') or 'back'. onBio is optional -
// when provided, a fingerprint key appears in the bottom-left slot.
function buildKeypad(onPress, onBio) {
  const grid = el('div', { class: 'kpad' });
  const digit = (d) => el('button', { type: 'button', class: 'kp', text: d, onclick: () => onPress(d) });
  for (let d = 1; d <= 9; d++) grid.appendChild(digit(String(d)));
  if (onBio) {
    grid.appendChild(el('button', { type: 'button', class: 'kp kp-bio', text: '👆', 'aria-label': 'Use biometric', onclick: onBio }));
  } else {
    grid.appendChild(el('span', { class: 'kp kp-empty' }));
  }
  grid.appendChild(digit('0'));
  grid.appendChild(el('button', { type: 'button', class: 'kp kp-back', text: '⌫', 'aria-label': 'Backspace', onclick: () => onPress('back') }));
  return grid;
}

// Render the row of PIN-progress dots (filled vs empty) into `host`.
function renderPinDots(host, filled) {
  host.innerHTML = '';
  for (let i = 0; i < PIN_LENGTH; i++) host.appendChild(el('span', { class: 'pin-dot' + (i < filled ? ' filled' : '') }));
}

// Generic PIN-entry controller. Calls onComplete(pin) when 4 digits are in.
// Returns { reset, setError } so callers can drive multi-step flows.
function makePinController(dotsHost, errorHost, onComplete) {
  let entered = '';
  const render = () => renderPinDots(dotsHost, entered.length);
  const reset = () => { entered = ''; render(); };
  const setError = (msg) => {
    errorHost.textContent = msg || '';
    if (msg) setTimeout(() => { if (errorHost.textContent === msg) errorHost.textContent = ''; }, 1800);
  };
  const onPress = (k) => {
    if (k === 'back') { entered = entered.slice(0, -1); render(); return; }
    if (entered.length >= PIN_LENGTH) return;
    entered += k;
    render();
    if (entered.length === PIN_LENGTH) {
      const pin = entered;
      // Defer onComplete so the last dot paints before any verify work runs.
      setTimeout(() => onComplete(pin), 30);
    }
  };
  render();
  return { onPress, reset, setError };
}

// Full-screen lock overlay shown on app start when a PIN is set. Resolves when
// the user unlocks. The overlay covers any already-built chrome behind it.
export async function showLockScreen() {
  const cfg = await getLockConfig();
  if (!cfg || !cfg.enabled) return; // no lock configured
  return new Promise((resolve) => {
    const hasBio = !!(cfg.biometric && cfg.biometric.enabled);
    const overlay = el('div', { class: 'lock-screen', id: '__lockScreen' });
    document.body.appendChild(overlay);
    document.documentElement.classList.add('locked'); document.body.classList.add('locked');

    const dots = el('div', { class: 'pin-dots' });
    const errorEl = el('div', { class: 'lock-error' });
    const subText = el('div', { class: 'lock-sub', text: hasBio ? 'Use biometric or enter your PIN' : 'Enter your PIN to unlock' });

    const finish = () => {
      overlay.classList.add('fade-out');
      document.documentElement.classList.remove('locked'); document.body.classList.remove('locked');
      setTimeout(() => overlay.remove(), 240);
      resolve();
    };

    const ctrl = makePinController(dots, errorEl, async (pin) => {
      const ok = await verifyPin(pin).catch(() => false);
      if (ok) { finish(); return; }
      overlay.classList.add('shake');
      setTimeout(() => overlay.classList.remove('shake'), 420);
      ctrl.setError('Wrong PIN');
      ctrl.reset();
    });

    // silent=true on the auto-prompt: some browsers (notably Safari) require a
    // user gesture for credentials.get(), and we don't want a scary error toast
    // for that. The keypad 👆 button calls this with silent=false so a real
    // user cancel still shows feedback.
    const tryBio = async (silent) => {
      try {
        if (await verifyBiometric()) finish();
      } catch (e) {
        if (!silent) ctrl.setError('Biometric cancelled - use PIN');
      }
    };

    overlay.appendChild(el('div', { class: 'lock-card' }, [
      el('div', { class: 'lock-logo', text: '🔒' }),
      el('div', { class: 'lock-title', text: 'MyNotes' }),
      subText,
      dots,
      errorEl,
      buildKeypad(ctrl.onPress, hasBio ? () => tryBio(false) : null),
      el('div', { class: 'lock-foot' }, [
        el('button', { type: 'button', class: 'link-btn', text: 'Forgot PIN? Reset app', onclick: () => forgotPinFlow() }),
      ]),
    ]));

    // Auto-prompt biometric - feels native on mobile (lock screen → fingerprint).
    // silent=true so a browser that blocks auto-prompts (Safari) fails quietly
    // and the user just uses the keypad's 👆 key or types the PIN.
    if (hasBio) setTimeout(() => tryBio(true), 350);
  });
}

async function forgotPinFlow() {
  const warn = 'Resetting will erase ALL local data on this device and turn off the lock.\n\n' +
    'Make sure you have a recent backup (Menu → Export). You can re-import after reset.\n\nContinue?';
  if (!(await appConfirm(warn))) return;
  if (!(await appConfirm('Last warning - reset now and lose all unsynced changes?'))) return;
  try { await wipeAllData(); } catch (_) {}
  location.reload();
}

// First-time setup: enter PIN → confirm PIN → optional biometric.
async function openLockSetup() {
  const dots = el('div', { class: 'pin-dots' });
  const errorEl = el('div', { class: 'lock-error' });
  const title = el('div', { class: 'lock-title', text: 'Set up app lock' });
  const sub = el('div', { class: 'lock-sub', text: 'Choose a ' + PIN_LENGTH + '-digit PIN' });
  let stage = 'set';   // 'set' → 'confirm' → 'bio'
  let firstPin = '';

  const card = el('div', { class: 'lock-card lock-card-modal' });

  const showBioStep = async () => {
    stage = 'bio';
    sub.textContent = 'PIN saved. Want faster unlock with biometric?';
    dots.style.display = 'none';
    const keypad = card.querySelector('.kpad');
    if (keypad) keypad.style.display = 'none';
    const avail = await biometricAvailable();
    const enableBtn = el('button', {
      type: 'button', class: 'btn primary', text: avail ? 'Enable biometric' : 'Not available on this device',
      onclick: async () => {
        try {
          await registerBiometric();
          closeModal();
          toast('App lock enabled · biometric on');
        } catch (e) { errorEl.textContent = 'Could not enable: ' + (e.message || e); }
      },
    });
    if (!avail) enableBtn.disabled = true;
    card.appendChild(el('div', { class: 'lock-bio-row' }, [
      enableBtn,
      el('button', { type: 'button', class: 'btn ghost', text: 'Skip for now', onclick: () => { closeModal(); toast('App lock enabled'); } }),
    ]));
  };

  const ctrl = makePinController(dots, errorEl, async (pin) => {
    if (stage === 'set') {
      firstPin = pin; stage = 'confirm';
      sub.textContent = 'Confirm your PIN';
      ctrl.reset();
    } else if (stage === 'confirm') {
      if (pin === firstPin) {
        try { await setPin(firstPin); } catch (e) { ctrl.setError(e.message); ctrl.reset(); return; }
        showBioStep();
      } else {
        ctrl.setError('PINs didn\'t match - try again');
        firstPin = ''; stage = 'set';
        sub.textContent = 'Choose a ' + PIN_LENGTH + '-digit PIN';
        ctrl.reset();
      }
    }
  });

  card.appendChild(el('div', { class: 'lock-logo', text: '🔒' }));
  card.appendChild(title);
  card.appendChild(sub);
  card.appendChild(dots);
  card.appendChild(errorEl);
  card.appendChild(buildKeypad(ctrl.onPress, null));

  openModal(card);
}

// Change PIN flow: verify current PIN → new PIN → confirm new PIN.
async function openChangePin() {
  const dots = el('div', { class: 'pin-dots' });
  const errorEl = el('div', { class: 'lock-error' });
  const sub = el('div', { class: 'lock-sub', text: 'Enter current PIN' });
  let stage = 'old', newPin = '';
  const ctrl = makePinController(dots, errorEl, async (pin) => {
    if (stage === 'old') {
      if (!(await verifyPin(pin))) { ctrl.setError('Wrong PIN'); ctrl.reset(); return; }
      stage = 'new'; sub.textContent = 'Enter new PIN'; ctrl.reset();
    } else if (stage === 'new') {
      newPin = pin; stage = 'confirm'; sub.textContent = 'Confirm new PIN'; ctrl.reset();
    } else {
      if (pin === newPin) {
        try { await setPin(newPin); closeModal(); toast('PIN changed'); }
        catch (e) { ctrl.setError(e.message); ctrl.reset(); }
      } else {
        ctrl.setError('PINs didn\'t match'); stage = 'new'; sub.textContent = 'Enter new PIN'; newPin = ''; ctrl.reset();
      }
    }
  });
  openModal(el('div', { class: 'lock-card lock-card-modal' }, [
    el('div', { class: 'lock-logo', text: '🔒' }),
    el('div', { class: 'lock-title', text: 'Change PIN' }),
    sub, dots, errorEl, buildKeypad(ctrl.onPress, null),
  ]));
}

// Settings sheet shown when the user taps the menu item while lock is on.
async function openLockSettings() {
  const cfg = await getLockConfig();
  const bioAvail = await biometricAvailable();
  const items = [];
  items.push(menuItem('🔢', 'Change PIN', 'Set a new ' + PIN_LENGTH + '-digit PIN', () => { closeModal(); openChangePin(); }));
  if (cfg.biometric && cfg.biometric.enabled) {
    items.push(menuItem('👆', 'Disable biometric', 'Unlock with PIN only', async () => {
      await disableBiometric(); closeModal(); toast('Biometric disabled');
    }));
  } else if (bioAvail) {
    items.push(menuItem('👆', 'Enable biometric', 'Unlock with fingerprint or face', async () => {
      try { await registerBiometric(); closeModal(); toast('Biometric enabled'); }
      catch (e) { appAlert('Could not enable: ' + (e.message || e)); }
    }));
  }
  items.push(menuItem('🔓', 'Turn off app lock', 'Disable PIN and biometric', async () => {
    if (!(await appConfirm('Turn off the app lock?\n\nAnyone with this device will be able to open the app.'))) return;
    await disableLock(); closeModal(); toast('App lock disabled');
  }));
  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'App lock' }),
    el('p', { class: 'hint', text: 'Lock state stays on this device only. No data leaves your phone.' }),
    el('div', { class: 'menu-list' }, items),
    el('div', { class: 'btn-row' }, [el('button', { class: 'btn ghost', text: 'Close', onclick: closeModal })]),
  ]));
}

// Entry point invoked from the main menu. Routes to setup or settings.
export async function openLockEntry() {
  const cfg = await getLockConfig();
  if (cfg && cfg.enabled) openLockSettings();
  else openLockSetup();
}

