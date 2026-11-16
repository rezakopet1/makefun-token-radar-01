// Token Radar's dashboard: the board, its filters and its detail drawer.
//
// The page reads the data its own program wrote beside it (data.js) and nothing
// else: no network, no fetch, no third-party code. Every number on the page comes
// from that data, and the detail drawer recomputes each row's implied value from the
// row's own breakdown, so the page and board.json always agree. The board tab ranks
// the pre-token protocols; the live tab sets aside the protocols whose token already
// trades, livest market cap first. The hash opens one view at load: #detail=<slug>
// for a protocol, #category=<name> for a filtered board, #tab=live for the live tab.

'use strict';

/** The radar data main.ts wrote, or null when the page loaded without it. */
const DATA = typeof window !== 'undefined' ? (window.TOKEN_RADAR ?? null) : null;

/** Escape text before it joins the page's markup. */
function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** A dollar amount at the scale a reader scans: $2.75B, $539.3M, $207.0K. */
function money(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

/** A signed percentage with two decimals: +2.37%, -2.19%. */
function pct(x) {
  if (x === null || x === undefined) return '—';
  return `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`;
}

/** An age in days as the board shows it: 1.5y once a year old, 352d before that. */
function ageText(days) {
  if (days === null || days === undefined) return '—';
  if (days >= 365) return `${(days / 365).toFixed(1)}y`;
  return `${days}d`;
}

/** A multiple with three decimals, as the drawer prints it: 0.214x. */
function mult3(x) {
  return `${x.toFixed(3)}x`;
}

/** The page's filter and sort state; the hash may preset it at load. */
const state = {
  tab: 'pre',
  query: '',
  category: 'all',
  chain: 'all',
  watchlistOnly: false,
  sortKey: 'rank',
  sortDir: 1,
  selected: null,
};

/** The rows the active tab shows, before the filters narrow them. */
function tabRows() {
  return state.tab === 'live' ? DATA.live : DATA.rows;
}

/** The distinct values of one field across the active tab's rows, in order. */
function distinct(field) {
  const seen = new Set();
  for (const row of tabRows()) {
    const values = field === 'chains' ? row.chains : [row[field]];
    for (const value of values) {
      if (value !== null && value !== undefined && value !== '') seen.add(value);
    }
  }
  return [...seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The rows after every filter, in the table's current sort order. */
function visibleRows() {
  const q = state.query.trim().toLowerCase();
  let rows = tabRows().filter((row) => {
    if (state.watchlistOnly && !row.watchlist) return false;
    if (state.category !== 'all' && row.category !== state.category) return false;
    if (state.chain !== 'all' && !row.chains.includes(state.chain)) return false;
    if (q !== '') {
      const hay = `${row.name} ${row.category ?? ''} ${row.chains.join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const key = state.sortKey;
  const dir = state.sortDir;
  // Live rows carry no rank field: their "#" is their place by market cap.
  const liveRank = new Map(DATA.live.map((row, i) => [row.slug, i]));
  const valueOf = (row) => {
    if (key === 'rank' && state.tab === 'live') return liveRank.get(row.slug) ?? 0;
    if (key === 'value') return state.tab === 'live' ? row.mcap_usd : row.implied_value_usd;
    if (key === 'age') return row.age_days === null ? -1 : row.age_days;
    if (key === 'change') return row.change_7d === null ? -Infinity : row.change_7d;
    return row[key];
  };
  rows = [...rows].sort((a, b) => {
    const va = valueOf(a);
    const vb = valueOf(b);
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  return rows;
}

// ---------------------------------------------------------------- the page shell

/** The five leader cards: the board's top five, at a glance, above the table. */
function leadersHtml() {
  return DATA.rows
    .slice(0, 5)
    .map(
      (row) => `<button type="button" class="leader" data-slug="${esc(row.slug)}">
        <span class="rank">Rank ${row.rank}</span>
        <b>${esc(row.name)}</b>
        <span class="sub">${esc(row.category ?? 'No category')} · ${money(row.tvl_usd)} TVL</span>
        <span class="value">${money(row.implied_value_usd)} implied</span>
      </button>`,
    )
    .join('');
}

/** The model section: the formula in words, then every derived multiple. */
function modelHtml() {
  const rows = DATA.multiples
    .map(
      (m) => `<div class="row"><span>${esc(m.category)}${m.fallback ? ' · global median' : ''}</span><b>${mult3(m.multiple)}</b><span class="n">n=${m.token_count}</span></div>`,
    )
    .join('');
  return `<section class="panel model" aria-label="How the value is modelled">
    <h2>How the value is modelled</h2>
    <p class="formula">implied value = TVL × category multiple × growth multiplier × maturity multiplier × chain multiplier</p>
    <p>The category multiple is the median market-cap/TVL ratio of the protocols in that category whose token already trades — at least three of them, and a median between 0.02x and 1.00x. Anything thinner falls back to the snapshot's global median, ${mult3(DATA.global_multiple)}. Growth is half the seven-day TVL change, clamped to −60%…+120%. Maturity runs from 0.6 for a new listing to 1.0 at three years. Each chain past the first adds 4%, capped at 1.16x. The multiples below are the ones this snapshot derives; a row marked global median borrows the snapshot's own median instead.</p>
    <div class="multiples">${rows}</div>
  </section>`;
}

/** Build the page's static structure once, then hand the table to renderTable. */
function renderShell() {
  const main = document.getElementById('board');
  const floorM = `$${Math.round(DATA.floor_usd / 1e6)}M`;
  main.innerHTML = `<div class="shell">
    <header class="band">
      <div class="top">
        <div class="brand"><span class="mark" aria-hidden="true"></span><span class="brand-name">Token Radar</span></div>
        <div class="top-meta"><span>Snapshot ${esc(DATA.as_of)}</span><span>DefiLlama protocol index</span><span>radar-2 model</span></div>
      </div>
      <h1>Every protocol with no token yet, ranked by what its launch could be worth</h1>
      <p class="lede-p">The implied value is a model of the snapshot figures, not a price and not a promise. The watchlist is the floor; the early radar adds every other pre-token protocol the snapshot holds.</p>
    </header>
    <section class="lede">
      <div>
        <h2>${DATA.watchlist_total} watchlist protocols, ranked by implied value</h2>
        <p>The watchlist is every protocol with at least ${floorM} of TVL and no token on record. The early radar adds ${DATA.early_size - DATA.watchlist_total} more pre-token protocols the snapshot holds, ${DATA.early_below_floor} of them below that floor, so the board holds ${DATA.early_size} rows in all. Protocols whose token already trades are set aside with their market caps shown.</p>
      </div>
      <div class="facts">
        <div class="fact"><span>Watchlist covered</span><b>${DATA.watchlist_covered} / ${DATA.watchlist_total}</b></div>
        <div class="fact"><span>Pre-token rows scored</span><b>${DATA.early_size}</b></div>
        <div class="fact"><span>Early rows beyond the watchlist</span><b>${DATA.early_size - DATA.watchlist_total}</b></div>
        <div class="fact"><span>Live-token protocols set aside</span><b>${DATA.live_size}</b></div>
      </div>
    </section>
    <section class="leaders" aria-label="Radar leaders">${leadersHtml()}</section>
    <div class="controls">
      <div class="field"><label for="q">Search</label><input id="q" type="search" placeholder="Search name, category or chain" autocomplete="off"></div>
      <div class="field"><label for="cat">Category</label><select id="cat"></select></div>
      <div class="field"><label for="chain">Chain</label><select id="chain"></select></div>
      <label class="check"><input id="watch" type="checkbox"> Watchlist only</label>
      <div class="tabs" role="group" aria-label="Token status">
        <button id="tab-pre" type="button" aria-pressed="true">Pre-token</button>
        <button id="tab-live" type="button" aria-pressed="false">Live token</button>
      </div>
      <span class="count" id="count"></span>
    </div>
    <section class="panel" id="board-panel" aria-label="The board"></section>
    ${modelHtml()}
    <dialog class="detail" id="detail"></dialog>
  </div>`;

  document.getElementById('q').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderTable();
  });
  document.getElementById('cat').addEventListener('change', (e) => {
    state.category = e.target.value;
    renderTable();
  });
  document.getElementById('chain').addEventListener('change', (e) => {
    state.chain = e.target.value;
    renderTable();
  });
  document.getElementById('watch').addEventListener('change', (e) => {
    state.watchlistOnly = e.target.checked;
    renderTable();
  });
  document.getElementById('tab-pre').addEventListener('click', () => switchTab('pre'));
  document.getElementById('tab-live').addEventListener('click', () => switchTab('live'));
  main.querySelectorAll('.leader').forEach((card) => {
    card.addEventListener('click', () => openDetail(card.dataset.slug));
  });
  rebuildOptions();
}

/** Refill the category and chain selects from the active tab's rows. */
function rebuildOptions() {
  const cat = document.getElementById('cat');
  const chain = document.getElementById('chain');
  const keepCat = state.category;
  const keepChain = state.chain;
  cat.innerHTML =
    '<option value="all">All categories</option>' +
    distinct('category')
      .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
      .join('');
  chain.innerHTML =
    '<option value="all">All chains</option>' +
    distinct('chains')
      .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
      .join('');
  cat.value = distinct('category').includes(keepCat) ? keepCat : 'all';
  chain.value = distinct('chains').includes(keepChain) ? keepChain : 'all';
  state.category = cat.value;
  state.chain = chain.value;
}

/** Switch the board between the pre-token rows and the live-token rows. */
function switchTab(tab) {
  if (state.tab === tab) return;
  state.tab = tab;
  state.sortKey = 'rank';
  state.sortDir = 1;
  state.selected = null;
  document.getElementById('tab-pre').setAttribute('aria-pressed', String(tab === 'pre'));
  document.getElementById('tab-live').setAttribute('aria-pressed', String(tab === 'live'));
  const watch = document.getElementById('watch');
  watch.checked = false;
  state.watchlistOnly = false;
  watch.disabled = tab === 'live';
  rebuildOptions();
  renderTable();
}

// ---------------------------------------------------------------- the table

/** The sort direction a column starts with when it is first picked. */
const SORT_DEFAULT = { rank: 1, name: 1, tvl: -1, change: -1, age: -1, value: -1 };

/** A sortable column head: its label, plus an arrow while it sorts the table. */
function headCell(key, label) {
  const arrow = state.sortKey === key ? (state.sortDir === 1 ? ' ▲' : ' ▼') : '';
  return `<th scope="col"><button type="button" data-sort="${key}">${label}${arrow}</button></th>`;
}

/** Render the board panel for the current tab, filters and sort. */
function renderTable() {
  const panel = document.getElementById('board-panel');
  const rows = visibleRows();
  const live = state.tab === 'live';
  const count = document.getElementById('count');
  count.textContent = `${rows.length} row${rows.length === 1 ? '' : 's'} shown`;

  if (rows.length === 0) {
    panel.innerHTML = `<div class="empty">
      <h2>No protocols match</h2>
      <p>Try a different search, category or chain — or clear the filters.</p>
      <button type="button" class="button primary" id="reset-filters">Clear filters</button>
    </div>`;
    document.getElementById('reset-filters').addEventListener('click', () => {
      state.query = '';
      state.category = 'all';
      state.chain = 'all';
      state.watchlistOnly = false;
      document.getElementById('q').value = '';
      document.getElementById('watch').checked = false;
      rebuildOptions();
      renderTable();
    });
    return;
  }

  const valueOf = (row) => (live ? row.mcap_usd : row.implied_value_usd);
  const max = rows.reduce((m, row) => Math.max(m, valueOf(row)), 0);
  const liveRank = new Map(DATA.live.map((row, i) => [row.slug, i + 1]));
  const note = live
    ? 'Protocols whose token already trades, livest market cap first. Select a row for its market cap and TVL.'
    : 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.';
  const body = rows
    .map((row) => {
      const value = valueOf(row);
      const width = Math.max(2, Math.round((value / max) * 100));
      const changeClass = row.change_7d === null ? '' : row.change_7d >= 0 ? ' pos' : ' neg';
      const shownChains = row.chains.slice(0, 2).join(', ');
      const more = row.chains.length > 2 ? ` +${row.chains.length - 2}` : '';
      return `<tr data-slug="${esc(row.slug)}" data-selected="${state.selected === row.slug}">
        <td class="num">${live ? liveRank.get(row.slug) : row.rank}</td>
        <td><span class="name"><b>${esc(row.name)}${row.watchlist ? ' <span class="watch-tag">WATCHLIST</span>' : ''}</b><span class="sub">${esc(row.category ?? 'No category')} on ${esc(shownChains)}${more}</span></span></td>
        <td class="num">${money(row.tvl_usd)}</td>
        <td class="num${changeClass}">${pct(row.change_7d)}</td>
        <td class="num">${ageText(row.age_days)}</td>
        <td><span class="implied"><span class="bar" aria-hidden="true"><i style="width:${width}%"></i></span><span class="num">${money(value)}</span></span></td>
        <td><span class="status${row.watchlist ? ' watch' : ''}">${live ? 'live token' : 'no token'}</span></td>
      </tr>`;
    })
    .join('');

  panel.innerHTML = `<p style="padding:12px 12px 0;color:var(--muted);font-size:13px">${note}</p>
    <div class="table-wrap"><table>
      <thead><tr>
        ${headCell('rank', live ? '#' : 'Rank')}
        ${headCell('name', 'Protocol')}
        ${headCell('tvl', 'TVL')}
        ${headCell('change', '7d')}
        ${headCell('age', 'Age')}
        ${headCell('value', live ? 'Market cap' : 'Implied value')}
        <th scope="col">Token</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;

  panel.querySelectorAll('th button').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.sort;
      if (state.sortKey === key) {
        state.sortDir = -state.sortDir;
      } else {
        state.sortKey = key;
        state.sortDir = SORT_DEFAULT[key] ?? -1;
      }
      renderTable();
    });
  });
  panel.querySelectorAll('tbody tr').forEach((tr) => {
    tr.addEventListener('click', () => openDetail(tr.dataset.slug));
  });
}

// ---------------------------------------------------------------- the detail drawer

/** Find a row by slug across both tabs, naming which tab it belongs to. */
function findRow(slug) {
  const pre = DATA.rows.find((row) => row.slug === slug);
  if (pre) return { row: pre, live: false };
  const live = DATA.live.find((row) => row.slug === slug);
  if (live) return { row: live, live: true };
  return null;
}

/** One farm step, split into its action and its cost line, as the drawer shows it. */
function stepHtml(step) {
  const at = step.indexOf(' Cost: ');
  if (at < 0) return `<li><b>${esc(step)}</b></li>`;
  return `<li><b>${esc(step.slice(0, at))}</b><span class="cost">Cost: ${esc(step.slice(at + 7))}</span></li>`;
}

/** The drawer's body for a pre-token row: the whole equation, why it ranks, the plan. */
function preDetailHtml(row) {
  const recomputed = Math.round(
    row.tvl_usd * row.category_multiple * row.growth_mult * row.maturity_mult * row.chain_mult,
  );
  const age = row.age_days === null ? 'an unrecorded age' : ageText(row.age_days);
  return `<div class="detail-head"><div>
      <span class="sub">RANK ${row.rank} OF ${DATA.rows.length}${row.watchlist ? ' · WATCHLIST' : ''}</span>
      <h2>${esc(row.name)}</h2>
      <p class="sub">${esc(row.category ?? 'No category')} on ${esc(row.chains.join(', '))}</p>
    </div><button class="close" type="button">Close</button></div>
    <div class="detail-section"><h3>Implied value</h3>
      <div class="equation">
        <div><span>TVL</span><b>${money(row.tvl_usd)}</b></div>
        <div><span>Category multiple</span><b>${mult3(row.category_multiple)}</b></div>
        <div><span>Seven-day growth</span><b>${pct(row.change_7d)}</b></div>
        <div><span>Age with no token</span><b>${ageText(row.age_days)}</b></div>
        <div><span>Growth multiplier</span><b>${row.growth_mult.toFixed(3)}</b></div>
        <div><span>Maturity multiplier</span><b>${row.maturity_mult.toFixed(4)}</b></div>
        <div><span>Chain multiplier</span><b>${row.chain_mult.toFixed(2)}</b></div>
        <div><span>Implied value</span><b>${money(row.implied_value_usd)}</b></div>
      </div>
      <p class="why">Rank ${row.rank} because: TVL ${money(row.tvl_usd)} at a ${mult3(row.category_multiple)} category multiple, 7-day growth ${pct(row.change_7d)}, ${age} with no token on record, live on ${row.chains.length} chain${row.chains.length === 1 ? '' : 's'}.</p>
      <p class="why">Model radar-2: the same function scores every protocol. The page recomputes this row as ${money(recomputed)}, the same number board.json carries. This is an estimate, not a price.</p>
    </div>
    <div class="detail-section"><h3>Farm plan</h3>
      <ol class="steps">${row.farm_steps.map(stepHtml).join('')}</ol>
    </div>`;
}

/** The drawer's body for a live row: market cap against TVL, and no farm plan. */
function liveDetailHtml(row) {
  const ratio = row.tvl_usd > 0 ? row.mcap_usd / row.tvl_usd : 0;
  return `<div class="detail-head"><div>
      <span class="sub">LIVE TOKEN · MARKET CAP ${money(row.mcap_usd)}</span>
      <h2>${esc(row.name)}</h2>
      <p class="sub">${esc(row.category ?? 'No category')} on ${esc(row.chains.join(', '))}</p>
    </div><button class="close" type="button">Close</button></div>
    <div class="detail-section"><h3>Market cap</h3>
      <div class="equation">
        <div><span>TVL</span><b>${money(row.tvl_usd)}</b></div>
        <div><span>Market cap</span><b>${money(row.mcap_usd)}</b></div>
        <div><span>Market cap / TVL</span><b>${ratio.toFixed(3)}x</b></div>
        <div><span>Seven-day growth</span><b>${pct(row.change_7d)}</b></div>
        <div><span>Age</span><b>${ageText(row.age_days)}</b></div>
      </div>
      <p class="why">The token already trades: the market cap is ${money(row.mcap_usd)}, ${ratio.toFixed(3)}x its TVL of ${money(row.tvl_usd)}. This row is set aside from the board, so there is no farm plan for it — the launch already happened.</p>
    </div>`;
}

/** Open the drawer for one slug, marking its row selected in the table. */
function openDetail(slug) {
  const found = findRow(slug);
  if (!found) return;
  state.selected = slug;
  const dialog = document.getElementById('detail');
  dialog.innerHTML = found.live ? liveDetailHtml(found.row) : preDetailHtml(found.row);
  dialog.querySelector('.close').addEventListener('click', () => dialog.close());
  if (!dialog.open) dialog.showModal();
  document.querySelectorAll('tbody tr').forEach((tr) => {
    tr.dataset.selected = String(tr.dataset.slug === slug);
  });
}

/** Read the hash once at load: a tab, a category filter, or a protocol to open. */
function readHash() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  return {
    tab: params.get('tab'),
    category: params.get('category'),
    detail: params.get('detail'),
  };
}

/** Build the page, apply the hash, and hand the board to the reader. */
function init() {
  const main = document.getElementById('board');
  if (!DATA || !Array.isArray(DATA.rows) || !Array.isArray(DATA.live)) {
    main.innerHTML =
      '<div class="shell"><div class="empty"><h2>The radar has no data</h2><p>data.js did not load beside this page.</p></div></div>';
    main.setAttribute('aria-busy', 'false');
    return;
  }
  renderShell();
  const hash = readHash();
  if (hash.tab === 'live') switchTab('live');
  if (hash.category && distinct('category').includes(hash.category)) {
    state.category = hash.category;
    document.getElementById('cat').value = hash.category;
  }
  renderTable();
  const dialog = document.getElementById('detail');
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    state.selected = null;
    document.querySelectorAll('tbody tr').forEach((tr) => {
      tr.dataset.selected = 'false';
    });
  });
  main.setAttribute('aria-busy', 'false');
  if (hash.detail) openDetail(hash.detail);
}

init();
