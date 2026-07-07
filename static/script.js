// India Economic Slowdown Detector — Frontend

const loadingMessages = [
  "Decoding India’s economic signals...",
  "Building slowdown model...",
  "Fetching live macro data...",
  "Calculating risk score...",
  "Generating insights..."
];

let loadingIndex = 0;

const loadingInterval = setInterval(() => {
  const loadingText = document.getElementById("loading-text");
  if (loadingText) {
    loadingText.textContent = loadingMessages[loadingIndex];
    loadingIndex = (loadingIndex + 1) % loadingMessages.length;
  }
}, 1500);

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const NOW = new Date();
function mLabel(off) {
  const d = new Date(NOW); d.setMonth(d.getMonth()+off);
  return MONTHS[d.getMonth()]+"'"+ String(d.getFullYear()).slice(2);
}
const TLABELS = Array.from({length:12},(_,i)=>mLabel(i-11));

let trendChart=null, gaugeChart=null, featChart=null, histChart=null, modalFeatChart=null;
let selectedSec = 'manufacturing';
const SEC_KEYS = ['manufacturing','banking','agriculture','trade','employment'];
const SEC_ICONS = {
  manufacturing: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle"><path d="M2 20h20M4 20V8l6 4V8l6 4V4l4 4v12"/></svg>',
  banking:       '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  agriculture:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle"><path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10S2 17.52 2 12"/><path d="M12 6v6l4 2"/></svg>',
  trade:         '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>',
  employment:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
};

const FEAT_IMP = {
  'Unemployment':   0.171,
  'CPI Inflation':  0.157,
  'GDP Growth':     0.129,
  'PMI':            0.123,
  'Credit Growth':  0.099,
  'Export Growth':  0.081,
  'Repo Rate':      0.079,
  'Agri GVA':       0.059,
  'GDP Momentum':   0.053,
  'Export (neg)':   0.027,
};

// Historical GDP comparison data (MOSPI real)
// Historical data — annual FY averages from training_data_v2.csv (52 quarters)
const HIST_LABELS = ['FY18','FY19','FY20','FY21','FY22','FY23','FY24','FY25'];
const HIST_DATA = {
  gdp:     [6.8, 6.5, 3.9, -6.0, 10.6, 7.8, 9.2, 6.5],
  exports: [12.4, 9.7, -9.7, 0.9, 36.0, 3.1, 6.4, 14.7],
  unemp:   [8.2, 8.0, 9.4, 13.2, 8.0, 7.8, 7.7, 8.1],
};

// Removes the shimmering skeleton placeholders (see .sk in style.css) once
// real values have been written into the DOM.
function clearSkeletons() {
  document.querySelectorAll('.sk').forEach(el => el.classList.remove('sk'));
}

async function apiFetch(url, options) {
  try {
    const r = await fetch(url, options);
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.error(`apiFetch failed: ${url} -> ${r.status} ${r.statusText}`, body);
      return null;
    }
    return await r.json();
  } catch (err) {
    console.error(`apiFetch network error: ${url}`, err);
    return null;
  }
}

function setHeroBanner(risk, label) {
  const banner = null;
  const status = document.getElementById('sb-status-label');
  const sub = null;
  const scoreEl = document.getElementById('sb-score-num');
  if(scoreEl) {
    scoreEl.textContent = risk;
    const topFactors = Object.entries(FEAT_IMP).slice(0,3).map(([k,v])=>`${k}: ${Math.round(v*100)}%`).join(' · ');
    scoreEl.title = `Risk Score ${risk}/100\nTop factors: ${topFactors}\n\n0–30: Low risk (Stable)\n31–60: Moderate (Watch)\n61–100: High risk (Slowdown)`;
    scoreEl.style.cursor = 'help';
  }
  // Use a GPU-accelerated transform instead of animating `width` — avoids
  // layout recalculation / jank on mobile and eliminates layout shift (CLS).
  const fillEl = document.getElementById('sb-score-fill');
  if (fillEl) fillEl.style.transform = `scaleX(${Math.max(0, Math.min(100, risk)) / 100})`;

  const cfg = {
    'Stable':   ['green', 'Economy Stable', 'No immediate slowdown signals detected across major sectors'],
    'Warning':  ['amber', 'Moderate Warning', 'Trade exports declining & credit growth softening — watch closely'],
    'Slowdown': ['red',   'Slowdown Detected', 'Multiple sector alerts triggered — high economic risk'],
  };
  const [cls, st, sb] = cfg[label] || ['', 'Analyzing…', 'Fetching live indicators'];
  const sbStatus = document.getElementById('sb-status'); if(sbStatus) sbStatus.className = 'sb-status ' + cls;
  if(status) status.textContent = st;
  // sub removed
}

function setMacro(data) {
  const ind = data.indicators;
  const fs = ind.field_sources || {};
  document.getElementById('m-gdp').textContent   = ind.gdp_growth + '%';
  document.getElementById('m-cpi').textContent   = ind.cpi + '%';
  const cpiD = document.getElementById('m-cpi-d');
  cpiD.textContent = ind.cpi > 6 ? '↑ Above 6% upper band' : ind.cpi > 4 ? '↑ Above 4% target' : '→ Near target';
  cpiD.className = 'macro-delta ' + (ind.cpi > 4 ? 'down' : 'up');
  document.getElementById('m-repo').textContent  = ind.repo_rate + '%';
  document.getElementById('m-fx').textContent    = '₹' + ind.inr_usd;
  document.getElementById('m-exp').textContent   = ind.export_growth + '%';
  document.getElementById('m-exp-d').textContent = ind.export_growth < 0 ? '↓ Declining' : '↑ Growing';
  document.getElementById('m-exp-d').className   = 'macro-delta ' + (ind.export_growth < 0 ? 'down' : 'up');
  document.getElementById('m-unemp').textContent = ind.unemployment + '%';

  // ── TIME FIX — always show IST ──
  document.getElementById('last-updated').textContent = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }) + ' IST';

  const SOURCE_BADGE = {
    live:         '<span class="src-badge src-live" title="Fetched live from forex API — updates every page load"><svg width="10" height="10" viewBox="0 0 10 10" style="display:inline;vertical-align:middle"><circle cx="5" cy="5" r="4" fill="#22C55E"/></svg> Live</span>',
    ai_grounded:  ageBadge(data.grounding_status?.grounding_age_seconds, 'src-ai', '<svg width="10" height="10" viewBox="0 0 10 10" style="display:inline;vertical-align:middle"><circle cx="5" cy="5" r="4" fill="#3B82F6"/></svg>'),
    quarterly:    '<span class="src-badge src-quarterly" title="Released quarterly by MOSPI — updated every ~3 months"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Quarterly</span>',
    biannual:     '<span class="src-badge src-quarterly" title="RBI MPC meets 6 times/year — updated on policy dates"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> RBI Policy</span>',
  };

  // Each indicator gets the badge that honestly reflects its update frequency
  const BADGE_MAP = {
    'gdp_growth':    SOURCE_BADGE.quarterly,    // MOSPI quarterly release
    'cpi':           SOURCE_BADGE.ai_grounded,  // MOSPI monthly → Gemini fetches
    'repo_rate':     SOURCE_BADGE.biannual,     // RBI MPC 6x/year
    'inr_usd':       SOURCE_BADGE.live,         // forex API real-time
    'export_growth': SOURCE_BADGE.ai_grounded,  // MoC monthly → Gemini fetches
    'unemployment':  SOURCE_BADGE.ai_grounded,  // CMIE monthly → Gemini fetches
  };
  const BADGE_TARGETS = {
    gdp_growth:'m-gdp-src', cpi:'m-cpi-src', repo_rate:'m-repo-src',
    inr_usd:'m-fx-src', export_growth:'m-exp-src', unemployment:'m-unemp-src'
  };
  Object.entries(BADGE_TARGETS).forEach(([field, elId]) => {
    const el = document.getElementById(elId);
    if (el) el.innerHTML = BADGE_MAP[field] || SOURCE_BADGE.ai_grounded;
  });
}

// Builds a "Last refreshed X min ago" badge instead of a static "AI-grounded"/
// "Manual" label. ageSeconds is how long ago the grounding cache was last
// successfully populated (from the backend's grounding_status); null/undefined
// means it has never been successfully fetched yet (still on config.json defaults).
function ageBadge(ageSeconds, cls, dot) {
  let label;
  if (ageSeconds == null) {
    label = 'Not yet fetched';
  } else if (ageSeconds < 3600) {
    label = 'Updated today';
  } else if (ageSeconds < 86400) {
    const hrs = Math.floor(ageSeconds / 3600);
    label = `Updated ${hrs}h ago`;
  } else {
    const days = Math.floor(ageSeconds / 86400);
    label = `Updated ${days}d ago`;
  }
  return `<span class="src-badge ${cls}" title="Time since this indicator's AI-grounded data was last refreshed">${dot} ${label}</span>`;
}

function buildGauge(risk) {
  const color = risk < 35 ? '#16A34A' : risk < 65 ? '#D97706' : '#DC2626';
  const ctx = document.getElementById('gaugeChart').getContext('2d');
  if (gaugeChart) gaugeChart.destroy();
  gaugeChart = new Chart(ctx, {
    type: 'doughnut',
    data: { datasets: [{ data: [risk, 100-risk, 100], backgroundColor: [color,'#E5E7EB','transparent'], borderWidth:0, circumference:180, rotation:270 }] },
    options: { responsive:false, cutout:'72%', plugins:{legend:{display:false},tooltip:{enabled:false}} }
  });
  const el = document.getElementById('gauge-num');
  el.textContent = risk + '/100';
  el.style.color = color;
  const gaugeSk = document.getElementById('gaugeChart-sk');
  if (gaugeSk) gaugeSk.classList.add('chart-sk-hidden');
}

