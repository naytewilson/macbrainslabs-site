// Notch: play the walk when it is on screen, then hand off to the emblem's
// sway loop forever. Both pause while off screen.
//
// When the browser refuses to play video without a tap (NotAllowedError, for
// example iOS Low Power Mode), the same walk-then-sway plays as an image:
// Safari plays an MP4 in <img> like a GIF, with no tap and no autoplay rule.
// Browsers that cannot do that get the final still with the sway as a small
// animated image, and a tap plays the walk. A play() interrupted by a pause
// (AbortError, from scrolling past before the video loaded) is ignored.
// Reduce Motion keeps the still and loads nothing.
(() => {
  const frame = document.querySelector('.notch-frame');
  if (!frame || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const intro = frame.querySelector('.notch-video');
  const loop = document.createElement('video');
  for (const [k, v] of [['class', 'notch-loop'], ['muted', ''], ['playsinline', ''], ['loop', ''], ['preload', 'none'], ['aria-hidden', 'true'], ['disablepictureinpicture', ''], ['disableremoteplayback', '']]) loop.setAttribute(k, v);
  loop.muted = loop.defaultMuted = true;
  loop.src = '/assets/notch-loop.mp4';
  frame.append(loop);

  let state = 'intro';
  let visible = false;
  let seen = false;
  let mode = 'video';
  let sway = null;

  const refused = (e) => e && e.name === 'NotAllowedError';
  const settle = (p, then) => p && p.catch((e) => { if (refused(e)) then(); });

  function stopVideo() {
    intro.pause();
    loop.pause();
  }

  // Walk then sway, as an image. Until it has loaded, the walk's first frame stays up.
  function imageWalk() {
    if (mode !== 'video') return;
    mode = 'image';
    stopVideo();
    const img = new Image(1350, 1890);
    img.className = 'notch-anim';
    img.alt = '';
    img.decoding = 'async';
    img.onload = () => (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(() => { if (mode === 'image') frame.classList.add('is-anim'); });
    img.onerror = () => { img.remove(); mode = 'video'; swayStill(); };
    img.src = '/assets/notch-img.mp4';
    frame.append(img);
  }

  // Last resort: the final still with the sway over the emblem; a tap plays the walk.
  function swayStill() {
    if (mode === 'still') return;
    mode = 'still';
    stopVideo();
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

  function retry() {
    for (const t of ['pointerup', 'keydown']) removeEventListener(t, retry);
    mode = 'video';
    state = 'intro';
    frame.classList.remove('is-looping', 'is-fallback');
    intro.currentTime = 0;
    const p = intro.play();
    if (!p) return;
    p.then(() => { if (sway) { sway.remove(); sway = null; } }, () => swayStill());
  }

  function toLoop() {
    if (state !== 'intro' || mode !== 'video') return;
    state = 'loop';
    loop.currentTime = 0;
    const show = () => frame.classList.add('is-looping');
    if (loop.requestVideoFrameCallback) loop.requestVideoFrameCallback(show); else loop.addEventListener('playing', show, { once: true });
    settle(loop.play(), swayStill);
  }

  function run() {
    if (mode !== 'video') return;
    if (!visible || document.hidden) {
      if (!intro.paused) intro.pause();
      if (!loop.paused) loop.pause();
      return;
    }
    if (state === 'intro') {
      // The browser may start the walk before it is on screen: start it over the first time it is seen.
      if (!seen) { seen = true; if (intro.currentTime > 0.25 && !intro.ended) intro.currentTime = 0; }
      if (intro.paused && !intro.ended) settle(intro.play(), imageWalk);
    } else if (loop.paused) settle(loop.play(), swayStill);
  }

  intro.addEventListener('ended', toLoop);
  document.addEventListener('visibilitychange', run);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; run(); }, { threshold: 0.25 }).observe(frame);
})();
