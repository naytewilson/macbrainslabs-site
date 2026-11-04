// Progressive search of already-rendered, source-linked records. No requests,
// cookies, analytics, remote API, or dynamically injected HTML.
(() => {
  const form = document.querySelector('#evidence-controls');
  const query = document.querySelector('#evidence-query');
  const select = document.querySelector('#evidence-filter');
  const count = document.querySelector('#evidence-count');
  const empty = document.querySelector('#evidence-empty');
  const cards = [...document.querySelectorAll('#evidence-list .evidence-card')];
  if (!form || !query || !select || !count || !empty || cards.length === 0) return;

  const accepted = new Set(['all', 'planner', 'measured', 'note', 'archive']);
  const params = new URLSearchParams(location.search);
  query.value = (params.get('q') || '').slice(0, 160);
  const requested = params.get('kind') || 'all';
  select.value = accepted.has(requested) ? requested : 'all';
  form.hidden = false;

  function update() {
    const raw = query.value.trim().toLocaleLowerCase('en-US');
    const words = raw.split(/\s+/u).filter(Boolean);
    const kind = select.value;
    let visible = 0;
    for (const card of cards) {
      const match = (kind === 'all' || card.dataset.kind === kind) &&
        words.every(word => (card.dataset.search || '').includes(word));
      card.hidden = !match;
      visible += match ? 1 : 0;
    }
    count.textContent = visible + (visible === 1 ? ' public entry' : ' public entries') +
      ' shown from ' + cards.length + ' source-linked records';
    empty.hidden = visible > 0;
    const url = new URL(location.href);
    if (raw) url.searchParams.set('q', raw); else url.searchParams.delete('q');
    if (kind !== 'all') url.searchParams.set('kind', kind); else url.searchParams.delete('kind');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.addEventListener('reset', e => {
    e.preventDefault();
    query.value = '';
    select.value = 'all';
    update();
  });
  update();
})();