function buildPrediction(pred) {
  const pill = document.getElementById('pred-pill');
  pill.textContent = pred.label;
  pill.className = 'pred-pill ' + (pred.color||'');
  document.getElementById('pred-conf').textContent = pred.confidence + '%';
  const colors = {Stable:'#16A34A', Warning:'#D97706', Slowdown:'#DC2626'};
  document.getElementById('prob-list').innerHTML = Object.entries(pred.probabilities).map(([k,v]) =>
    `<div class="prob-row">
      <span class="prob-lbl">${k}</span>
      <div class="prob-track"><div class="prob-fill" style="width:${v}%;background:${colors[k]}"></div></div>
      <span class="prob-pct">${v}%</span>
    </div>`
  ).join('');
}

// Foundation Score -- transparent "how many of the model's own indicators are
// currently weak" snapshot. Comes from app.py's compute_foundation_score(),
// which reuses the exact same 12 raw indicators the ML model trains on, so
// this card and the ML Model Prediction card above can never quietly
// disagree about what data they looked at.
let _sandboxUpdateInProgress = false;

function buildFoundation(fs) {
  const numEl = document.getElementById('foundation-num');
  const subEl = document.getElementById('foundation-sub');
  const listEl = document.getElementById('foundation-list');
  if (!fs || fs.score == null) {
    numEl.textContent = '—';
    subEl.textContent = 'Not enough data yet';
    listEl.innerHTML = '';
    return;
  }

  // If this is a normal data refresh (not a sandbox recompute) and the
  // threshold panel is open with custom overrides still active, the
  // sliders would otherwise be left showing stale dragged positions next
  // to a score that just silently reset to the real defaults underneath
  // them. Keep the two in sync by resetting the sandbox along with it.
  if (!_sandboxUpdateInProgress) {
    const panel = document.getElementById('threshold-panel');
    if (panel && panel.style.display !== 'none' && Object.keys(currentOverrides).length) {
      currentOverrides = {};
      renderThresholdSliders();
    }
  }

  // Fraction format (e.g. "4/12") instead of a second "/100" score --
  // the ML Model card above already owns the 0-100 risk scale, and having
  // two differently-scaled "scores" on the same screen was confusing.
  const ratio = fs.checked ? fs.red_zone.length / fs.checked : 0;
  const color = ratio < 0.25 ? '#16A34A' : ratio < 0.55 ? '#D97706' : '#DC2626';
  numEl.textContent = `${fs.red_zone.length}/${fs.checked}`;
  numEl.style.color = color;
  subEl.textContent = 'Warning Signs';
  subEl.style.color = '';

  if (fs.red_zone.length === 0) {
    listEl.innerHTML = '<div class="foundation-empty">No indicators currently past their weak-zone threshold.</div>';
    return;
  }
  listEl.innerHTML = fs.red_zone.map(item =>
    `<div class="foundation-row">
      <span class="foundation-row-label">${item.label}</span>
      <span class="foundation-row-val">${item.value}</span>
    </div>`
  ).join('');
}

// ═══════════════════════════════════════════
//  INTERACTIVE THRESHOLD ADJUSTMENTS (sandbox)
// ═══════════════════════════════════════════
// Lets the user drag each Foundation Score threshold and see the red-zone
// count recompute -- via the REAL backend (/api/foundation-score/recompute),
// not a client-side guess, so it can never silently drift from
// compute_foundation_score() in app.py.
let THRESHOLD_DEFS = [];
let currentOverrides = {};

async function loadThresholdDefs() {
  if (THRESHOLD_DEFS.length) return THRESHOLD_DEFS;
  const defs = await apiFetch('/api/foundation-thresholds');
  THRESHOLD_DEFS = defs || [];
  return THRESHOLD_DEFS;
}

function toggleThresholdPanel() {
  const panel = document.getElementById('threshold-panel');
  const btn = document.getElementById('threshold-toggle-btn');
  const opening = panel.style.display === 'none';
  panel.style.display = opening ? 'block' : 'none';
  btn.classList.toggle('active', opening);
  if (opening) renderThresholdSliders();
}

function getIndicatorValue(key) {
  if (!window._cachedData || !window._cachedData.indicators) return null;
  const data = window._cachedData.indicators;
  if (key.startsWith("ds:")) {
    const parts = key.split(":");
    const side = parts[1];
    const field = parts[2];
    return data.demand_supply?.[side]?.[field]?.value;
  }
  return data[key];
}

async function renderThresholdSliders() {
  const wrap = document.getElementById('threshold-sliders');
  const defs = await loadThresholdDefs();
  if (!defs.length) { wrap.innerHTML = '<div class="foundation-empty">Could not load threshold settings.</div>'; return; }
  wrap.innerHTML = defs.map(t => {
    const actualVal = getIndicatorValue(t.key);
    const val = currentOverrides[t.key] != null ? currentOverrides[t.key] : (actualVal != null ? actualVal : t.default);
    const dirty = currentOverrides[t.key] != null && currentOverrides[t.key] !== actualVal;
    
    // Check if value is in warning/red zone
    const isRed = t.direction === 'gt' ? val > t.default : val < t.default;
    const zoneClass = isRed ? 'red-zone-val' : 'green-zone-val';

    return `
      <div class="threshold-slider-item${dirty ? ' dirty' : ''}" id="ts-item-${cssId(t.key)}">
        <div class="threshold-slider-top">
          <span class="threshold-slider-label">${t.label}</span>
          <span class="threshold-slider-val ${zoneClass}" id="ts-val-${cssId(t.key)}">${val}${t.unit} (Limit: ${t.direction === 'gt' ? '>' : '<'} ${t.default}${t.unit})</span>
        </div>
        <input type="range" min="${t.min}" max="${t.max}" step="${t.step}" value="${val}"
          oninput="onThresholdInput('${t.key}', this.value, '${t.direction}', ${t.default}, '${t.unit}')"
          onchange="onThresholdChange('${t.key}', this.value)">
      </div>`;
  }).join('');
}

function cssId(key) { return key.replace(/[^a-zA-Z0-9]/g, '_'); }

function onThresholdInput(key, value, direction, limit, unit) {
  const val = parseFloat(value);
  const isRed = direction === 'gt' ? val > limit : val < limit;
  const valEl = document.getElementById(`ts-val-${cssId(key)}`);
  valEl.textContent = `${value}${unit} (Limit: ${direction === 'gt' ? '>' : '<'} ${limit}${unit})`;
  if (isRed) {
    valEl.className = 'threshold-slider-val red-zone-val';
  } else {
    valEl.className = 'threshold-slider-val green-zone-val';
  }
  document.getElementById(`ts-item-${cssId(key)}`).classList.add('dirty');
}

let _thresholdRequestSeq = 0; // guards against a slow older request overwriting a newer one

async function onThresholdChange(key, value) {
  // Fires when the user releases the slider -- ask the real backend to
  // recompute the Foundation Score under this custom threshold.
  currentOverrides[key] = parseFloat(value);
  const listEl = document.getElementById('foundation-list');
  const subEl = document.getElementById('foundation-sub');
  const overlay = document.getElementById('threshold-loading-overlay');
  const sliders = document.querySelectorAll('#threshold-sliders input[type="range"]');

  const seq = ++_thresholdRequestSeq;
  listEl.style.opacity = '0.5';
  overlay.classList.add('active');           // show spinner
  sliders.forEach(s => s.disabled = true);   // block dragging another slider mid-request

  try {
    const fs = await apiFetch('/api/foundation-score/recompute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overrides: currentOverrides })
    });
    if (seq !== _thresholdRequestSeq) return; // a newer request already landed, ignore this stale one
    if (fs) {
      _sandboxUpdateInProgress = true;
      buildFoundation(fs);
      _sandboxUpdateInProgress = false;
    } else {
      // Don't fail silently -- make it obvious the score on screen is now
      // stale/out of sync with the sliders, and point at the console for detail.
      subEl.textContent = '⚠ Could not reach the server to recompute — check console / that Flask is running';
      subEl.style.color = 'var(--red)';
    }
  } finally {
    if (seq === _thresholdRequestSeq) {
      listEl.style.opacity = '1';
      overlay.classList.remove('active');
      sliders.forEach(s => s.disabled = false);
    }
  }
}

async function resetThresholds() {
  currentOverrides = {};
  await renderThresholdSliders();
  // Restore the official score from whatever we last loaded.
  if (window._cachedData) buildFoundation(window._cachedData.foundation_score);
}

function secStatus(s) {
  // Indicators like PMI have a well-known "expansion vs contraction" line
  // (50) that matters more than being slightly below the 12-month average.
  // For those, set warn_below_avg:false so a value on the healthy side of
  // the threshold reads as "Healthy" instead of being downgraded to
  // "Watch" just for sitting under the average.
  if (s.higher_good) {
    if (s.value >= s.avg) return 'good';
    if (s.warn_below_avg === false) return s.value > s.threshold ? 'good' : 'bad';
    return s.value > s.threshold ? 'warn' : 'bad';
  }
  if (s.value <= s.avg) return 'good';
  if (s.warn_below_avg === false) return s.value < s.threshold ? 'good' : 'bad';
  return s.value < s.threshold ? 'warn' : 'bad';
}

function buildSectors(sectors) {
  const grid = document.getElementById('sector-grid');
  const tabs = document.getElementById('sector-tabs');
  grid.innerHTML = ''; tabs.innerHTML = '';
  SEC_KEYS.forEach(key => {
    const s = sectors[key]; if(!s) return;
    const st = secStatus(s);
    const stLabel = {good:'Healthy', warn:'Watch', bad:'Alert'}[st];
    const card = document.createElement('div');
    card.className = 'sec-card' + (key===selectedSec?' active':'');
    card.innerHTML = `<div class="sec-name">${SEC_ICONS[key]} ${s.name}</div>
      <div class="sec-val">${s.value}${s.unit}</div>
      <span class="sec-badge ${st}">${stLabel}</span>`;
    card.onclick = () => { selectedSec=key; buildSectors(sectors); buildTrend(s); document.getElementById('section-trends').scrollIntoView({behavior:'smooth', block:'start'}); };
    grid.appendChild(card);

    const tab = document.createElement('button');
    tab.className = 's-tab'+(key===selectedSec?' active':'');
    tab.innerHTML = SEC_ICONS[key]+' '+s.name.split(' ')[0];
    tab.onclick = () => { selectedSec=key; buildSectors(sectors); buildTrend(s); };
    tabs.appendChild(tab);
  });
}

