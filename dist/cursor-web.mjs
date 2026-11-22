const radius = 300;
const margin = radius + 2;
const diameter = margin * 2;
const spacing = 140;

export function createCursorWeb(readColor) {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const layer = document.createElement('div');
  layer.className = 'cursor-web-layer';
  layer.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  canvas.className = 'cursor-web';
  canvas.hidden = true;
  canvas.style.width = canvas.style.height = diameter + 'px';
  const context = canvas.getContext('2d');
  if (!context) return () => {};
  layer.append(canvas);
  document.body.append(layer);

  let enabled = false;
  let frame = 0;
  let previousTime = 0;
  let x = 0, y = 0;
  let pointerX = 0, pointerY = 0;
  let pixelRatio = 0;
  let columns = 0;
  let rows = 0;
  const anchors = new Map();

  function updateField() {
    columns = Math.ceil(layer.clientWidth / spacing);
    rows = Math.ceil(layer.clientHeight / spacing);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const key = col + ',' + row;
        if (!anchors.has(key)) {
          anchors.set(key, {
            x: (col + Math.random()) * spacing,
            y: (row + Math.random()) * spacing,
          });
        }
      }
    }
  }

  function draw(time) {
    frame = 0;
    const dt = previousTime ? Math.max(0, time - previousTime) : 16;
    previousTime = time;
    const follow = 1 - Math.exp(-dt / 12);
    x += (pointerX - x) * follow;
    y += (pointerY - y) * follow;
    const moving = Math.hypot(pointerX - x, pointerY - y) > 0.2;
    if (!moving) {
      x = pointerX;
      y = pointerY;
    }

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (ratio !== pixelRatio) {
      canvas.width = canvas.height = Math.round(diameter * ratio);
      pixelRatio = ratio;
    }
    const scale = canvas.width / diameter;
    const left = Math.floor(x) - margin;
    const top = Math.floor(y) - margin;
    canvas.style.transform = 'translate3d(' + left + 'px,' + top + 'px,0)';
    context.setTransform(scale, 0, 0, scale, -left * scale, -top * scale);
    context.clearRect(left, top, diameter, diameter);
    context.strokeStyle = context.fillStyle = readColor();
    context.lineWidth = 0.85;

    const lastCol = Math.min(columns - 1, Math.floor((x + radius) / spacing));
    const lastRow = Math.min(rows - 1, Math.floor((y + radius) / spacing));
    for (let row = Math.max(0, Math.floor((y - radius) / spacing)); row <= lastRow; row++) {
      for (let col = Math.max(0, Math.floor((x - radius) / spacing)); col <= lastCol; col++) {
        const point = anchors.get(col + ',' + row);
        const strength = 1 - Math.hypot(point.x - x, point.y - y) / radius;
        if (strength <= 0) continue;
        context.globalAlpha = 0.45 * strength;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(point.x, point.y);
        context.stroke();
        context.globalAlpha = 0.58 * strength;
        context.beginPath();
        context.arc(point.x, point.y, 1.25, 0, Math.PI * 2);
        context.fill();
      }
    }
    if (moving) requestDraw();
  }

  function requestDraw() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  function hide() {
    cancelAnimationFrame(frame);
    frame = previousTime = 0;
    canvas.hidden = true;
  }

  document.addEventListener('pointermove', event => {
    if (!enabled || reducedMotion.matches || event.pointerType !== 'mouse') return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (canvas.hidden) {
      updateField();
      x = pointerX;
      y = pointerY;
      canvas.hidden = false;
    }
    requestDraw();
  }, { passive: true });
  window.addEventListener('resize', () => {
    if (!canvas.hidden) {
      updateField();
      requestDraw();
    }
  });
  document.addEventListener('pointerout', event => { if (!event.relatedTarget) hide(); });
  window.addEventListener('blur', hide);
  reducedMotion.addEventListener('change', hide);
  return value => {
    enabled = value;
    if (!enabled) hide();
  };
}
