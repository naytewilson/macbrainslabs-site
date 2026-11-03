// Notch: play the walk when it is on screen, then hand off to the emblem's
// sway loop forever. Both pause while off screen.
//
// Only a real refusal to play (NotAllowedError, for example iOS Low Power
// Mode) shows the fallback: the final still with the sway as a small animated
// image. The first tap or key press then plays the walk from the start. A
// play() interrupted by a pause (AbortError, which happens whenever the reader
// scrolls past before the video has loaded) is not a refusal and is ignored.
// Reduce Motion keeps the still and loads nothing.
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
  let seen = false;
  let sway = null;

  const settle = (p) => p && p.catch((e) => { if (e && e.name === 'NotAllowedError') fallback(); });

  function fallback() {
    if (frame.classList.contains('is-fallback')) return;
    intro.pause();
    loop.pause();
    if (!sway) {
      sway = new Image(280, 1264);
      sway.className = 'notch-sway';
      sway.alt = '';
      sway.decoding = 'async';
      sway.src = '/assets/notch-sway.avif';
      frame.append(sway);
    }
    frame.classList.add('is-fallback');
    for (const t of ['pointerup', 'keydown']) addEventListener(t, retry, { once: true, passive: true });
  }

  // A tap or key press is a user gesture, so the browser lets the walk play now.
  function retry() {
    for (const t of ['pointerup', 'keydown']) removeEventListener(t, retry);
    state = 'intro';
    frame.classList.remove('is-looping', 'is-fallback');
    intro.currentTime = 0;
    const p = intro.play();
    if (!p) return;
    p.then(() => { if (sway) { sway.remove(); sway = null; } }, () => fallback());
  }

  function toLoop() {
    if (state !== 'intro') return;
    state = 'loop';
    loop.currentTime = 0;
    const show = () => frame.classList.add('is-looping');
    if (loop.requestVideoFrameCallback) loop.requestVideoFrameCallback(show); else loop.addEventListener('playing', show, { once: true });
    settle(loop.play());
  }

  function run() {
    if (frame.classList.contains('is-fallback')) return;
    if (!visible || document.hidden) {
      if (!intro.paused) intro.pause();
      if (!loop.paused) loop.pause();
      return;
    }
    if (state === 'intro') {
      // The browser may start the walk before it is on screen: start it over the first time it is seen.
      if (!seen) { seen = true; if (intro.currentTime > 0.25 && !intro.ended) intro.currentTime = 0; }
      if (intro.paused && !intro.ended) settle(intro.play());
    } else if (loop.paused) settle(loop.play());
  }

  intro.addEventListener('ended', toLoop);
  document.addEventListener('visibilitychange', run);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; run(); }, { threshold: 0.25 }).observe(frame);
})();