function buildTrend(s) {
  const ctx = document.getElementById('trendChart').getContext('2d');
  if (trendChart) trendChart.destroy();
  const minVal = Math.min(...s.trend, s.avg, s.threshold);
  const maxVal = Math.max(...s.trend, s.avg, s.threshold);
  const pad = (maxVal - minVal) * 0.15 || 1;
  trendChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: TLABELS, datasets: [
      { label: s.name, data: s.trend, backgroundColor:'rgba(37,99,235,.2)', borderColor:'#3B82F6', borderWidth:1.5, borderRadius:3, order:2 },
      { label:'Avg', data:Array(12).fill(s.avg), type:'line', borderColor:'#22C55E', borderWidth:2, borderDash:[6,4], pointRadius:0, fill:false, order:1, tension:0 },
      { label:'Alert threshold', data:Array(12).fill(s.threshold), type:'line', borderColor:'#EF4444', borderWidth:1.5, borderDash:[6,4], pointRadius:0, fill:false, order:0, tension:0 }
    ]},
    options: {
      responsive:true, maintainAspectRatio:false,
      scales: {
        x: { ticks:{font:{size:10},autoSkip:false,maxRotation:45}, grid:{display:false} },
        y: {
          min: minVal >= 0 ? 0 : Math.floor(minVal - pad),
          ticks:{font:{size:11}},
          title:{display:true,text:s.desc||s.name,font:{size:10}}
        }
      },
      plugins: {
        legend:{display:false},
        tooltip:{
          mode:'index', intersect:false,
          callbacks:{
            label: ctx => {
              const lbl = ctx.dataset.label;
              const val = typeof ctx.raw === 'number' ? ctx.raw.toFixed(1) : ctx.raw;
              if (lbl==='Avg') return `Avg: ${val}`;
              if (lbl==='Alert threshold') return `Alert threshold: ${val}`;
              return `${lbl}: ${val}`;
            }
          }
        }
      }
    }
  });
  const trendSk = document.getElementById('trendChart-sk');
  if (trendSk) trendSk.classList.add('chart-sk-hidden');
}

function buildDS(ds) {
  if (!ds || (!ds.demand && !ds.supply)) return;
  const colorMap = { green:'#22C55E', amber:'#F59E0B', red:'#EF4444', blue:'#3B82F6' };

  ['demand','supply'].forEach(side => {
    const grid = document.getElementById(`ds-${side}-grid`);
    if (!grid || !ds[side]) return;
    grid.innerHTML = '';
    Object.values(ds[side]).forEach(ind => {
      const color = colorMap[ind.signal] || '#6B7280';
      const unit = ind.unit === '%' ? '%' : (ind.unit === 'L Cr' ? ' L Cr' : '');
      const valStr = ind.unit === 'L Cr' ? `₹${ind.value}${unit}` : `${ind.value > 0 && ind.unit === '%' ? '+' : ''}${ind.value}${unit}`;
      grid.innerHTML += `
        <div class="ds-card" style="border-left:3px solid ${color}">
          <div class="ds-name">${ind.label}</div>
          <div class="ds-val" style="color:${color}">${valStr}</div>
          <div class="ds-sub">${ind.sub}</div>
        </div>`;
    });
  });
}

function buildHF(sectors) {
  const all = [];
  SEC_KEYS.forEach(k => { if(sectors[k]?.hf) sectors[k].hf.forEach(h=>all.push(h)); });
  document.getElementById('hf-grid').innerHTML = all.map(h =>
    `<div class="hf-item"><span class="hf-lbl">${h.label}</span><span class="hf-val">${h.value}</span></div>`
  ).join('');
}

function fmtCr(n) {
  if (n == null) return '—';
  if (n >= 100000) return (n/100000).toFixed(2) + 'L Cr';
  return Math.round(n).toLocaleString('en-IN') + ' Cr';
}

function buildExtra(ext, derived, extendedAgeSeconds) {
  const grid = document.getElementById('extra-grid');
  if (!ext) { grid.innerHTML = ''; return; }

  // Same "Updated today / Xh ago / Xd ago" wording as the macro strip badges,
  // but reused here for the Extended Indicators (Additional Indicators)
  // section, which is ALSO fully AI-grounded (fetched via Gemini + Google
  // Search) -- it just wasn't showing a freshness badge before.
  const freshnessLabel = (() => {
    if (extendedAgeSeconds == null) return 'Not yet fetched via AI';
    if (extendedAgeSeconds < 3600) return 'Fetched via AI · today';
    if (extendedAgeSeconds < 86400) return `Fetched via AI · ${Math.floor(extendedAgeSeconds / 3600)}h ago`;
    return `Fetched via AI · ${Math.floor(extendedAgeSeconds / 86400)}d ago`;
  })();

  const cards = [
    { name: 'PMI Services', val: ext.pmi_services, unit: '', sub: ext.pmi_services_month || (derived?.services_pmi_below50 ? 'Below 50 — contraction' : 'Expansion zone'), bad: !!derived?.services_pmi_below50 },
    { name: 'Composite PMI (Mfg+Services)', val: derived?.composite_pmi, unit: '', sub: 'Avg of mfg & services PMI' },
    { name: 'GST Collections', val: fmtCr(ext.gst_collection), unit: '', sub: `${derived?.gst_momentum > 0 ? '+' : ''}${derived?.gst_momentum ?? 0}% MoM`, bad: (derived?.gst_momentum ?? 0) < -3 },
    { name: 'UPI Volume', val: ext.upi_volume, unit: 'B txns/mo', sub: 'NPCI' },
    { name: 'Electricity Demand', val: ext.electricity_demand, unit: 'BU', sub: 'Grid-India' },
    { name: 'Railway Freight', val: ext.railway_freight, unit: 'MT', sub: 'Indian Railways' },
    { name: 'E-Way Bills YoY', val: ext.eway_bill_growth, unit: '%', sub: 'GSTN' },
    { name: 'Diesel Consumption YoY', val: ext.diesel_consumption_growth, unit: '%', sub: 'PPAC' },
    { name: 'India VIX', val: ext.india_vix, unit: '', sub: derived?.vix_high ? 'High — above 20' : 'Calm', bad: !!derived?.vix_high, good: !derived?.vix_high },
    { name: 'FII Net Flow', val: fmtCr(ext.fii_net_flow), unit: '', sub: derived?.fii_outflow ? 'Net outflow' : 'Net inflow', bad: !!derived?.fii_outflow, good: !derived?.fii_outflow },
    { name: 'Trade Balance', val: ext.trade_balance, unit: '$B', sub: derived?.trade_deficit_wide ? 'Deficit > $20B' : 'Within normal range', bad: !!derived?.trade_deficit_wide },
  ];

  grid.innerHTML = cards.map(c => `
    <div class="extra-card">
      <div class="extra-name">${c.name}</div>
      <div class="extra-val">${c.val ?? '—'}${c.unit ? ' '+c.unit : ''}</div>
      <div class="extra-sub${c.bad ? ' flag-bad' : c.good ? ' flag-good' : ''}">${c.sub || ''}</div>
      <div class="extra-fetched-via-ai" title="This whole section is fetched via Gemini + Google Search grounding">${freshnessLabel}</div>
    </div>`).join('');
}

function buildFeat(canvasId) {
  canvasId = canvasId || 'featChart';
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const isModal = canvasId === 'modalFeatChart';
  if (isModal) { if (modalFeatChart) modalFeatChart.destroy(); } else { if (featChart) featChart.destroy(); }
  const sorted = Object.entries(FEAT_IMP).sort((a,b)=>b[1]-a[1]);
  const chart = new Chart(ctx, {
    type:'bar',
    data:{ labels:sorted.map(e=>e[0]), datasets:[{
      data: sorted.map(e=>+(e[1]*100).toFixed(1)),
      backgroundColor: sorted.map((_,i)=>`rgba(37,99,235,${0.9-i*0.07})`),
      borderWidth:0, borderRadius:4
    }]},
    options:{
      indexAxis:'y', responsive:true, maintainAspectRatio:false,
      scales:{ x:{ticks:{font:{size:10}},title:{display:true,text:'Importance (%)',font:{size:10}}}, y:{ticks:{font:{size:10}},grid:{display:false}} },
      plugins:{legend:{display:false}}
    }
  });
  if (isModal) modalFeatChart = chart; else featChart = chart;
  if (!isModal) {
    const featSk = document.getElementById('featChart-sk');
    if (featSk) featSk.classList.add('chart-sk-hidden');
  }
}

// ═══════════════════════════════════════════
//  MODEL METHODOLOGY DRILL-DOWN (modal)
// ═══════════════════════════════════════════
function openModelModal() {
  document.getElementById('model-modal-overlay').style.display = 'flex';
  // Build lazily -- only render the chart once the modal is actually visible.
  buildFeat('modalFeatChart');
  document.addEventListener('keydown', _modalEscHandler);
}
function closeModelModal() {
  document.getElementById('model-modal-overlay').style.display = 'none';
  document.removeEventListener('keydown', _modalEscHandler);
}
function _modalEscHandler(e) { if (e.key === 'Escape') closeModelModal(); }

