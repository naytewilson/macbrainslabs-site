// Notch: play the intro once when it is on screen, then hand off to the
// emblem's sway loop forever. If the browser refuses video playback (for
// example iOS Low Power Mode), show the final still with the sway as a small
// animated image instead. Reduce Motion keeps the still and loads nothing.
(() => {
  const frame = document.querySelector('.notch-frame');
  if (!frame || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const intro = frame.querySelector('.notch-video');
  const loop = document.createElement('video');
  for (const [k, v] of [['class', 'notch-loop'], ['muted', ''], ['playsinline', ''], ['loop', ''], ['preload', 'auto'], ['aria-hidden', 'true'], ['disablepictureinpicture', ''], ['disableremoteplayback', '']]) loop.setAttribute(k, v);
  loop.muted = loop.defaultMuted = true;
  loop.src = '/assets/notch-loop.mp4';
  frame.append(loop);

  let state = 'intro';
  let visible = false;
  const settle = (p) => p && p.catch(() => fallback());

  function fallback() {
    if (state === 'fallback') return;
    state = 'fallback';
    intro.pause();
    loop.pause();
    loop.removeAttribute('src');
    loop.load();
    const sway = new Image(280, 1264);
    sway.className = 'notch-sway';
    sway.alt = '';
    sway.decoding = 'async';
    sway.src = '/assets/notch-sway.avif';
    frame.append(sway);
    frame.classList.add('is-fallback');
  }

  function toLoop() {
    if (state !== 'intro') return;
    state = 'loop';
    loop.currentTime = 0;
    const p = loop.play();
    const show = () => frame.classList.add('is-looping');
    if (loop.requestVideoFrameCallback) loop.requestVideoFrameCallback(show); else loop.addEventListener('playing', show, { once: true });
    settle(p);
  }

  function run() {
    if (!visible || document.hidden) {
      intro.pause();
      loop.pause();
      return;
    }
    if (state === 'intro') settle(intro.play());
    else if (state === 'loop') settle(loop.play());
  }

  intro.addEventListener('ended', toLoop);
  document.addEventListener('visibilitychange', run);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; run(); }, { threshold: 0.35 }).observe(frame);
})();
