/**
 * NAVIGATOR 3 // DMX MIDI CONTROLLER
 * High-performance, low-latency WebSocket Client for Android & Touchscreens
 */

(function () {
  'use strict';

  // --- Configuration & State ---
  const STORAGE_KEY = 'navigator3_midi_cfg_v1';
  
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function getMidiNoteName(midiNumber) {
    if (midiNumber < 0 || midiNumber > 127) return '--';
    const name = NOTE_NAMES[midiNumber % 12];
    const oct = Math.floor(midiNumber / 12) - 1; // 60 = C4, 48 = C3, 36 = C2
    return `${name}${oct}`;
  }

  const state = {
    wsHost: window.location.hostname || '192.168.1.150',
    wsPort: '81',
    midiChannel: 1,
    baseNote: 48, // Nota base inicial: 48 (C3) ideal para sintetizadores
    octaveOffset: 0, // Desplazamiento en semitonos (+/- 12 por octava)
    pulseDurationMs: 60,
    simMode: false,
    currentBank: 1,
    activeSceneGlobal: null,
    isConnected: false,
    latencyMs: null,
    pingIntervalId: null,
    ws: null,
    customLabels: {} // { sceneNum: "Custom Name" }
  };

  // Load configuration from localStorage
  function loadConfig() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        state.wsHost = parsed.wsHost || state.wsHost;
        state.midiChannel = parsed.midiChannel || 1;
        state.baseNote = parsed.baseNote !== undefined ? parsed.baseNote : 48;
        state.octaveOffset = parsed.octaveOffset !== undefined ? parsed.octaveOffset : 0;
        state.pulseDurationMs = parsed.pulseDurationMs || 60;
        state.simMode = parsed.simMode !== undefined ? parsed.simMode : false;
        state.customLabels = parsed.customLabels || {};
      }
    } catch (e) {
      console.warn('Error loading localStorage config', e);
    }
  }

  function saveConfig() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        wsHost: state.wsHost,
        midiChannel: state.midiChannel,
        baseNote: state.baseNote,
        octaveOffset: state.octaveOffset,
        pulseDurationMs: state.pulseDurationMs,
        simMode: state.simMode,
        customLabels: state.customLabels
      }));
    } catch (e) {
      console.warn('Error saving config', e);
    }
  }

  // --- DOM Elements ---
  const el = {
    statusBadge: document.getElementById('statusBadge'),
    statusText: document.getElementById('statusText'),
    latencyVal: document.getElementById('latencyVal'),
    matrixGrid: document.getElementById('matrixGrid'),
    btnBlackout: document.getElementById('btnBlackout'),
    btnSettings: document.getElementById('btnSettings'),
    lastActionText: document.getElementById('lastActionText'),
    footerChannel: document.getElementById('footerChannel'),
    bankButtons: document.querySelectorAll('.bank-btn'),
    // Octave controls
    btnOctaveDown: document.getElementById('btnOctaveDown'),
    btnOctaveUp: document.getElementById('btnOctaveUp'),
    octaveDisplay: document.getElementById('octaveDisplay'),
    // Modal
    settingsModal: document.getElementById('settingsModal'),
    btnCloseSettings: document.getElementById('btnCloseSettings'),
    btnSaveSettings: document.getElementById('btnSaveSettings'),
    btnResetSettings: document.getElementById('btnResetSettings'),
    inputWsHost: document.getElementById('inputWsHost'),
    inputMidiChannel: document.getElementById('inputMidiChannel'),
    inputBaseNote: document.getElementById('inputBaseNote'),
    inputNoteDuration: document.getElementById('inputNoteDuration'),
    checkSimMode: document.getElementById('checkSimMode')
  };

  function updateOctaveDisplay() {
    if (!el.octaveDisplay) return;
    const octShift = Math.round(state.octaveOffset / 12);
    const sign = octShift > 0 ? `+${octShift}` : `${octShift}`;
    const baseSample = Math.min(127, Math.max(0, state.baseNote + state.octaveOffset));
    el.octaveDisplay.textContent = `OCT ${sign} (${getMidiNoteName(baseSample)})`;
  }

  // --- UI Rendering ---
  function renderMatrix() {
    el.matrixGrid.innerHTML = '';
    const bankOffset = (state.currentBank - 1) * 16;
    const accentColor = state.currentBank % 2 === 0 ? 'magenta' : 'cyan';

    for (let i = 1; i <= 16; i++) {
      const sceneNumber = bankOffset + i;
      const rawNote = state.baseNote + (sceneNumber - 1) + state.octaveOffset;
      const midiNote = Math.min(127, Math.max(0, rawNote));
      const noteName = getMidiNoteName(midiNote);
      const isCurrentActive = state.activeSceneGlobal === sceneNumber;
      const customTitle = state.customLabels[sceneNumber] || `Escena ${sceneNumber}`;

      const pad = document.createElement('button');
      pad.className = `pad-btn ${isCurrentActive ? 'is-active-scene' : ''}`;
      pad.dataset.scene = sceneNumber;
      pad.dataset.note = midiNote;
      pad.dataset.accent = accentColor;
      pad.setAttribute('role', 'button');
      pad.setAttribute('aria-label', `Disparar ${customTitle}`);

      pad.innerHTML = `
        <div class="pad-top">
          <span class="pad-index">#${sceneNumber}</span>
          <span class="pad-led"></span>
        </div>
        <div class="pad-center">
          <span class="pad-title">${customTitle}</span>
        </div>
        <div class="pad-bottom">
          <span class="pad-midi-badge">NOTE ${midiNote} · ${noteName}</span>
          <span class="pad-indicator">${isCurrentActive ? 'ON AIR' : 'CUE'}</span>
        </div>
      `;

      // Touch and Click Event binding
      const handleTrigger = (ev) => {
        ev.preventDefault();
        triggerPad(sceneNumber, midiNote, pad);
      };

      pad.addEventListener('touchstart', handleTrigger, { passive: false });
      pad.addEventListener('mousedown', handleTrigger);

      el.matrixGrid.appendChild(pad);
    }
  }

  function updateFooter() {
    el.footerChannel.textContent = state.midiChannel;
  }

  function updateStatus(status, text) {
    el.statusBadge.className = `status-badge ${status}`;
    el.statusText.textContent = text;
  }

  // --- MIDI & Trigger Logic ---
  function triggerPad(sceneNumber, midiNote, padElement) {
    // Tactile micro-vibration on mobile / tablet
    if (navigator.vibrate) {
      navigator.vibrate(25);
    }

    // Visual momentary flash
    if (padElement) {
      padElement.classList.add('touch-active');
      setTimeout(() => padElement.classList.remove('touch-active'), 120);
    }

    // Set active scene
    state.activeSceneGlobal = sceneNumber;
    renderMatrix();

    // Log action
    const timeStr = new Date().toLocaleTimeString();
    el.lastActionText.innerHTML = `[${timeStr}] <strong>Escena ${sceneNumber}</strong> (Nota MIDI ${midiNote}, Canal ${state.midiChannel})`;

    // Send Payload
    const payload = {
      type: 'trigger_scene',
      scene: sceneNumber,
      note: midiNote,
      channel: state.midiChannel,
      velocity: 127,
      duration: state.pulseDurationMs
    };

    sendWebSocket(payload);
  }

  function triggerBlackout() {
    if (navigator.vibrate) navigator.vibrate([40, 30, 40]);
    state.activeSceneGlobal = null;
    renderMatrix();

    const timeStr = new Date().toLocaleTimeString();
    el.lastActionText.innerHTML = `[${timeStr}] <strong style="color:#ff334b">BLACKOUT / PANIC ENVIADO</strong>`;

    // Note 127 or All Notes Off control message
    sendWebSocket({
      type: 'blackout',
      channel: state.midiChannel
    });
  }

  // --- WebSocket Manager ---
  function sendWebSocket(dataObj) {
    if (state.simMode) {
      console.log('%c[SIMULATOR MIDI TX]', 'color: #00f0ff; font-weight: bold;', dataObj);
      return;
    }

    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(dataObj));
    } else {
      console.warn('WebSocket no conectado, mensaje no enviado:', dataObj);
    }
  }

  function connectWebSocket() {
    if (state.simMode) {
      updateStatus('simulated', 'MODO SIMULACIÓN');
      el.latencyVal.textContent = '<1 ms';
      return;
    }

    if (state.ws) {
      try {
        state.ws.close();
      } catch (e) {}
    }

    updateStatus('connecting', 'CONECTANDO...');

    // Determine WS URL
    let wsUrl = state.wsHost;
    if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
      wsUrl = `ws://${wsUrl}:${state.wsPort}/ws`;
    }

    try {
      state.ws = new WebSocket(wsUrl);
    } catch (err) {
      console.error('Error instantiating WebSocket:', err);
      updateStatus('offline', 'ERROR URL');
      scheduleReconnect();
      return;
    }

    state.ws.onopen = () => {
      console.log('[WS] Conectado exitosamente con ESP32:', wsUrl);
      state.isConnected = true;
      updateStatus('connected', 'EN LÍNEA');
      startPingRoutine();
    };

    state.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'pong') {
          const rtt = state.lastPingTime ? Math.max(1, Math.round(performance.now() - state.lastPingTime)) : 2;
          state.latencyMs = rtt;
          el.latencyVal.textContent = `${rtt} ms`;
        } else if (msg.type === 'ack_scene') {
          // Hardware confirmation
          console.log('[ESP32 ACK]', msg);
        }
      } catch (e) {
        // Raw text message
      }
    };

    state.ws.onclose = () => {
      state.isConnected = false;
      stopPingRoutine();
      updateStatus('offline', 'DESCONECTADO');
      el.latencyVal.textContent = '-- ms';
      scheduleReconnect();
    };

    state.ws.onerror = (e) => {
      console.warn('[WS] Error de comunicación', e);
      state.ws.close();
    };
  }

  let reconnectTimeout = null;
  function scheduleReconnect() {
    if (state.simMode) return;
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(() => {
      console.log('[WS] Intentando reconectar...');
      connectWebSocket();
    }, 3000);
  }

  function startPingRoutine() {
    stopPingRoutine();
    state.pingIntervalId = setInterval(() => {
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.lastPingTime = performance.now();
        state.ws.send(JSON.stringify({ type: 'ping', t: 1 }));
      }
    }, 2000);
  }

  function stopPingRoutine() {
    if (state.pingIntervalId) {
      clearInterval(state.pingIntervalId);
      state.pingIntervalId = null;
    }
  }

  // --- Event Listeners & UI Handlers ---
  function setupEventListeners() {
    // Bank switching
    el.bankButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        el.bankButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.currentBank = parseInt(btn.dataset.bank, 10);
        renderMatrix();
      });
    });

    // Octave Transposition
    if (el.btnOctaveDown) {
      el.btnOctaveDown.addEventListener('click', () => {
        if (state.baseNote + state.octaveOffset - 12 >= 0) {
          state.octaveOffset -= 12;
        } else {
          state.octaveOffset = -state.baseNote;
        }
        updateOctaveDisplay();
        renderMatrix();
        saveConfig();
        const baseSample = Math.min(127, Math.max(0, state.baseNote + state.octaveOffset));
        el.lastActionText.innerHTML = `Octava cambiada a <strong>${el.octaveDisplay.textContent}</strong>`;
      });
    }

    if (el.btnOctaveUp) {
      el.btnOctaveUp.addEventListener('click', () => {
        if (state.baseNote + state.octaveOffset + 12 <= 112) {
          state.octaveOffset += 12;
        }
        updateOctaveDisplay();
        renderMatrix();
        saveConfig();
        const baseSample = Math.min(127, Math.max(0, state.baseNote + state.octaveOffset));
        el.lastActionText.innerHTML = `Octava cambiada a <strong>${el.octaveDisplay.textContent}</strong>`;
      });
    }

    // Blackout button
    el.btnBlackout.addEventListener('click', triggerBlackout);

    // Settings Modal
    el.btnSettings.addEventListener('click', () => {
      el.inputWsHost.value = state.wsHost;
      el.inputMidiChannel.value = state.midiChannel;
      el.inputBaseNote.value = state.baseNote;
      el.inputNoteDuration.value = state.pulseDurationMs;
      el.checkSimMode.checked = state.simMode;
      el.settingsModal.showModal();
    });

    el.btnCloseSettings.addEventListener('click', () => {
      el.settingsModal.close();
    });

    el.btnSaveSettings.addEventListener('click', () => {
      state.wsHost = el.inputWsHost.value.trim() || '192.168.1.150';
      state.midiChannel = parseInt(el.inputMidiChannel.value, 10) || 1;
      state.baseNote = parseInt(el.inputBaseNote.value, 10) || 0;
      state.pulseDurationMs = parseInt(el.inputNoteDuration.value, 10) || 60;
      state.simMode = el.checkSimMode.checked;

      saveConfig();
      updateFooter();
      renderMatrix();
      el.settingsModal.close();

      connectWebSocket();
    });

    el.btnResetSettings.addEventListener('click', () => {
      localStorage.removeItem(STORAGE_KEY);
      loadConfig();
      el.inputWsHost.value = state.wsHost;
      el.inputMidiChannel.value = 1;
      el.inputBaseNote.value = 0;
      el.inputNoteDuration.value = 60;
      el.checkSimMode.checked = false;
    });

    // Close modal on outside click
    el.settingsModal.addEventListener('click', (e) => {
      const rect = el.settingsModal.getBoundingClientRect();
      const isInDialog = (rect.top <= e.clientY && e.clientY <= rect.top + rect.height
        && rect.left <= e.clientX && e.clientX <= rect.left + rect.width);
      if (!isInDialog) {
        el.settingsModal.close();
      }
    });
  }

  // --- App Initialization ---
  function init() {
    loadConfig();
    updateFooter();
    updateOctaveDisplay();
    renderMatrix();
    setupEventListeners();
    connectWebSocket();
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