function buildHist() {
  const ctx = document.getElementById('histChart').getContext('2d');
  if (histChart) histChart.destroy();
  histChart = new Chart(ctx, {
    type:'line',
    data:{ labels:HIST_LABELS, datasets:[
      { label:'GDP Growth (%)', data:HIST_DATA.gdp, borderColor:'#3B82F6', backgroundColor:'rgba(59,130,246,.1)', borderWidth:2.5, pointRadius:4, fill:true, tension:.3 },
      { label:'Export Growth (%)', data:HIST_DATA.exports, borderColor:'#F59E0B', backgroundColor:'rgba(245,158,11,.05)', borderWidth:2, pointRadius:4, fill:false, tension:.3, borderDash:[5,3] },
      { label:'Unemployment (%)', data:HIST_DATA.unemp, borderColor:'#EF4444', backgroundColor:'rgba(239,68,68,.05)', borderWidth:2, pointRadius:4, fill:false, tension:.3, borderDash:[3,3] },
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      scales:{
        x:{ ticks:{font:{size:11}}, grid:{display:false} },
        y:{ ticks:{font:{size:11}}, title:{display:true,text:'Value (%)',font:{size:11}} }
      },
      plugins: {
        legend: { display: false }, // apna custom legend (hist-toggles) use kar rahe hain
        tooltip: { mode:'index', intersect:false }
      }
    }
  });
  const histSk = document.getElementById('histChart-sk');
  if (histSk) histSk.classList.add('chart-sk-hidden');
}

function initHistToggles() {
  const map = { 'toggle-gdp':0, 'toggle-exports':1, 'toggle-unemp':2 };
  Object.entries(map).forEach(([id, idx]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      if (!histChart) return;
      histChart.setDatasetVisibility(idx, el.checked);
      histChart.update();
    });
  });
}

async function runAI() {
  const box = document.getElementById('ai-box');
  const btn = document.getElementById('ai-btn');
  // Save previous analysis if any (not placeholder/error)
  const prev = box.querySelector('.ai-analysis-entry');
  const prevText = prev ? prev.querySelector('.ai-analysis-text')?.textContent : null;

  box.innerHTML = '<div class="ai-loading"><div class="spinner"></div> AI is analyzing current indicators…</div>';
  btn.disabled = true;

  const data = window._cachedData;
  const ind = data?.indicators || {};
  const risk = data?.risk_score ?? 45;
  const prediction = data?.prediction || { label: 'Warning', confidence: 0 };

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ indicators: ind, prediction, risk_score: risk })
    });
    const json = await res.json();

    if (!res.ok || json.error) {
      box.innerHTML = `<div class="ai-placeholder">⚠️ ${json.error || 'AI analysis is not configured on this server. Set GEMINI_API_KEY in .env to enable it.'}</div>`;
    } else {
      // Build new entry
      const entry = document.createElement('div');
      entry.className = 'ai-analysis-entry';
      const timestamp = new Date().toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit'});
      const textEl = document.createElement('div');
      textEl.className = 'ai-analysis-text';
      textEl.textContent = json.analysis;
      entry.appendChild(textEl);
      box.innerHTML = '';
      box.appendChild(entry);

      // Restore previous analysis collapsed
      if (prevText) {
        const prevEntry = document.createElement('details');
        prevEntry.className = 'ai-prev-entry';
        prevEntry.innerHTML = `<summary>Previous analysis</summary><div class="ai-analysis-text ai-prev-text">${prevText}</div>`;
        box.appendChild(prevEntry);
      }
      // Add copy button after analysis renders
      const copyBtn = document.createElement('button');
      copyBtn.className = 'ai-copy-btn';
      copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy';
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(textEl.textContent).then(() => {
          copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 12 4 10"/></svg> Copied!';
          setTimeout(() => {
            copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy';
          }, 2000);
        });
      };
      entry.appendChild(copyBtn);
    }
  } catch (err) {
    box.innerHTML = '<div class="ai-placeholder">⚠️ Could not reach the analysis server. Check that the Flask app is running.</div>';
  }
  btn.disabled = false;
}

async function refreshAll() {
  document.getElementById('last-updated').textContent = 'Refreshing…';
  const data = await apiFetch('/api/predict');
  if (!data) {
    document.getElementById('last-updated').textContent = 'Error – check connection';
    clearSkeletons();
    clearInterval(loadingInterval);
    document.getElementById("loader").style.display = "none";
    return;
  }
  window._cachedData = data;

  const sectors = data.indicators.sectors;
  setHeroBanner(data.risk_score, data.prediction.label);
  setMacro(data);
  buildPrediction(data.prediction);
  buildFoundation(data.foundation_score);
  buildSectors(sectors);
  buildHF(sectors);
  buildDS(data.indicators.demand_supply);
  buildExtra(data.indicators.extended_indicators, data.indicators.derived_features, data.grounding_status?.extended_age_seconds);
  initLearnSection(data.indicators);

  // Clear skeletons first so that parent layouts settle before Chart.js is initialized
  clearSkeletons();

  // Paint the charts inside finalized containers to prevent forced reflows
  buildGauge(data.risk_score);
  buildTrend(sectors[selectedSec]);
  buildFeat();
  buildHist();
  initHistToggles();

  // Hide loader
  clearInterval(loadingInterval);
  document.getElementById("loader").style.display = "none";
}

refreshAll();

// ═══════════════════════════════════════════
//  HISTORICAL SHOCK OVERLAY
// ═══════════════════════════════════════════
// Compares today's live numbers against what the SAME trained model output
// for real historical quarters, pulled from /api/shock-scenario/<key>
// (which reads straight out of training_data_v2.csv and runs model.pkl on
// it server-side -- this is real model inference, not a canned demo value).
// Keep this list and HISTORICAL_SHOCKS in app.py in sync -- add a scenario
// here (chronological order) and it just appears as a new button.
const SHOCK_SCENARIOS = [
  { key: 'live',                    label: 'Today (Live)' },
  { key: 'demonetization_2016',     label: 'Demonetization' },
  { key: 'ilfs_2018',               label: 'NBFC Crisis' },
  { key: 'slowdown_2019',           label: '2019 Slowdown' },
  { key: 'covid_2020',              label: 'COVID-19 Shock' },
  { key: 'covid_second_wave_2021',  label: 'COVID 2nd Wave' },
  { key: 'inflation_shock_2022',    label: '2022 Inflation Shock' },
];
const SHOCK_KEYS = SHOCK_SCENARIOS.map(s => s.key);

function renderShockButtons() {
  const row = document.getElementById('shock-btn-row');
  if (!row) return;
  row.innerHTML = SHOCK_SCENARIOS.map(s =>
    `<button class="shock-btn${s.key === 'live' ? ' active' : ''}" id="shock-btn-${s.key}" onclick="loadShock('${s.key}')">${s.label}</button>`
  ).join('');
}
renderShockButtons();

function setActiveShockBtn(key) {
  SHOCK_KEYS.forEach(k => {
    const btn = document.getElementById(`shock-btn-${k}`);
    if (btn) btn.classList.toggle('active', k === key);
  });
}

async function loadShock(key) {
  setActiveShockBtn(key);
  const body = document.getElementById('shock-body');

  if (key === 'live') {
    body.innerHTML = '<div class="shock-placeholder" id="shock-placeholder">Pick a period above to compare it against today.</div>';
    return;
  }

  body.innerHTML = '<div class="shock-loading">Running the model on that quarter…</div>';

  const scenario = await apiFetch(`/api/shock-scenario/${key}`);
  const today = window._cachedData;
  if (!scenario || scenario.error || !today) {
    body.innerHTML = '<div class="shock-placeholder">Could not load that historical scenario. Check that the Flask server is running.</div>';
    return;
  }

  const t = today.indicators;
  const todayRow = {
    label: 'Today (Live)', period: 'Current', score: today.risk_score,
    predLabel: today.prediction.label,
    gdp_growth: t.gdp_growth, cpi: t.cpi, pmi: t.pmi, export_growth: t.export_growth, repo_rate: t.repo_rate
  };
  const shockRow = {
    label: scenario.label, period: scenario.period, score: scenario.risk_score,
    predLabel: scenario.prediction ? scenario.prediction.label : '—',
    gdp_growth: scenario.indicators.gdp_growth, cpi: scenario.indicators.cpi, pmi: scenario.indicators.pmi,
    export_growth: scenario.indicators.export_growth, repo_rate: scenario.indicators.repo_rate
  };

  const rows = [
    { label: 'GDP Growth',    key: 'gdp_growth',    unit: '%', lowerIsWorse: true },
    { label: 'Manufacturing PMI', key: 'pmi',        unit: '',  lowerIsWorse: true },
    { label: 'CPI Inflation', key: 'cpi',            unit: '%', lowerIsWorse: false },
    { label: 'Export Growth', key: 'export_growth',  unit: '%', lowerIsWorse: true },
    { label: 'Repo Rate',     key: 'repo_rate',      unit: '%', lowerIsWorse: false },
  ];

  const tableRows = rows.map(r => {
    const a = todayRow[r.key], b = shockRow[r.key];
    const delta = b - a;
    const shockIsWorse = r.lowerIsWorse ? delta < 0 : delta > 0;
    const deltaClass = delta === 0 ? '' : (shockIsWorse ? 'shock-delta-worse' : 'shock-delta-better');
    const deltaTxt = (delta > 0 ? '+' : '') + delta.toFixed(1) + r.unit;
    return `<tr>
      <td>${r.label}</td>
      <td>${a}${r.unit}</td>
      <td>${b}${r.unit}</td>
      <td class="${deltaClass}">${deltaTxt}</td>
    </tr>`;
  }).join('');

  const scoreColor = s => s == null ? 'var(--muted)' : s < 30 ? 'var(--green)' : s < 60 ? 'var(--amber)' : 'var(--red)';

  body.innerHTML = `
    <div class="shock-compare-grid">
      <div class="shock-panel">
        <div class="shock-panel-title">${todayRow.label}</div>
        <div class="shock-panel-period">${todayRow.period}</div>
        <div class="shock-panel-score" style="color:${scoreColor(todayRow.score)}">${todayRow.score}/100</div>
        <div class="shock-panel-label" style="color:${scoreColor(todayRow.score)}">${todayRow.predLabel}</div>
      </div>
      <div class="shock-panel is-shock">
        <div class="shock-panel-title">${shockRow.label}</div>
        <div class="shock-panel-period">${shockRow.period}</div>
        <div class="shock-panel-score" style="color:${scoreColor(shockRow.score)}">${shockRow.score != null ? shockRow.score + '/100' : '—'}</div>
        <div class="shock-panel-label" style="color:${scoreColor(shockRow.score)}">${shockRow.predLabel}</div>
      </div>
    </div>
    <div class="shock-table-wrap">
      <table class="shock-table">
        <thead><tr><th>Indicator</th><th>Today</th><th>${scenario.label}</th><th>Δ</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    ${scenario.note ? `<div class="shock-note">⚠ ${scenario.note}</div>` : ''}
    <div class="shock-footnote">Historical figures are pulled directly from the same 52-quarter training_data_v2.csv the model was fit on (real quarter: ${scenario.quarter}, originally labeled "${scenario.dataset_label}"). The model's Warning/Slowdown output above is real inference run against that quarter, not a hand-picked demo number.</div>
  `;
}

