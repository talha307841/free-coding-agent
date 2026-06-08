const nav = document.querySelector('.nav');
const navToggle = document.querySelector('.nav-toggle');
const terminalEl = document.getElementById('terminalOutput');
const typewriterHost = document.getElementById('typewriterTerminal');
const copyBtn = document.getElementById('copyInstall');
const installCmd = document.getElementById('installCmd');

window.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('loaded');
  initCodeRain();
  initReveal();
  initTypewriter();
});

if (navToggle && nav) {
  navToggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });
}

if (copyBtn && installCmd) {
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(installCmd.textContent || '');
      copyBtn.textContent = 'Copied';
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
      }, 1400);
    } catch {
      copyBtn.textContent = 'Failed';
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
      }, 1400);
    }
  });
}

function initReveal() {
  const revealNodes = document.querySelectorAll('.reveal');
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
      }
    });
  }, { threshold: 0.15 });

  revealNodes.forEach((node) => obs.observe(node));
}

function initTypewriter() {
  if (!typewriterHost || !terminalEl) {
    return;
  }

  const lines = [
    '$ nim-coder: "remove the scraping bee backend from main.py"',
    '',
    '📄 Read: main.py (lines 337–420) — ScrapingBeeBackend found',
    '✍️  Proposing: −46 lines removed · +0 added',
    '─────────────────────────────────────',
    '[ ✅ Accept Changes ]  [ ✏️ Modify ]  [ ❌ Reject ]',
    '─────────────────────────────────────',
    '✅ main.py saved. 46 lines removed.'
  ];

  let typingTimer = null;
  let active = false;

  const startTyping = () => {
    if (active) {
      return;
    }
    active = true;
    terminalEl.textContent = '';

    let i = 0;
    let j = 0;

    const tick = () => {
      if (!active) {
        return;
      }

      if (i >= lines.length) {
        return;
      }

      const line = lines[i];
      terminalEl.textContent += line.charAt(j);
      j += 1;

      if (j > line.length) {
        terminalEl.textContent += '\n';
        i += 1;
        j = 0;
      }

      typingTimer = window.setTimeout(tick, 30);
    };

    tick();
  };

  const resetTyping = () => {
    active = false;
    if (typingTimer) {
      window.clearTimeout(typingTimer);
      typingTimer = null;
    }
    terminalEl.textContent = '';
  };

  const obs = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        resetTyping();
        startTyping();
      } else {
        resetTyping();
      }
    });
  }, { threshold: 0.25 });

  obs.observe(typewriterHost);
}

function initCodeRain() {
  const canvas = document.getElementById('codeRain');
  if (!canvas) {
    return;
  }

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    return;
  }

  const tokens = ['async', 'await', 'const', 'diff', 'patch', 'grep', 'struct', 'fn', 'impl', 'null', 'true', '===', '-46', '+12', '@@'];
  const colors = [
    { color: '#00ff6a', weight: 0.3 },
    { color: '#00cc55', weight: 0.5 },
    { color: '#00aa44', weight: 0.2 }
  ];

  const fontSize = 16;
  const rowHeight = 22;
  let width = 0;
  let height = 0;
  let drops = [];
  let dpr = 1;

  const pickColor = () => {
    const r = Math.random();
    if (r < colors[0].weight) {
      return colors[0].color;
    }
    if (r < colors[0].weight + colors[1].weight) {
      return colors[1].color;
    }
    return colors[2].color;
  };

  const resetDrop = (index, cols, initial) => {
    drops[index] = {
      x: index,
      y: initial ? Math.random() * (-height / rowHeight) : -Math.random() * 24,
      speed: 0.06 + Math.random() * 0.08,
      token: tokens[(Math.random() * tokens.length) | 0],
      color: pickColor()
    };
  };

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const columns = Math.max(8, Math.floor(width / 48));
    drops = new Array(columns);
    for (let i = 0; i < columns; i += 1) {
      resetDrop(i, columns, true);
    }

    ctx.fillStyle = '#0a0e0c';
    ctx.fillRect(0, 0, width, height);
  };

  let rafId = 0;
  const frame = () => {
    ctx.fillStyle = 'rgba(10, 14, 12, 0.12)';
    ctx.fillRect(0, 0, width, height);

    ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
    ctx.textBaseline = 'top';

    for (let i = 0; i < drops.length; i += 1) {
      const d = drops[i];
      d.y += d.speed;

      if (Math.random() > 0.992) {
        d.token = tokens[(Math.random() * tokens.length) | 0];
        d.color = pickColor();
      }

      const yPx = d.y * rowHeight;
      const xPx = d.x * 48 + 10;
      const alpha = Math.max(0.2, Math.min(0.9, 1 - Math.abs((yPx - height * 0.55) / (height * 0.9))));
      ctx.fillStyle = withAlpha(d.color, alpha);
      ctx.fillText(d.token, xPx, yPx);

      if (yPx > height + 24) {
        resetDrop(i, drops.length, false);
      }
    }

    rafId = window.requestAnimationFrame(frame);
  };

  const withAlpha = (hex, alpha) => {
    const clean = hex.replace('#', '');
    const bigint = parseInt(clean, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  };

  resize();
  frame();

  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('beforeunload', () => {
    if (rafId) {
      window.cancelAnimationFrame(rafId);
    }
  });
}
