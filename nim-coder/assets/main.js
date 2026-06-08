const cursor = document.getElementById('cursor');
const cursorDot = document.getElementById('cursorDot');
const navLinks = document.getElementById('navLinks');
const hamburger = document.getElementById('hamburger');
const navbar = document.getElementById('navbar');
const copyInstallBtn = document.getElementById('copyInstall');
const installCmd = document.getElementById('installCmd');

initCustomCursor();
initCodeRain();
initReveal();
initTerminal();
initCopyInstall();
initNav();

function initCustomCursor() {
  if (!cursor || !cursorDot || window.matchMedia('(max-width: 640px)').matches) {
    return;
  }

  let mouseX = 0;
  let mouseY = 0;
  let cursorX = 0;
  let cursorY = 0;

  document.addEventListener('mousemove', (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
    cursorDot.style.left = `${mouseX - 2}px`;
    cursorDot.style.top = `${mouseY - 2}px`;
  });

  const animate = () => {
    cursorX += (mouseX - cursorX) * 0.18;
    cursorY += (mouseY - cursorY) * 0.18;
    cursor.style.left = `${cursorX - 7}px`;
    cursor.style.top = `${cursorY - 7}px`;
    window.requestAnimationFrame(animate);
  };

  animate();

  const targets = document.querySelectorAll('a, button, .feature-card, .demo-card');
  targets.forEach((el) => {
    el.addEventListener('mouseenter', () => {
      cursor.style.transform = 'scale(2.2)';
      cursor.style.borderColor = 'var(--green5)';
    });
    el.addEventListener('mouseleave', () => {
      cursor.style.transform = 'scale(1)';
      cursor.style.borderColor = 'var(--green)';
    });
  });
}

function initCodeRain() {
  const canvas = document.getElementById('rain-canvas');
  if (!canvas) {
    return;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const chars = [
    'async', 'await', 'const', 'diff', 'grep', 'patch', 'fn', 'impl', 'struct', 'null',
    'true', 'false', '0x1f', '+++', '---', '@@', 'return', 'yield', 'npm', 'git', 'ctx',
    'plan', 'ship', 'merge', '+128', '-46', '[]', '{}', '=>', 'class'
  ];
  const palette = ['#00ff6a', '#00cc55', '#00aa44'];
  let drops = [];

  const init = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    drops = [];
    const cols = Math.floor(canvas.width / 16);

    for (let i = 0; i < cols; i += 1) {
      drops.push({
        x: i * 16,
        y: Math.random() * -canvas.height,
        speed: 0.55 + Math.random() * 1.25,
        opacity: 0.2 + Math.random() * 0.55,
        char: chars[(Math.random() * chars.length) | 0],
        trail: 2 + ((Math.random() * 3) | 0)
      });
    }
  };

  const draw = () => {
    ctx.fillStyle = 'rgba(7, 13, 9, 0.08)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '11px JetBrains Mono, monospace';

    drops.forEach((drop, index) => {
      for (let t = 0; t < drop.trail; t += 1) {
        const y = drop.y - t * 14;
        if (y < -20) {
          continue;
        }
        const alpha = Math.max(0.08, drop.opacity * (1 - t / (drop.trail + 1)));
        ctx.globalAlpha = alpha;
        ctx.fillStyle = palette[(index + t) % palette.length];
        const token = t === 0 ? drop.char : chars[(index + t + ((drop.y * 13) | 0)) % chars.length];
        ctx.fillText(token, drop.x, y);
      }

      drop.y += drop.speed;
      if (Math.random() < 0.02) {
        drop.char = chars[(Math.random() * chars.length) | 0];
      }

      if (drop.y > canvas.height + 40) {
        drop.y = Math.random() * -260;
        drop.opacity = 0.2 + Math.random() * 0.55;
      }
    });

    ctx.globalAlpha = 1;
    window.requestAnimationFrame(draw);
  };

  window.addEventListener('resize', init, { passive: true });
  init();
  draw();
}

function initReveal() {
  const reveals = document.querySelectorAll('.reveal');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  reveals.forEach((node) => observer.observe(node));
}

function initTerminal() {
  const lines = Array.from({ length: 8 }, (_, i) => document.getElementById(`tl${i}`));
  const terminalDemo = document.getElementById('terminal-demo');
  if (!terminalDemo || !lines.length) {
    return;
  }

  let played = false;

  const play = () => {
    if (played) {
      return;
    }
    played = true;

    let delay = 200;
    lines.forEach((line, i) => {
      window.setTimeout(() => {
        if (line) {
          line.style.opacity = '1';
        }
      }, delay);
      delay += i === 0 ? 420 : i === 4 || i === 6 ? 120 : 280;
    });
  };

  const observer = new IntersectionObserver((entries) => {
    if (entries[0] && entries[0].isIntersecting) {
      play();
    }
  }, { threshold: 0.4 });

  observer.observe(terminalDemo);
}

function initCopyInstall() {
  if (!copyInstallBtn || !installCmd) {
    return;
  }

  copyInstallBtn.addEventListener('click', async () => {
    const command = 'git clone https://github.com/talha307841/free-coding-agent\ncd nim-coder && npm install && npm run build';

    try {
      await navigator.clipboard.writeText(command);
      copyInstallBtn.textContent = 'copied!';
      copyInstallBtn.classList.add('copied');
    } catch {
      copyInstallBtn.textContent = 'failed';
    }

    window.setTimeout(() => {
      copyInstallBtn.textContent = 'copy';
      copyInstallBtn.classList.remove('copied');
    }, 2000);
  });
}

function initNav() {
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      navLinks.classList.toggle('open');
    });

    hamburger.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        navLinks.classList.toggle('open');
      }
    });
  }

  if (navbar) {
    window.addEventListener('scroll', () => {
      navbar.style.background = window.scrollY > 60 ? 'rgba(7, 13, 9, 0.97)' : 'rgba(7, 13, 9, 0.88)';
    }, { passive: true });
  }
}