// ═══════════════════════════════════════════
//  AUTOMATED EXPORT & REPORTING
// ═══════════════════════════════════════════
function flattenIndicators(obj, prefix, out) {
  out = out || {};
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      flattenIndicators(v, key, out);
    } else if (!Array.isArray(v)) {
      out[key] = v;
    }
  }
  return out;
}

function csvEscape(val) {
  const s = String(val ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCSV() {
  const data = window._cachedData;
  if (!data) { alert('Dashboard data is still loading — try again in a moment.'); return; }
  const flat = flattenIndicators(data.indicators);
  flat['risk_score'] = data.risk_score;
  flat['prediction_label'] = data.prediction?.label;
  flat['foundation_score_red_zone_count'] = data.foundation_score?.red_zone?.length;
  flat['foundation_score_checked'] = data.foundation_score?.checked;

  const rows = [['indicator', 'value'], ...Object.entries(flat)];
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `arthspandan-indicators-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportReport() {
  // Uses the browser's native print dialog (choose "Save as PDF" as the
  // destination) rather than bundling a PDF-generation library client-side --
  // the print stylesheet (@media print in style.css) hides the sidebar/nav
  // chrome so what prints is a clean report of the current dashboard state.
  window.print();
}

// ═══════════════════════════════════════════
//  AI-GROUNDED DATA REFRESH (manual button + background timer)
// ═══════════════════════════════════════════
// /api/predict NEVER triggers a new Gemini call on its own (see the force=False
// default in gemini_grounding.py) -- it only ever reads whatever this refresh
// path last saved. That's what this section is responsible for:
//   1. A manual "Refresh AI Data" button the user can click any time.
//   2. A background timer that calls the same refresh endpoint automatically
//      every ~5-6 minutes, without the user needing to reload the page.
// After either path runs, we re-call refreshAll() so the dashboard re-renders
// with whatever (possibly updated) data is now cached on the server.

// ── Midnight auto-refresh ────────────────────────────────────────────────────
// Every day at midnight IST, silently fetch fresh Gemini-grounded data.
// Works on Vercel too (runs in the browser, not the server).
let aiRefreshInFlight = false;

async function refreshAIData() {
  if (aiRefreshInFlight) return;
  aiRefreshInFlight = true;
  try {
    const res = await fetch('/api/refresh-grounding', { method: 'POST' });
    if (res.ok) await new Promise(r => setTimeout(r, 500));
  } catch { /* network hiccup — silently ignore */ }
  await refreshAll();
  aiRefreshInFlight = false;
}

function scheduleMidnightRefresh() {
  const now = new Date();
  const midnight = new Date();
  midnight.setHours(24, 0, 30, 0); // 12:00:30 AM IST next day
  const msUntilMidnight = midnight - now;
  setTimeout(() => {
    refreshAIData();
    // Then repeat every 24 hours
    setInterval(refreshAIData, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);
  const h = Math.floor(msUntilMidnight / 3600000);
  const m = Math.floor((msUntilMidnight % 3600000) / 60000);
  console.log(`Next AI data refresh scheduled in ${h}h ${m}m (at midnight)`);
}
scheduleMidnightRefresh();


// ═══════════════════════════════════════════
//  LEARN & ASK SECTION
// ═══════════════════════════════════════════

const DEFINITIONS = [
  {
    id: 'gdp', name: 'GDP Growth', cat: 'macro',
    simple: 'GDP stands for Gross Domestic Product — the total value of everything a country produces in a year. GDP growth tells you how fast the economy is expanding.',
    example: 'If India\'s GDP growth is 6%, it means the country produced 6% more goods and services this year than last year. If growth drops to 4%, that\'s a sign of a slowdown.',
    current: null, source: 'MOSPI', source_url: 'https://mospi.gov.in', indicator_key: 'gdp_growth', unit: '%'
  },
  {
    id: 'cpi', name: 'CPI Inflation', cat: 'macro',
    simple: 'CPI (Consumer Price Index) tracks how much everyday items — milk, pulses, petrol — have become more expensive. Higher inflation means higher prices for the same things.',
    example: 'If CPI inflation is 6%, something that cost ₹100 last year now costs ₹106. The RBI aims to keep inflation close to 4%.',
    current: null, source: 'MOSPI', source_url: 'https://mospi.gov.in/consumer-price-index', indicator_key: 'cpi', unit: '%'
  },
  {
    id: 'repo', name: 'Repo Rate', cat: 'banking',
    simple: 'The Repo Rate is the interest rate at which the RBI lends money to banks. It directly affects your home loan, car loan, and business loan EMIs.',
    example: 'RBI raises the repo rate by 0.25% -> banks\' borrowing cost rises -> banks raise their loan rates -> your EMI goes up.',
    current: null, source: 'RBI', source_url: 'https://rbi.org.in/scripts/BS_PressReleaseDisplay.aspx', indicator_key: 'repo_rate', unit: '%'
  },
  {
    id: 'pmi', name: 'PMI (Manufacturing)', cat: 'macro',
    simple: 'PMI (Purchasing Managers\' Index) is a survey of factory managers. Above 50 means factories are growing. Below 50 means activity is shrinking.',
    example: 'PMI at 54 -> factories are taking new orders, production is rising. PMI at 47 -> orders have dried up, layoffs may follow. India\'s PMI fell to 27 during COVID.',
    current: null, source: 'S&P Global', source_url: 'https://www.spglobal.com/marketintelligence/en/mi/research-analysis/india-pmi.html', indicator_key: 'pmi', unit: ''
  },
  {
    id: 'pmi_services', name: 'PMI (Services)', cat: 'macro',
    simple: 'Same as Manufacturing PMI, but for the services sector — IT, banking, hospitality, retail. Services make up over half of India\'s economy.',
    example: 'Services PMI at 60 -> IT firms, hotels, and banks are seeing strong demand. Below 50 -> demand for services is contracting.',
    current: null, source: 'S&P Global', source_url: 'https://www.spglobal.com/marketintelligence/en/mi/research-analysis/india-pmi.html', indicator_key: 'pmi_services', indicator_source: 'extended', unit: ''
  },
  {
    id: 'composite_pmi', name: 'Composite PMI', cat: 'macro',
    simple: 'A single number blending Manufacturing and Services PMI — a whole-economy health check in one figure.',
    example: 'If Manufacturing PMI is 55 and Services PMI is 60, Composite PMI is 57.5 — both halves of the economy are expanding.',
    current: null, source: 'Calculated (Mfg + Services) / 2', source_url: 'https://www.spglobal.com/marketintelligence/en/', indicator_key: 'composite_pmi', indicator_source: 'derived', unit: ''
  },
  {
    id: 'unemployment', name: 'Unemployment Rate', cat: 'jobs',
    simple: 'The percentage of people looking for work who couldn\'t find any. India tracks urban and rural unemployment separately.',
    example: 'Urban unemployment at 8% means 8 out of 100 people wanting to work couldn\'t find a job. During COVID lockdown it touched 23%.',
    current: null, source: 'CMIE', source_url: 'https://unemploymentinindia.cmie.com', indicator_key: 'unemployment', unit: '%'
  },
  {
    id: 'credit', name: 'Bank Credit Growth', cat: 'banking',
    simple: 'How much more banks have lent out this year compared to last year. Strong credit growth means businesses and people are investing.',
    example: 'Credit growth at 15% -> businesses expanding, people buying homes. Credit growth at 5% -> people have stopped borrowing — an early warning sign.',
    current: null, source: 'RBI', source_url: 'https://rbi.org.in/scripts/BS_PressReleaseDisplay.aspx', indicator_key: 'credit_growth', unit: '%'
  },
  {
    id: 'exports', name: 'Export Growth', cat: 'trade',
    simple: 'How much more (or less) India sold to other countries compared to last year.',
    example: 'Export growth at -5% means India exported 5% less than the year before. Sustained negative exports are a major slowdown warning sign.',
    current: null, source: 'Ministry of Commerce', source_url: 'https://commerce.gov.in', indicator_key: 'export_growth', unit: '%'
  },
  {
    id: 'inr', name: 'INR / USD Exchange Rate', cat: 'trade',
    simple: 'How many Indian Rupees it takes to buy one US Dollar. A weaker rupee makes imports more expensive and can push up inflation.',
    example: '₹80/dollar moving to ₹84/dollar means the rupee weakened 5%. Petrol and electronics get pricier. But IT exporters benefit.',
    current: null, source: 'RBI', source_url: 'https://rbi.org.in/Scripts/ReferenceRateArchive.aspx', indicator_key: 'inr_usd', unit: '₹'
  },
  {
    id: 'agri', name: 'Agriculture GVA Growth', cat: 'macro',
    simple: 'The growth in value created by farming. Over 40% of India\'s population depends on agriculture.',
    example: 'Agri GVA at 4% -> good monsoon, healthy harvest, strong rural demand. At 1% -> drought or flood, poor harvest, lower rural spending.',
    current: null, source: 'MOSPI', source_url: 'https://mospi.gov.in/national-account-statistics', indicator_key: 'agri_gva', unit: '%'
  },
  {
    id: 'gst', name: 'GST Collections', cat: 'macro',
    simple: 'Total GST collected every month from businesses. One of the most direct real-time readings of domestic economic activity.',
    example: 'GST of ₹2 lakh crore -> businesses selling a lot. ₹1.2 lakh crore -> fewer transactions, economy cooling off.',
    current: null, source: 'GST Council', source_url: 'https://gst.gov.in/websitehome/revenue-statistics', indicator_key: 'gst_collection', indicator_source: 'extended', unit: '₹ Cr'
  },
  {
    id: 'gst_momentum', name: 'GST Momentum', cat: 'macro',
    simple: 'How much GST collections changed compared to the previous month. Shows direction — is activity accelerating or slowing.',
    example: 'GST going from ₹1.78L Cr to ₹1.85L Cr = +4% momentum — business picking up. Sharp negative momentum for months = early slowdown signal.',
    current: null, source: 'Calculated MoM %', source_url: 'https://gst.gov.in/websitehome/revenue-statistics', indicator_key: 'gst_momentum', indicator_source: 'derived', unit: '%'
  },
  {
    id: 'vix', name: 'India VIX', cat: 'market',
    simple: 'The "Fear Index" — measures how much fear or uncertainty investors expect in the stock market. High VIX = nervous investors.',
    example: 'VIX at 12 -> markets are calm. VIX above 30 -> major fear — election results, global crisis. VIX touched 80+ in 2020.',
    current: null, source: 'NSE India', source_url: 'https://nseindia.com/market-data/india-vix', indicator_key: 'india_vix', indicator_source: 'extended', unit: ''
  },
  {
    id: 'fii', name: 'FII Net Flow', cat: 'market',
    simple: 'Money flowing into (or out of) Indian markets from foreign investors. A strong signal of global confidence in India\'s economy.',
    example: 'FII pulls out ₹10,000 Cr -> market falls, rupee weakens. FII puts in ₹8,000 Cr -> global investors buying, market supported.',
    current: null, source: 'NSDL / NSE', source_url: 'https://nsdl.co.in/publications/fii.php', indicator_key: 'fii_net_flow', indicator_source: 'extended', unit: '₹ Cr'
  },
  {
    id: 'iip', name: 'IIP / Core Sector Index', cat: 'macro',
    simple: 'Shows how much factory production rose or fell. Eight core sectors — steel, cement, electricity, oil — make up 40% of IIP.',
    example: 'IIP at +6% -> factories running full speed. IIP at -2% -> manufacturing slowing. Fell -57% during COVID lockdown.',
    current: null, source: 'MOSPI', source_url: 'https://mospi.gov.in/iip', indicator_key: 'iip_growth', unit: '%'
  },
  {
    id: 'railway', name: 'Railway Freight Traffic', cat: 'trade',
    simple: 'How much cargo Indian Railways moved — measured in million tonnes. One of the most direct physical proofs of real economic activity.',
    example: 'Freight at 140 MT -> industries running at full production. At 110 MT -> industrial slowdown, fewer orders.',
    current: null, source: 'Indian Railways', source_url: 'https://indianrailways.gov.in/railwayboard/stat', indicator_key: 'railway_freight', indicator_source: 'extended', unit: 'MT'
  },
  {
    id: 'upi', name: 'UPI Transaction Volume', cat: 'market',
    simple: 'Payments made through PhonePe, GPay, Paytm — the most real-time indicator of retail consumer spending.',
    example: 'UPI at 14 billion/month -> people spending freely. Drops to 8 billion -> people cutting back, weaker consumer sentiment.',
    current: null, source: 'NPCI', source_url: 'https://npci.org.in/what-we-do/upi/upi-ecosystem-statistics', indicator_key: 'upi_volume', indicator_source: 'extended', unit: 'B txns'
  },
  {
    id: 'electricity', name: 'Electricity Demand', cat: 'macro',
    simple: 'How much power the country consumed in a month (Billion Units). Tracks factory output and commercial activity closely.',
    example: 'Electricity at 165 BU -> industrial activity and AC load are high. A sharp YoY drop points to factories cutting production.',
    current: null, source: 'POSOCO / Grid-India', source_url: 'https://posoco.in', indicator_key: 'electricity_demand', indicator_source: 'extended', unit: 'BU'
  },
  {
    id: 'eway', name: 'E-Way Bills', cat: 'trade',
    simple: 'Generated every time goods worth ₹50,000+ move across state lines. Growth in E-Way Bills = healthy domestic trade activity.',
    example: 'E-way bills growing 15% YoY -> more goods shipping around the country. Turning negative -> businesses moving less stock.',
    current: null, source: 'GSTN', source_url: 'https://ewaybillgst.gov.in', indicator_key: 'eway_bill_growth', indicator_source: 'extended', unit: '%'
  },
  {
    id: 'diesel', name: 'Diesel Consumption', cat: 'trade',
    simple: 'How much diesel the country used YoY. Since trucks and tractors run on diesel, this tracks transport and farming activity.',
    example: 'Diesel growth at 6% -> more trucks on road, goods being moved. A drop often shows up before official freight data does.',
    current: null, source: 'PPAC', source_url: 'https://ppac.gov.in', indicator_key: 'diesel_consumption_growth', indicator_source: 'extended', unit: '%'
  },
  {
    id: 'trade_balance', name: 'Trade Balance', cat: 'trade',
    simple: 'Exports minus imports in US dollars. A negative number (trade deficit) means India buys more from the world than it sells.',
    example: 'Trade balance of -$20B means India imported $20B more than it exported. Widening deficit puts pressure on the rupee.',
    current: null, source: 'Calculated (exports - imports)', source_url: 'https://commerce.gov.in', indicator_key: 'trade_balance', indicator_source: 'extended', unit: '$B'
  }
];

const CAT_CLASS = { macro:'cat-macro', market:'cat-market', banking:'cat-banking', trade:'cat-trade', jobs:'cat-jobs' };
const CAT_LABEL = { macro:'Macro', market:'Market', banking:'Banking', trade:'Trade', jobs:'Jobs' };

function injectLiveValues(indicators) {
  const extended = (indicators && indicators.extended_indicators) || {};
  const derived  = (indicators && indicators.derived_features) || {};
  DEFINITIONS.forEach(def => {
    if (!def.indicator_key) return;
    if (def.indicator_source === 'extended' && extended[def.indicator_key] != null)
      def.current = extended[def.indicator_key];
    else if (def.indicator_source === 'derived' && derived[def.indicator_key] != null)
      def.current = derived[def.indicator_key];
    else if (!def.indicator_source && indicators && indicators[def.indicator_key] != null)
      def.current = indicators[def.indicator_key];
  });
}

function renderDefCards(filter, search) {
  filter = filter || 'all'; search = search || '';
  const grid = document.getElementById('def-grid');
  if (!grid) return;
  const items = DEFINITIONS.filter(d => {
    const mc = filter === 'all' || d.cat === filter;
    const ms = !search || d.name.toLowerCase().includes(search.toLowerCase()) || d.simple.toLowerCase().includes(search.toLowerCase());
    return mc && ms;
  });
  if (!items.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:30px">No results found</div>';
    return;
  }
  grid.innerHTML = items.map(def => `
    <div class="def-card" data-id="${def.id}">
      <div class="def-top">
        <div class="def-name">${def.name}</div>
        <span class="def-cat-badge ${CAT_CLASS[def.cat]}">${CAT_LABEL[def.cat]}</span>
      </div>
      <div class="def-simple">${def.simple}</div>
      ${def.current != null ? `<div class="def-current">Now: ${def.unit==='₹'?'₹':''}${def.current}${def.unit!=='₹'?(def.unit?' '+def.unit:''):''}</div>` : ''}
      <div class="def-example">${def.example}</div>
      <div class="def-footer">
        <span class="def-source">Source: <a href="${def.source_url}" target="_blank">${def.source} &#8599;</a></span>
        <button class="def-toggle" onclick="toggleDef(event,'${def.id}')">Show example &#9662;</button>
      </div>
    </div>`).join('');
}

function toggleDef(e, id) {
  e.stopPropagation();
  const card = document.querySelector(`.def-card[data-id="${id}"]`);
  const btn  = card.querySelector('.def-toggle');
  card.classList.toggle('expanded');
  btn.innerHTML = card.classList.contains('expanded') ? 'Hide example &#9652;' : 'Show example &#9662;';
}

function initLearnTabs() {
  document.querySelectorAll('.learn-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.learn-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderDefCards(tab.dataset.cat, document.getElementById('learn-search')?.value || '');
    });
  });
}

function initLearnSearch() {
  const input = document.getElementById('learn-search');
  if (!input) return;
  input.addEventListener('input', () => {
    const activeCat = document.querySelector('.learn-tab.active')?.dataset.cat || 'all';
    renderDefCards(activeCat, input.value);
  });
}

const CHAT_HISTORY = (() => {
  try { return JSON.parse(sessionStorage.getItem('chat_history') || '[]'); } catch { return []; }
})();
function saveChatHistory() {
  try { sessionStorage.setItem('chat_history', JSON.stringify(CHAT_HISTORY.slice(-20))); } catch {}
}



// ── Cached answers for suggested questions (zero API calls) ──────────────────
const CACHED_ANSWERS = {
  "Why does my EMI go up when the repo rate rises?":
    "When RBI raises the repo rate, banks have to pay more to borrow money from RBI. Banks then pass this cost to you by raising their lending rates (MCLR/EBLR). Your home loan, car loan, or personal loan EMI is linked to these rates — so when repo rate goes up by 0.25%, your EMI on a ₹30L, 20-year loan can go up by ₹400–600/month. The reverse is also true — when RBI cuts repo rate (like it has been doing in 2025–26), EMIs come down.",

  "What does an \"economic slowdown\" actually mean for India?":
    "An economic slowdown means the economy is still growing, but at a slower pace than before. For India: GDP growth dropping from 8% to 5-6% is considered a slowdown. In practical terms — fewer new jobs, companies cutting expansion plans, banks lending less, exports declining, consumers spending cautiously. It doesn't mean the economy is shrinking (that's a recession) — it's just losing momentum. This dashboard tracks GDP growth, PMI, unemployment, credit growth and exports to detect early slowdown signals.",

  "What happens if PMI falls below 50?":
    "PMI (Purchasing Managers' Index) below 50 means contraction — factory managers are seeing fewer new orders, cutting production, and sometimes letting workers go. For India: Manufacturing PMI below 50 is a serious early warning — it usually shows up 1-2 months before GDP data confirms a slowdown. During COVID, India's PMI crashed to 27. A reading of 47-49 means mild slowdown; below 45 is alarming. Services PMI matters too — India's services sector (IT, banking, hospitality) is over 50% of GDP, so if both fall below 50 together, the signal is very strong.",

  "How does inflation affect an average household?":
    "Inflation means your money buys less than before. At 6% CPI inflation: ₹100 of groceries last year costs ₹106 today. But salaries rarely rise 6% for everyone — so real purchasing power falls. For India: food inflation hits hardest (pulses, vegetables, cooking oil). High inflation also forces RBI to keep interest rates high, making loans expensive. The poorest households spend 50-60% of income on food, so even a 1-2% food inflation spike is very painful. RBI's target is 4% — above 6% is the upper tolerance limit.",

  "What are the main reasons GDP growth slows down?":
    "India's GDP slowdown usually comes from a combination of: (1) Weak exports — global demand falls, IT and merchandise exports drop; (2) Low private investment — companies don't expand when uncertain; (3) High interest rates — RBI keeping rates high to fight inflation reduces borrowing; (4) Poor monsoon — bad harvest hurts rural income and demand; (5) Global factors — US recession or China slowdown affects India. The dashboard tracks all these signals — export growth, credit growth, PMI and unemployment together show which factor is driving any slowdown.",

  "Why does the stock market fall when FIIs pull out money?":
    "FIIs (Foreign Institutional Investors) — big global funds like Blackrock, Vanguard — hold a significant chunk of Indian stocks. When they sell and pull money out: (1) Direct impact — selling pressure pushes stock prices down; (2) Rupee weakens — they convert rupees to dollars when leaving; (3) Sentiment effect — other investors panic-sell seeing FII outflows; (4) Liquidity tightens — less money in the market. FII outflow of ₹10,000+ Cr in a month is a warning sign. However, strong domestic investors (DIIs — mutual funds, LIC) now often absorb FII selling, making Indian markets more resilient than before.",

  "Why is the Indian Rupee weakening against the US Dollar?":
    "The INR's value against the USD changes due to India's trade deficit (we import more value than we export) and global factors. When the US Federal Reserve raises interest rates, foreign investors pull capital out of India to invest in safe US bonds, creating dollar demand and weakening the Rupee. A weaker Rupee makes imports like crude oil expensive, feeding into domestic inflation, but benefits Indian IT companies and exporters.",

  "What is the difference between CPI and WPI inflation?":
    "CPI (Consumer Price Index) tracks retail prices paid directly by households, with a heavy weight on food (~46%) and services. It is RBI's main guide for rate decisions. WPI (Wholesale Price Index) measures prices at the factory gate, dominated by manufactured items (~64%) and fuel, reflecting producer costs and supply-chain pressures. When global commodity prices spike, WPI usually surges faster than CPI.",

  "How does capacity utilization affect industrial growth?":
    "Capacity utilization measures how much of factories' potential output is actually being used. If it remains below 70%, it indicates weak demand, meaning companies have no incentive to invest in new plants or hire. When it crosses 75% (measured quarterly by RBI's OBICUS survey), factories run close to full strength, which triggers corporate capital expenditure (Capex), job creation, and industrial expansion."
};

// ═══════════════════════════════════════════
//  SUGGESTION CHIPS -- randomized static bank + live dynamic chips
// ═══════════════════════════════════════════
// The 8 evergreen questions above (CACHED_ANSWERS keys) are the static bank.
// Instead of showing all 8 at once (visually heavy), each page load shows a
// shuffled sample of them, mixed with 1-2 chips generated from *today's*
// live numbers -- so the panel always has something that reflects what's
// actually on the dashboard right now, without needing any extra API call
// (all built client-side from window._cachedData).
const STATIC_SUGGESTIONS = Object.keys(CACHED_ANSWERS);

function shuffleArr(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildDynamicChips(cached) {
  if (!cached) return [];
  const ind = cached.indicators || {};
  const fs = cached.foundation_score;
  const chips = [];

  if (fs && fs.red_zone && fs.red_zone.length) {
    const worst = fs.red_zone[0];
    chips.push(`Why is the Foundation Score ${fs.red_zone.length}/${fs.checked} today?`);
    chips.push(`Why is ${worst.label} at ${worst.value} a warning sign?`);
  }
  if (ind.pmi != null) chips.push(`What does a Manufacturing PMI of ${ind.pmi} tell us?`);
  if (ind.cpi != null) chips.push(`Is ${ind.cpi}% CPI inflation good or bad for India right now?`);
  if (ind.repo_rate != null) chips.push(`How does today's ${ind.repo_rate}% repo rate affect my EMI?`);
  if (ind.export_growth != null) chips.push(`What's behind ${ind.export_growth}% export growth today?`);
  if (ind.unemployment != null) chips.push(`What does ${ind.unemployment}% unemployment mean right now?`);

  return chips;
}

function renderSuggestionChips() {
  const row = document.getElementById('suggest-row');
  if (!row) return;

  const dynamic = shuffleArr(buildDynamicChips(window._cachedData)).slice(0, 2);
  const staticNeeded = Math.max(2, 4 - dynamic.length);
  const staticPicks = shuffleArr(STATIC_SUGGESTIONS).slice(0, staticNeeded);
  const combined = shuffleArr([
    ...dynamic.map(q => ({ q, dynamic: true })),
    ...staticPicks.map(q => ({ q, dynamic: false })),
  ]);

  row.innerHTML = '';
  combined.forEach(({ q, dynamic: isDynamic }) => {
    const btn = document.createElement('button');
    btn.className = 'suggest-btn' + (isDynamic ? ' dynamic' : '');
    btn.type = 'button';
    btn.title = isDynamic ? "Generated from today's live dashboard numbers" : '';
    btn.textContent = q;
    btn.addEventListener('click', () => askSuggested(btn));
    row.appendChild(btn);
  });
}

// ── Chatbot cooldown: 15 seconds between messages ───────────────────────────
let _chatCooldownUntil = 0;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ═══════════════════════════════════════════
//  "SHOW ME THE DATA" TOOLTIPS
// ═══════════════════════════════════════════
// When the AI's answer mentions a tracked metric by name, turn that phrase
// into a hover target showing today's live value -- so "Manufacturing PMI"
// in the AI's prose is backed by the actual number on the dashboard above it.
const METRIC_DEFS = [
  { pattern: 'manufacturing pmi',        key: 'pmi',                          unit: '' },
  { pattern: 'pmi',                      key: 'pmi',                          unit: '' },
  { pattern: 'cpi inflation',            key: 'cpi',                          unit: '%' },
  { pattern: 'wpi inflation',            key: 'ds:supply:wpi_inflation',      unit: '%' },
  { pattern: 'gdp growth',               key: 'gdp_growth',                   unit: '%' },
  { pattern: 'repo rate',                key: 'repo_rate',                    unit: '%' },
  { pattern: 'unemployment rate',        key: 'unemployment',                 unit: '%' },
  { pattern: 'unemployment',             key: 'unemployment',                 unit: '%' },
  { pattern: 'export growth',            key: 'export_growth',                unit: '%' },
  { pattern: 'core sector growth',       key: 'ds:supply:core_sector_growth', unit: '%' },
  { pattern: 'capacity utilization',     key: 'ds:supply:capacity_util',      unit: '%' },
  { pattern: 'capacity utilisation',     key: 'ds:supply:capacity_util',      unit: '%' },
  { pattern: 'corporate earnings',       key: 'ds:supply:corporate_earnings', unit: '%' },
  { pattern: 'private consumption',      key: 'ds:demand:pfce_growth',        unit: '%' },
  { pattern: 'foundation score',         key: '__foundation__',               unit: '' },
  { pattern: 'inr/usd',                  key: 'inr_usd',                      unit: '' },
  { pattern: 'inr-usd',                  key: 'inr_usd',                      unit: '' },
].sort((a, b) => b.pattern.length - a.pattern.length); // longest phrase wins ("manufacturing pmi" before "pmi")

function getLiveMetricValue(key, cached) {
  if (!cached) return null;
  if (key === '__foundation__') {
    const fs = cached.foundation_score;
    return fs ? `${fs.red_zone.length}/${fs.checked} indicators in a red zone` : null;
  }
  if (key.startsWith('ds:')) {
    const [, side, field] = key.split(':');
    const v = cached.indicators?.demand_supply?.[side]?.[field]?.value;
    return v == null ? null : v;
  }
  return cached.indicators?.[key] ?? null;
}

function linkifyMetrics(rawText) {
  const escaped = escapeHtml(rawText);
  const cached = window._cachedData;
  if (!cached) return escaped;

  const escapedPatterns = METRIC_DEFS.map(d => d.pattern.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
  const master = new RegExp('\\b(' + escapedPatterns.join('|') + ')\\b', 'gi');

  return escaped.replace(master, (match) => {
    const lower = match.toLowerCase();
    const def = METRIC_DEFS.find(d => d.pattern === lower);
    if (!def) return match;
    const val = getLiveMetricValue(def.key, cached);
    if (val == null) return match;
    return `<span class="metric-tip" title="Live value right now: ${val}${def.unit}">${match}</span>`;
  });
}

function appendMsg(text, role) {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-msg ${role==='user'?'user-msg':'bot-msg'}`;
  const bubbleHtml = role === 'user' ? escapeHtml(text) : linkifyMetrics(text);
  div.innerHTML = `
    <div class="msg-avatar">${role==='user'?'<img src="/static/img/user-avatar.svg" alt="You" width="32" height="32">':'<img src="/static/img/bot-avatar.svg" alt="AI assistant" width="32" height="32">'}</div>
    <div class="msg-bubble">${bubbleHtml}</div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

function showTyping() {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg bot-msg'; div.id = 'typing-indicator';
  div.innerHTML = `<div class="msg-avatar"><img src="/static/img/bot-avatar.svg" alt="AI assistant" width="32" height="32"></div>
    <div class="msg-bubble typing">
      <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
    </div>`;
  box.appendChild(div); box.scrollTop = box.scrollHeight;
}

function removeTyping() { document.getElementById('typing-indicator')?.remove(); }

function buildDashboardContext() {
  // Built entirely from data already sitting in window._cachedData -- zero
  // extra network calls. Sent to the backend so it can answer questions
  // like "why is the Foundation Score 4/12 today?" using the real numbers
  // that are on screen right now.
  const cached = window._cachedData;
  if (!cached) return null;
  const ind = cached.indicators || {};
  const fs = cached.foundation_score;
  return {
    risk_score: cached.risk_score,
    prediction_label: cached.prediction?.label,
    foundation_red_zone_count: fs?.red_zone?.length,
    foundation_checked: fs?.checked,
    foundation_red_zone: (fs?.red_zone || []).slice(0, 12).map(r => ({ label: r.label, value: r.value })),
    gdp_growth: ind.gdp_growth,
    cpi: ind.cpi,
    pmi: ind.pmi,
    export_growth: ind.export_growth,
    repo_rate: ind.repo_rate,
    unemployment: ind.unemployment,
    inr_usd: ind.inr_usd,
  };
}

async function sendToGemini(question) {
  try {
    const res  = await fetch('/api/learn', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({question, history: CHAT_HISTORY.slice(-6), context: buildDashboardContext()}) });
    const data = await res.json();
    return data.answer || 'Sorry, I could not generate an answer right now. Please try again.';
  } catch { return 'Network error — could not reach the server. Please refresh and try again.'; }
}

async function sendQuestion() {
  const input = document.getElementById('chat-input');
  const btn   = document.getElementById('send-btn');
  const q = input.value.trim(); if (!q) return;

  // 15-second cooldown between messages
  const now = Date.now();
  if (now < _chatCooldownUntil) {
    const secsLeft = Math.ceil((_chatCooldownUntil - now) / 1000);
    btn.textContent = `Wait ${secsLeft}s`;
    return;
  }
  _chatCooldownUntil = now + 15000;

  input.value = ''; btn.disabled = true;
  appendMsg(q, 'user');
  CHAT_HISTORY.push({role:'user', text:q});
  saveChatHistory();
  showTyping();

  // Check cache first — exact match on suggested questions
  const cached = CACHED_ANSWERS[q];
  let answer;
  if (cached) {
    await new Promise(r => setTimeout(r, 600)); // brief pause so typing indicator shows
    answer = cached;
  } else {
    answer = await sendToGemini(q);
  }

  removeTyping();
  appendMsg(answer, 'bot');
  CHAT_HISTORY.push({role:'bot', text:answer});
  saveChatHistory();

  // Re-enable after cooldown expires — live countdown every second
  btn.setAttribute('data-cooldown', '1');
  const cdInterval = setInterval(() => {
    const remaining = Math.ceil((_chatCooldownUntil - Date.now()) / 1000);
    if (remaining <= 0) {
      clearInterval(cdInterval);
      btn.disabled = false;
      btn.textContent = 'Ask';
      btn.removeAttribute('data-cooldown');
    } else {
      btn.textContent = `${remaining}s`;
    }
  }, 1000);
  input.focus();
}

function askSuggested(btn) {
  document.getElementById('chat-input').value = btn.textContent.trim();
  sendQuestion();
}

function initLearnSection(indicators) {
  if (indicators) injectLiveValues(indicators);
  renderDefCards();
  initLearnTabs();
  initLearnSearch();
  renderSuggestionChips();
  // Restore chat history from session
  if (CHAT_HISTORY.length > 0) {
    const box = document.getElementById('chat-messages');
    box.innerHTML = ''; // clear default welcome msg
    CHAT_HISTORY.forEach(m => appendMsg(m.text, m.role === 'user' ? 'user' : 'bot'));
  }
}

function openConfigModal() {
  document.getElementById('config-modal-overlay').style.display = 'flex';
  
  const storedToken = sessionStorage.getItem('admin_token') || '';
  if (storedToken) {
    // If already verified this session, unlock directly
    document.getElementById('admin-token-input').value = storedToken;
    authenticateAdmin();
  } else {
    // Otherwise, show password lock screen
    document.getElementById('config-auth-view').style.display = 'block';
    document.getElementById('config-fields-view').style.display = 'none';
    document.getElementById('admin-token-input').value = '';
    document.getElementById('auth-error-msg').textContent = '';
  }
}

function closeConfigModal() {
  document.getElementById('config-modal-overlay').style.display = 'none';
}

function authenticateAdmin() {
  const token = document.getElementById('admin-token-input').value.trim();
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const errMsg = document.getElementById('auth-error-msg');
  errMsg.textContent = 'Verifying token...';
  errMsg.style.color = 'var(--text)';
  
  fetch('/api/config', { headers: headers })
    .then(async res => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid Admin Token');
      return data;
    })
    .then(data => {
      // Token verified successfully! Store it and unlock the panel
      sessionStorage.setItem('admin_token', token);
      window._serverConfig = data;
      
      // Populate standard config values
      document.getElementById('cfg-wpi').value = data.demand_supply.supply.wpi_inflation.value;
      document.getElementById('cfg-core').value = data.demand_supply.supply.core_sector_growth.value;
      document.getElementById('cfg-cap-util').value = data.demand_supply.supply.capacity_util.value;
      document.getElementById('cfg-corp-earning').value = data.demand_supply.supply.corporate_earnings.value;
      document.getElementById('cfg-pfce').value = data.demand_supply.demand.pfce_growth.value;
      document.getElementById('cfg-repo').value = data.macro.repo_rate;
      
      // Populate extra configurations
      document.getElementById('cfg-mpc').value = data.macro.next_mpc_meeting || '';
      document.getElementById('cfg-fallback-gdp').value = data.fallback_defaults?.gdp_growth_pct || 7.7;
      document.getElementById('cfg-fallback-cpi').value = data.fallback_defaults?.cpi_inflation_pct || 3.93;
      document.getElementById('cfg-fallback-inr').value = data.fallback_defaults?.inr_usd || 94.5;
      
      // Toggle UI views
      document.getElementById('config-auth-view').style.display = 'none';
      document.getElementById('config-fields-view').style.display = 'block';
    })
    .catch(err => {
      errMsg.textContent = err.message;
      errMsg.style.color = 'var(--red)';
    });
}

function saveConfiguration() {
  if (!window._serverConfig) {
    alert('No configuration data loaded.');
    return;
  }
  
  // Update standard indicators
  window._serverConfig.demand_supply.supply.wpi_inflation.value = parseFloat(document.getElementById('cfg-wpi').value);
  window._serverConfig.demand_supply.supply.core_sector_growth.value = parseFloat(document.getElementById('cfg-core').value);
  window._serverConfig.demand_supply.supply.capacity_util.value = parseFloat(document.getElementById('cfg-cap-util').value);
  window._serverConfig.demand_supply.supply.corporate_earnings.value = parseFloat(document.getElementById('cfg-corp-earning').value);
  window._serverConfig.demand_supply.demand.pfce_growth.value = parseFloat(document.getElementById('cfg-pfce').value);
  window._serverConfig.macro.repo_rate = parseFloat(document.getElementById('cfg-repo').value);
  
  // Update extra features
  window._serverConfig.macro.next_mpc_meeting = document.getElementById('cfg-mpc').value.trim();
  if (!window._serverConfig.fallback_defaults) window._serverConfig.fallback_defaults = {};
  window._serverConfig.fallback_defaults.gdp_growth_pct = parseFloat(document.getElementById('cfg-fallback-gdp').value);
  window._serverConfig.fallback_defaults.cpi_inflation_pct = parseFloat(document.getElementById('cfg-fallback-cpi').value);
  window._serverConfig.fallback_defaults.inr_usd = parseFloat(document.getElementById('cfg-fallback-inr').value);
  
  const token = sessionStorage.getItem('admin_token') || '';
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  fetch('/api/config', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(window._serverConfig)
  })
    .then(async res => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server returned an error');
      return data;
    })
    .then(data => {
      alert('Configuration updated successfully!');
      closeConfigModal();
      refreshAll();
    })
    .catch(err => {
      alert(`Save failed: ${err.message}`);
    });
}

function triggerAIRefresh() {
  const token = sessionStorage.getItem('admin_token') || '';
  const btn = document.getElementById('refresh-ai-btn');
  const statusDiv = document.getElementById('refresh-status');
  
  btn.disabled = true;
  statusDiv.style.color = 'var(--text)';
  statusDiv.textContent = 'Refreshing AI data via Gemini, please wait... (takes up to 30s)';
  
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  fetch('/api/refresh-grounding', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({})
  })
    .then(async res => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server returned an error');
      return data;
    })
    .then(data => {
      statusDiv.style.color = 'var(--green)';
      statusDiv.textContent = `Success! Main updated: ${data.grounding_updated}, Extended: ${data.extended_updated}`;
      refreshAll();
    })
    .catch(err => {
      statusDiv.style.color = 'var(--red)';
      statusDiv.textContent = `Refresh failed: ${err.message}`;
    })
    .finally(() => {
      btn.disabled = false;
    });
}