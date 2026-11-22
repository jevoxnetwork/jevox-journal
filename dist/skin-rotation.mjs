export function enableSkinRotation() {
  const angles = new WeakMap();
  let drag;

  function readAngles(stage) {
    return angles.get(stage) ?? {yaw: 0, pitch: 0};
  }

  function rotate(stage, yaw, pitch) {
    yaw %= 360;
    pitch = Math.max(-45, Math.min(45, pitch));
    angles.set(stage, {yaw, pitch});
    stage.style.setProperty('--skin-yaw', yaw + 'deg');
    stage.style.setProperty('--skin-pitch', pitch + 'deg');
  }

  document.addEventListener('pointerdown', event => {
    const stage = event.target.closest('[data-rotate-skin]');
    if (!stage || event.button !== 0 || drag?.stage.isConnected) return;
    drag = {
      stage, pointerId: event.pointerId,
      x: event.clientX, y: event.clientY, ...readAngles(stage),
    };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add('skin-dragging');
  });

  document.addEventListener('pointermove', event => {
    if (event.pointerId !== drag?.pointerId) return;
    const yaw = drag.yaw + (event.clientX - drag.x) * 0.85;
    const pitch = event.pointerType === 'touch' ? drag.pitch : drag.pitch - (event.clientY - drag.y) * 0.5;
    rotate(drag.stage, yaw, pitch);
  });

  function stopDrag(event) {
    if (event.pointerId !== drag?.pointerId) return;
    drag.stage.classList.remove('skin-dragging');
    drag = undefined;
  }

  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    document.addEventListener(event, stopDrag);
  }

  const arrowSteps = {ArrowLeft: [-15, 0], ArrowRight: [15, 0], ArrowUp: [0, 10], ArrowDown: [0, -10]};
  document.addEventListener('keydown', event => {
    const stage = event.target.closest('[data-rotate-skin]');
    if (!stage) return;
    if (event.key === 'Home') {
      event.preventDefault();
      rotate(stage, 0, 0);
    } else if (Object.hasOwn(arrowSteps, event.key)) {
      event.preventDefault();
      const {yaw, pitch} = readAngles(stage);
      const [yawStep, pitchStep] = arrowSteps[event.key];
      rotate(stage, yaw + yawStep, pitch + pitchStep);
    }
  });
}
