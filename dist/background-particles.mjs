export const particleStyles = {
  dust: 'Пыль',
  snow: 'Снег',
  sparks: 'Искры',
};

export const particleSliders = {
  density: { label: 'Плотность', min: 10, max: 100, initial: 45 },
  size: { label: 'Размер', min: 50, max: 200, initial: 100 },
  speed: { label: 'Скорость', min: 0, max: 200, initial: 100 },
  opacity: { label: 'Яркость', min: 10, max: 100, initial: 60 },
};

export function normalizeParticles(value) {
  const settings = {
    enabled: value?.enabled === true,
    style: Object.hasOwn(particleStyles, value?.style) ? value.style : 'dust',
    useThemeColor: value?.useThemeColor !== false,
    color: /^#[a-f\d]{6}$/i.test(value?.color) ? value.color : '#eac593',
  };
  for (const [key, { min, max, initial }] of Object.entries(particleSliders)) {
    const number = value?.[key];
    settings[key] = Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : initial;
  }
  return settings;
}

const motion = {
  dust: { rise: -8, drift: 6, radius: 1.4 },
  snow: { rise: 24, drift: 12, radius: 1.75 },
  sparks: { rise: -38, drift: 10, radius: 1.35 },
};

export function createBackgroundParticles(readColor) {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return () => {};

  canvas.className = 'journal-particles';
  canvas.hidden = true;
  canvas.setAttribute('aria-hidden', 'true');
  document.querySelector('.shell').before(canvas);

  let settings = normalizeParticles();
  const particles = [];
  let width = 0;
  let height = 0;
  let frame = 0;
  let previousTime = 0;
  let phase = 0;
  let color = '';

  function draw(time) {
    frame = 0;
    const animate = settings.speed > 0 && !reducedMotion.matches;
    const dt = animate && previousTime ? Math.min(32, time - previousTime) * settings.speed / 100000 : 0;
    previousTime = time;
    phase += dt;

    const padding = 10;
    const { rise, drift, radius } = motion[settings.style];
    context.clearRect(0, 0, width, height);
    context.fillStyle = context.strokeStyle = color;
    for (const particle of particles) {
      const wave = Math.sin(phase * particle.pace + particle.phase);
      particle.x += (wave * 0.7 + particle.drift) * drift * dt;
      particle.y += rise * particle.pace * dt;
      if (particle.x < -padding) particle.x = width + padding;
      if (particle.x > width + padding) particle.x = -padding;
      if (particle.y < -padding) particle.y = height + padding;
      if (particle.y > height + padding) particle.y = -padding;

      const size = radius * particle.pace * settings.size / 100;
      context.globalAlpha = settings.opacity / 100 * particle.brightness * (0.76 + 0.24 * wave);
      context.beginPath();
      if (settings.style === 'sparks') {
        context.lineWidth = size;
        context.lineCap = 'round';
        context.moveTo(particle.x, particle.y);
        context.lineTo(particle.x - particle.drift * size, particle.y + size * 2.4);
        context.stroke();
      } else {
        context.arc(particle.x, particle.y, size, 0, Math.PI * 2);
        context.fill();
      }
    }
    if (animate) frame = requestAnimationFrame(draw);
  }

  function refresh() {
    cancelAnimationFrame(frame);
    frame = previousTime = 0;
    canvas.hidden = !settings.enabled;
    if (canvas.hidden || document.hidden) return;

    width = canvas.clientWidth;
    height = canvas.clientHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    const count = Math.min(180, Math.max(1, Math.round(width * height * settings.density / 1100000)));
    if (particles.length > count) particles.length = count;
    while (particles.length < count) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        pace: 0.45 + Math.random() * 0.95,
        drift: Math.random() - 0.5,
        brightness: 0.22 + Math.random() * 0.48,
        phase: Math.random() * Math.PI * 2,
      });
    }
    color = settings.useThemeColor ? readColor() : settings.color;
    frame = requestAnimationFrame(draw);
  }

  window.addEventListener('resize', refresh);
  document.addEventListener('visibilitychange', refresh);
  reducedMotion.addEventListener('change', refresh);
  return next => {
    settings = normalizeParticles(next);
    refresh();
  };
}
