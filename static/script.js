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

let trendChart=null, gaugeChart=null, featChart=null, histChart=null;
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

async function apiFetch(url) {
  try { const r = await fetch(url); if(!r.ok) throw new Error(); return await r.json(); }
  catch { return null; }
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
  const fillEl = document.getElementById('sb-score-fill'); if(fillEl) fillEl.style.width = risk + '%';

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

function secStatus(s) {
  if (s.higher_good) return s.value >= s.avg ? 'good' : s.value > s.threshold ? 'warn' : 'bad';
  return s.value <= s.avg ? 'good' : s.value < s.threshold ? 'warn' : 'bad';
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

function buildExtra(ext, derived) {
  const grid = document.getElementById('extra-grid');
  if (!ext) { grid.innerHTML = ''; return; }

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
    </div>`).join('');
}

function buildFeat() {
  const ctx = document.getElementById('featChart').getContext('2d');
  if (featChart) featChart.destroy();
  const sorted = Object.entries(FEAT_IMP).sort((a,b)=>b[1]-a[1]);
  featChart = new Chart(ctx, {
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
}

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
  clearInterval(loadingInterval);
  document.getElementById("loader").style.display = "none";
  return;
}
  window._cachedData = data;

  const sectors = data.indicators.sectors;
  setHeroBanner(data.risk_score, data.prediction.label);
  setMacro(data);
  buildGauge(data.risk_score);
  buildPrediction(data.prediction);
  buildSectors(sectors);
  buildTrend(sectors[selectedSec]);
  buildHF(sectors);
  buildDS(data.indicators.demand_supply);
  buildExtra(data.indicators.extended_indicators, data.indicators.derived_features);
  buildFeat();
  buildHist();
  initHistToggles();
  initLearnSection(data.indicators);

   // Hide loader here
  clearInterval(loadingInterval);
document.getElementById("loader").style.display = "none";
}

refreshAll();

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
    "FIIs (Foreign Institutional Investors) — big global funds like Blackrock, Vanguard — hold a significant chunk of Indian stocks. When they sell and pull money out: (1) Direct impact — selling pressure pushes stock prices down; (2) Rupee weakens — they convert rupees to dollars when leaving; (3) Sentiment effect — other investors panic-sell seeing FII outflows; (4) Liquidity tightens — less money in the market. FII outflow of ₹10,000+ Cr in a month is a warning sign. However, strong domestic investors (DIIs — mutual funds, LIC) now often absorb FII selling, making Indian markets more resilient than before."
};

// ── Chatbot cooldown: 15 seconds between messages ───────────────────────────
let _chatCooldownUntil = 0;

function appendMsg(text, role) {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-msg ${role==='user'?'user-msg':'bot-msg'}`;
  div.innerHTML = `
    <div class="msg-avatar">${role==='user'?'<img src="/static/img/user-avatar.svg" alt="You" width="32" height="32">':'<img src="/static/img/bot-avatar.svg" alt="AI assistant" width="32" height="32">'}</div>
    <div class="msg-bubble">${text}</div>`;
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

async function sendToGemini(question) {
  try {
    const res  = await fetch('/api/learn', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({question, history: CHAT_HISTORY.slice(-6)}) });
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
      btn.style.setProperty('--cd-pct', '100%');
    } else {
      btn.textContent = `${remaining}s`;
      btn.style.setProperty('--cd-pct', `${Math.round(((15 - remaining) / 15) * 100)}%`);
    }
  }, 250);
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
  // Restore chat history from session
  if (CHAT_HISTORY.length > 0) {
    const box = document.getElementById('chat-messages');
    box.innerHTML = ''; // clear default welcome msg
    CHAT_HISTORY.forEach(m => appendMsg(m.text, m.role === 'user' ? 'user' : 'bot'));
  }
}