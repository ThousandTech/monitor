'use strict';

(() => {
  const terminal = document.querySelector('#terminal');
  const output = document.querySelector('#terminal-output');
  const form = document.querySelector('#command-form');
  const input = document.querySelector('#command-input');
  const prompt = document.querySelector('#command-prompt');
  if (!terminal || !output || !form || !input || !prompt) return;

  const deniedCommands = new Set([
    'ls', 'pwd', 'cd', 'cat', 'clear', 'help', 'whoami', 'uname', 'top',
    'htop', 'ps', 'free', 'df', 'du', 'echo', 'sudo', 'su', 'rm', 'mkdir',
    'touch', 'chmod', 'curl', 'wget', 'exit', 'showstats',
  ]);
  const commandHistory = [];
  const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  let historyIndex = 0;
  let historyDraft = '';
  let startupTimer = null;
  let generation = 0;
  let activeSession = null;

  function cancelStartup() {
    window.clearTimeout(startupTimer);
    startupTimer = null;
  }

  function followOutput(update) {
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 48;
    update();
    if (atBottom) window.scrollTo(0, document.documentElement.scrollHeight);
  }

  function appendLine(text) {
    const line = document.createElement('div');
    line.className = 'terminal-line';
    line.textContent = text;
    followOutput(() => output.append(line));
  }

  function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function formatBytes(value, rate = false) {
    if (!finiteNumber(value) || value < 0) return 'N/A';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${numberFormat.format(value)} ${units[unit]}${rate ? '/s' : ''}`;
  }

  function formatTimestamp(value) {
    if (!finiteNumber(value) || value < 0) return 'N/A';
    const date = new Date(value * 1000);
    if (!Number.isFinite(date.getTime())) return 'N/A';
    return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  }

  function createMeter(name) {
    const meter = document.createElement('span');
    meter.className = 'meter';
    meter.setAttribute('role', 'progressbar');
    meter.setAttribute('aria-label', `${name} usage`);
    meter.setAttribute('aria-valuemin', '0');
    meter.setAttribute('aria-valuemax', '100');

    const tracks = [24, 12].map((size) => {
      const track = document.createElement('span');
      track.className = `meter-track meter-track-${size === 24 ? 'desktop' : 'mobile'}`;
      track.setAttribute('aria-hidden', 'true');
      const filled = document.createElement('span');
      const empty = document.createElement('span');
      empty.className = 'meter-empty';
      track.append(filled, empty);
      meter.append(track);
      return { size, filled, empty };
    });
    const value = document.createElement('span');
    value.className = 'meter-value';
    value.setAttribute('aria-hidden', 'true');
    meter.append(value);

    return {
      element: meter,
      update(percent) {
        const valid = finiteNumber(percent);
        const clamped = valid ? Math.min(100, Math.max(0, percent)) : 0;
        const text = valid ? `${clamped.toFixed(1)}%` : 'N/A';
        for (const track of tracks) {
          const filledCount = Math.floor(clamped / 100 * track.size);
          const head = clamped > 0 && clamped < 100 ? '╺' : '';
          track.filled.textContent = '━'.repeat(filledCount) + head;
          track.empty.textContent = '─'.repeat(track.size - filledCount - head.length);
        }
        value.textContent = text;
        meter.setAttribute('aria-valuetext', text);
        if (valid) meter.setAttribute('aria-valuenow', String(clamped));
        else meter.removeAttribute('aria-valuenow');
      },
    };
  }

  function createFrame() {
    const frame = document.createElement('section');
    frame.className = 'stats-frame';
    frame.setAttribute('aria-label', 'System statistics');
    const grid = document.createElement('dl');
    grid.className = 'stats-grid';
    const fields = new Map();
    const names = [
      'System', 'Updated', 'CPU', 'Memory', 'Memory Used / Total',
      'Disk Read', 'Disk Write', 'Network RX', 'Network TX',
    ];

    for (const name of names) {
      const label = document.createElement('dt');
      label.textContent = name;
      const value = document.createElement('dd');
      if (name === 'CPU' || name === 'Memory') {
        const meter = createMeter(name);
        meter.update(null);
        value.append(meter.element);
        fields.set(name, meter.update);
      } else {
        value.textContent = 'N/A';
        fields.set(name, (text) => { value.textContent = text; });
      }
      grid.append(label, value);
    }

    const status = document.createElement('p');
    status.className = 'stats-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = 'Collecting system stats...';
    frame.append(grid, status);
    followOutput(() => output.append(frame));

    return {
      status,
      render(snapshot) {
        followOutput(() => {
          const version = snapshot.system?.version;
          fields.get('System')(typeof version === 'string' && version.trim() ? version : 'N/A');
          fields.get('Updated')(formatTimestamp(snapshot.update_at));
          fields.get('CPU')(snapshot.cpu?.percent);
          fields.get('Memory')(snapshot.memory?.percent);
          fields.get('Memory Used / Total')(`${formatBytes(snapshot.memory?.used)} / ${formatBytes(snapshot.memory?.total)}`);
          fields.get('Disk Read')(formatBytes(snapshot.disk?.read_speed, true));
          fields.get('Disk Write')(formatBytes(snapshot.disk?.write_speed, true));
          fields.get('Network RX')(formatBytes(snapshot.net?.read_speed, true));
          fields.get('Network TX')(formatBytes(snapshot.net?.write_speed, true));
          status.textContent = '';
          status.hidden = true;
        });
      },
    };
  }

  function isCurrent(session) {
    return activeSession === session && session.id === generation;
  }

  function showError(session, message) {
    if (!isCurrent(session)) return;
    followOutput(() => {
      session.view.status.textContent = `showstats: ${message}`;
      session.view.status.hidden = false;
    });
  }

  async function poll(session) {
    if (!isCurrent(session) || session.request) return;
    const request = { controller: new AbortController(), timedOut: false, timeout: null };
    session.request = request;
    request.timeout = window.setTimeout(() => {
      request.timedOut = true;
      request.controller.abort();
      showError(session, 'system stats unavailable.');
    }, 5000);

    try {
      const response = await fetch(terminal.dataset.statsUrl, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: request.controller.signal,
      });
      if (!isCurrent(session) || request.timedOut) return;
      if (!response.ok) {
        showError(session, 'system stats unavailable.');
        return;
      }
      const snapshot = await response.json();
      if (!isCurrent(session) || request.timedOut) return;
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
          || Object.prototype.hasOwnProperty.call(snapshot, 'error')) {
        throw new SyntaxError('Invalid snapshot');
      }
      session.view.render(snapshot);
    } catch (error) {
      if (!isCurrent(session) || request.timedOut) return;
      showError(session, error instanceof SyntaxError
        ? 'invalid system stats.'
        : 'system stats unavailable.');
    } finally {
      window.clearTimeout(request.timeout);
      if (session.request === request) session.request = null;
    }
  }

  function startStats() {
    form.hidden = true;
    input.blur();
    const session = { id: ++generation, view: createFrame(), request: null, interval: null };
    activeSession = session;
    session.interval = window.setInterval(() => poll(session), 2000);
    poll(session);
  }

  function stopStats() {
    const session = activeSession;
    activeSession = null;
    generation += 1;
    if (session) {
      window.clearInterval(session.interval);
      if (session.request) {
        window.clearTimeout(session.request.timeout);
        session.request.controller.abort();
      }
      session.view.status.hidden = true;
    }
    form.hidden = false;
  }

  function submitCommand() {
    if (activeSession) return;
    cancelStartup();
    const raw = input.value;
    const command = raw.trim();
    appendLine(`${prompt.textContent} ${raw}`);
    input.value = '';
    if (command) commandHistory.push(raw);
    historyIndex = commandHistory.length;
    historyDraft = '';

    if (command === 'showstats') {
      startStats();
    } else {
      if (command) {
        const executable = command.split(/\s+/, 1)[0];
        appendLine(`bash: ${executable}: ${deniedCommands.has(executable) ? 'Permission denied' : 'command not found'}`);
      }
      input.focus({ preventScroll: true });
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitCommand();
  });

  input.addEventListener('input', () => {
    cancelStartup();
    historyIndex = commandHistory.length;
    historyDraft = input.value;
  });

  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) cancelStartup();
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    if (historyIndex === commandHistory.length) historyDraft = input.value;
    historyIndex = Math.max(0, Math.min(commandHistory.length,
      historyIndex + (event.key === 'ArrowUp' ? -1 : 1)));
    input.value = historyIndex === commandHistory.length ? historyDraft : commandHistory[historyIndex];
    input.setSelectionRange(input.value.length, input.value.length);
  });

  document.addEventListener('keydown', (event) => {
    if (!event.ctrlKey || event.altKey || event.metaKey || event.key.toLowerCase() !== 'c') return;
    event.preventDefault();
    if (event.repeat) return;
    cancelStartup();
    const wasRunning = Boolean(activeSession);
    stopStats();
    appendLine(wasRunning ? '^C' : `${prompt.textContent} ${input.value}^C`);
    input.value = '';
    historyIndex = commandHistory.length;
    historyDraft = '';
    input.focus({ preventScroll: true });
  });

  terminal.addEventListener('click', () => {
    if (!activeSession && !window.getSelection()?.toString()) input.focus({ preventScroll: true });
  });

  window.addEventListener('pagehide', () => {
    cancelStartup();
    stopStats();
  });

  window.addEventListener('pageshow', (event) => {
    if (event.persisted && !activeSession) input.focus({ preventScroll: true });
  });

  input.focus({ preventScroll: true });
  let typed = 0;
  function typeStartup() {
    input.value = 'showstats'.slice(0, ++typed);
    if (typed === 'showstats'.length) {
      startupTimer = window.setTimeout(submitCommand, 80);
    } else {
      startupTimer = window.setTimeout(typeStartup, 80);
    }
  }
  startupTimer = window.setTimeout(typeStartup, 80);
})();
