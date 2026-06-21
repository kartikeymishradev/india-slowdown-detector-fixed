// India Economic Slowdown Detector — Frontend

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
const SEC_ICONS = {manufacturing:'🏭',banking:'🏦',agriculture:'🌾',trade:'🚢',employment:'👥'};

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
const HIST_LABELS = ['2018','2019','2020','2021','2022','2023','2024','2025*'];
const HIST_DATA = {
  gdp:     [7.2, 4.0, -5.8, 9.1, 7.2, 8.2, 6.7, 6.4],
  exports: [9.8, -4.7, -7.3, 29.4, 12.3, -5.0, -2.5, -3.0],
  unemp:   [6.1, 7.6, 9.0, 8.1, 7.3, 7.7, 7.9, 8.0],
};

async function apiFetch(url) {
  try { const r = await fetch(url); if(!r.ok) throw new Error(); return await r.json(); }
  catch { return null; }
}

function setHeroBanner(risk, label) {
  const banner = document.getElementById('status-banner');
  const status = document.getElementById('hero-status');
  const sub    = document.getElementById('hero-sub');
  document.getElementById('hero-score').textContent = risk;

  const cfg = {
    'Stable':   ['green', '✅ Economy Stable', 'No immediate slowdown signals detected across major sectors'],
    'Warning':  ['amber', '⚠️ Moderate Warning', 'Trade exports declining & credit growth softening — watch closely'],
    'Slowdown': ['red',   '🚨 Slowdown Detected', 'Multiple sector alerts triggered — high economic risk'],
  };
  const [cls, st, sb] = cfg[label] || ['', 'Analyzing…', 'Fetching live indicators'];
  banner.className = `hero-banner ${cls}`;
  status.textContent = st;
  sub.textContent = sb;
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
  document.getElementById('last-updated').textContent = ind.last_updated;

  const SOURCE_BADGE = {
    live:         '<span class="src-badge src-live" title="Fetched live from external API">🟢 Live</span>',
    ai_grounded:  '<span class="src-badge src-ai" title="Fetched via Gemini + Google Search grounding">🔵 AI-grounded</span>',
    manual:       '<span class="src-badge src-manual" title="Manually updated in config.json">🟡 Manual</span>',
  };
  const BADGE_TARGETS = {
    gdp_growth:'m-gdp-src', cpi:'m-cpi-src', repo_rate:'m-repo-src',
    inr_usd:'m-fx-src', export_growth:'m-exp-src', unemployment:'m-unemp-src'
  };
  Object.entries(BADGE_TARGETS).forEach(([field, elId]) => {
    const el = document.getElementById(elId);
    if (el) el.innerHTML = SOURCE_BADGE[fs[field] || 'manual'];
  });
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
    card.onclick = () => { selectedSec=key; buildSectors(sectors); buildTrend(s); };
    grid.appendChild(card);

    const tab = document.createElement('button');
    tab.className = 's-tab'+(key===selectedSec?' active':'');
    tab.textContent = SEC_ICONS[key]+' '+s.name.split(' ')[0];
    tab.onclick = () => { selectedSec=key; buildSectors(sectors); buildTrend(s); };
    tabs.appendChild(tab);
  });
}

function buildTrend(s) {
  const ctx = document.getElementById('trendChart').getContext('2d');
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: TLABELS, datasets: [
      { label: s.name, data: s.trend, backgroundColor:'rgba(37,99,235,.2)', borderColor:'#3B82F6', borderWidth:1.5, borderRadius:3, order:2 },
      { label:'Avg', data:Array(12).fill(s.avg), type:'line', borderColor:'#22C55E', borderWidth:2, borderDash:[4,3], pointRadius:0, fill:false, order:1 },
      { label:'Threshold', data:Array(12).fill(s.threshold), type:'line', borderColor:'#EF4444', borderWidth:1.5, borderDash:[6,3], pointRadius:0, fill:false, order:0 }
    ]},
    options: {
      responsive:true, maintainAspectRatio:false,
      scales: {
        x: { ticks:{font:{size:10},autoSkip:false,maxRotation:45}, grid:{display:false} },
        y: { ticks:{font:{size:11}}, title:{display:true,text:s.desc||s.name,font:{size:10}} }
      },
      plugins: { legend:{display:false}, tooltip:{mode:'index',intersect:false} }
    }
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
      plugins:{ legend:{position:'top',labels:{font:{size:11},boxWidth:12}}, tooltip:{mode:'index',intersect:false} }
    }
  });
}

async function runAI() {
  const box = document.getElementById('ai-box');
  const btn = document.getElementById('ai-btn');
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
      box.textContent = json.analysis;
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
  buildExtra(data.indicators.extended_indicators, data.indicators.derived_features);
  buildFeat();
  buildHist();
  initLearnSection(data.indicators);

   // Hide loader here
  document.getElementById("loader").style.display = "none";
}

refreshAll();
// ═══════════════════════════════════════════
//  LEARN & ASK SECTION — Add to script.js
// ═══════════════════════════════════════════

// ── Definitions data ──────────────────────────────────────────────────────────
const DEFINITIONS = [
  {
    id: 'gdp',
    name: 'GDP Growth',
    cat: 'macro',
    simple: 'GDP stands for Gross Domestic Product — the total value of everything a country produces in a year. GDP growth tells you how fast the economy is expanding.',
    example: 'If India\'s GDP growth is 6%, it means the country produced 6% more goods and services this year than last year. If growth drops to 4%, that\'s a sign of a slowdown.',
    current: null,
    current_label: 'GDP Growth',
    source: 'MOSPI',
    source_url: 'https://mospi.gov.in',
    indicator_key: 'gdp_growth',
    unit: '%'
  },
  {
    id: 'cpi',
    name: 'CPI Inflation',
    cat: 'macro',
    simple: 'CPI (Consumer Price Index) tracks how much everyday items — milk, pulses, petrol — have become more expensive. Higher inflation means higher prices for the same things.',
    example: 'If CPI inflation is 6%, something that cost ₹100 last year now costs ₹106. The RBI aims to keep inflation close to 4%.',
    current: null,
    current_label: 'CPI Inflation',
    source: 'MOSPI',
    source_url: 'https://mospi.gov.in/consumer-price-index',
    indicator_key: 'cpi',
    unit: '%'
  },
  {
    id: 'repo',
    name: 'Repo Rate',
    cat: 'banking',
    simple: 'The Repo Rate is the interest rate at which the RBI (Reserve Bank of India) lends money to banks. It directly affects your home loan, car loan, and business loan EMIs.',
    example: 'RBI raises the repo rate by 0.25% -> banks\' borrowing cost rises -> banks raise their loan rates -> your EMI goes up. The repo rate is the RBI\'s biggest economic "remote control."',
    current: null,
    current_label: 'Repo Rate',
    source: 'RBI',
    source_url: 'https://rbi.org.in/scripts/BS_PressReleaseDisplay.aspx',
    indicator_key: 'repo_rate',
    unit: '%'
  },
  {
    id: 'pmi',
    name: 'PMI (Manufacturing)',
    cat: 'macro',
    simple: 'PMI (Purchasing Managers\' Index) is a survey of factory managers. Above 50 means factories are growing (expansion). Below 50 means activity is shrinking (contraction).',
    example: 'PMI at 54 -> factories are taking new orders, production is rising, hiring is up. PMI at 47 -> orders have dried up, production is falling, layoffs may follow. India\'s PMI fell to as low as 27 during COVID.',
    current: null,
    current_label: 'Mfg PMI',
    source: 'S&P Global',
    source_url: 'https://www.spglobal.com/marketintelligence/en/mi/research-analysis/india-pmi.html',
    indicator_key: 'pmi',
    unit: ''
  },
  {
    id: 'pmi_services',
    name: 'PMI (Services)',
    cat: 'macro',
    simple: 'Same idea as Manufacturing PMI, but for the services sector — IT, banking, hospitality, retail, and more. Since services make up over half of India\'s economy, this number matters just as much as factory PMI.',
    example: 'Services PMI at 60 -> IT firms, hotels, and banks are all seeing strong demand and hiring more staff. Services PMI below 50 -> demand for services is contracting, which often shows up in jobs data a few months later.',
    current: null,
    current_label: 'Services PMI',
    source: 'S&P Global',
    source_url: 'https://www.spglobal.com/marketintelligence/en/mi/research-analysis/india-pmi.html',
    indicator_key: 'pmi_services',
    indicator_source: 'extended',
    unit: ''
  },
  {
    id: 'composite_pmi',
    name: 'Composite PMI',
    cat: 'macro',
    simple: 'A single number that blends Manufacturing and Services PMI together — a quick, whole-economy health check in one figure. It is calculated automatically as the average of the two.',
    example: 'If Manufacturing PMI is 55 and Services PMI is 60, the Composite PMI is 57.5 — both halves of the economy are expanding, giving an overall picture of broad-based growth.',
    current: null,
    current_label: 'Composite PMI',
    source: 'Calculated (Mfg + Services PMI) / 2',
    source_url: 'https://www.spglobal.com/marketintelligence/en/mi/research-analysis/india-pmi.html',
    indicator_key: 'composite_pmi',
    indicator_source: 'derived',
    unit: ''
  },
  {
    id: 'unemployment',
    name: 'Unemployment Rate',
    cat: 'jobs',
    simple: 'The percentage of people looking for work who couldn\'t find any. India measures urban and rural unemployment separately because the patterns differ a lot.',
    example: 'Urban unemployment at 8% means that out of 100 people in cities wanting to work, 8 couldn\'t find a job. During the COVID lockdown it briefly touched 23% — nearly 1 in 4 people out of work.',
    current: null,
    current_label: 'Urban Unemployment',
    source: 'CMIE',
    source_url: 'https://unemploymentinindia.cmie.com',
    indicator_key: 'unemployment',
    unit: '%'
  },
  {
    id: 'credit',
    name: 'Bank Credit Growth',
    cat: 'banking',
    simple: 'How much more banks have lent out this year compared to last year, as a percentage. Strong credit growth usually means businesses and individuals are investing and the economy is active.',
    example: 'Credit growth at 15% -> businesses are expanding, people are buying homes. Credit growth at 5% -> people have stopped borrowing, less cash is flowing through the economy — often an early warning sign of a slowdown.',
    current: null,
    current_label: 'Credit Growth',
    source: 'RBI',
    source_url: 'https://rbi.org.in/scripts/BS_PressReleaseDisplay.aspx',
    indicator_key: 'credit_growth',
    unit: '%'
  },
  {
    id: 'exports',
    name: 'Export Growth',
    cat: 'trade',
    simple: 'How much more (or less) India sold to other countries compared to last year. Rising exports mean the world is buying more Indian goods, which is good for the economy.',
    example: 'Export growth at -5% means India exported 5% less than the year before — usually a sign of weaker global demand or an expensive rupee. Sustained negative exports are a major slowdown warning sign.',
    current: null,
    current_label: 'Export Growth',
    source: 'Ministry of Commerce',
    source_url: 'https://commerce.gov.in',
    indicator_key: 'export_growth',
    unit: '%'
  },
  {
    id: 'inr',
    name: 'INR / USD Exchange Rate',
    cat: 'trade',
    simple: 'How many Indian Rupees it takes to buy one US Dollar. A weaker rupee (a higher number) makes imports more expensive and can push up inflation.',
    example: '₹80/dollar moving to ₹84/dollar means the rupee weakened by 5%. Petrol, electronics, and gold all get pricier because they are priced in dollars. But IT exporters benefit, since their dollar earnings convert into more rupees.',
    current: null,
    current_label: 'INR/USD',
    source: 'RBI',
    source_url: 'https://rbi.org.in/Scripts/ReferenceRateArchive.aspx',
    indicator_key: 'inr_usd',
    unit: '₹'
  },
  {
    id: 'agri',
    name: 'Agriculture GVA Growth',
    cat: 'macro',
    simple: 'The growth in value created by farming and allied activities. Over 40% of India\'s population depends on agriculture for their livelihood, so this number matters a great deal.',
    example: 'Agri GVA growth at 4% -> good monsoon, healthy harvest, happy farmers, strong rural demand. Agri growth at 1% -> drought or flood, poor harvest, lower rural spending, which drags down overall GDP too.',
    current: null,
    current_label: 'Agri GVA',
    source: 'MOSPI',
    source_url: 'https://mospi.gov.in/national-account-statistics',
    indicator_key: 'agri_gva',
    unit: '%'
  },
  {
    id: 'gst',
    name: 'GST Collections',
    cat: 'macro',
    simple: 'The total amount the government collects every month from businesses as GST (Goods & Services Tax). It is one of the most direct, real-time readings of domestic economic activity — more business activity means more GST collected.',
    example: 'GST collections of ₹2 lakh crore in a month -> businesses are selling a lot, the economy is moving fast. Collections of ₹1.2 lakh crore -> fewer transactions are happening, signalling the economy is cooling off.',
    current: null,
    current_label: 'GST Collection',
    source: 'GST Council',
    source_url: 'https://gst.gov.in/websitehome/revenue-statistics',
    indicator_key: 'gst_collection',
    indicator_source: 'extended',
    unit: '₹ Cr'
  },
  {
    id: 'gst_momentum',
    name: 'GST Momentum',
    cat: 'macro',
    simple: 'How much GST collections changed compared to the previous month, as a percentage. This shows direction and speed — is collection accelerating or slowing — rather than just the raw total.',
    example: 'If GST collections went from ₹1.78 lakh crore to ₹1.85 lakh crore, momentum is about +4% — business activity is picking up. A sharp negative momentum across a few months in a row is an early slowdown signal.',
    current: null,
    current_label: 'GST Momentum',
    source: 'Calculated (month-over-month % change)',
    source_url: 'https://gst.gov.in/websitehome/revenue-statistics',
    indicator_key: 'gst_momentum',
    indicator_source: 'derived',
    unit: '%'
  },
  {
    id: 'vix',
    name: 'India VIX',
    cat: 'market',
    simple: 'VIX is the "Fear Index" — it measures how much volatility (fear or uncertainty) investors expect in the stock market. A high VIX means investors are nervous; a low VIX means things are calm.',
    example: 'India VIX at 12 -> markets are stable, investors feel confident. VIX above 30 -> something big is worrying the market — election results, a global crisis, or an event like COVID. VIX touched 80+ in 2020.',
    current: null,
    current_label: 'India VIX',
    source: 'NSE India',
    source_url: 'https://nseindia.com/market-data/india-vix',
    indicator_key: 'india_vix',
    indicator_source: 'extended',
    unit: ''
  },
  {
    id: 'fii',
    name: 'FII Net Flow',
    cat: 'market',
    simple: 'FII stands for Foreign Institutional Investors — money coming from outside India into Indian markets. Whether this money is flowing in or out is a strong signal of how confident global investors feel about India\'s economy.',
    example: 'FII pulls out ₹10,000 crore -> foreign investors have taken money out of India, the market falls, and the rupee weakens. FII puts in ₹8,000 crore -> global investors are buying Indian stocks, which supports the market.',
    current: null,
    current_label: 'FII Net Flow',
    source: 'NSDL / NSE',
    source_url: 'https://nsdl.co.in/publications/fii.php',
    indicator_key: 'fii_net_flow',
    indicator_source: 'extended',
    unit: '₹ Cr'
  },
  {
    id: 'iip',
    name: 'IIP / Core Sector Index',
    cat: 'macro',
    simple: 'IIP (Index of Industrial Production) shows how much factory production rose or fell. Eight "core" sectors — steel, cement, electricity, oil, and others — make up about 40% of this index.',
    example: 'IIP at +6% -> factories are running at full speed, the industrial economy is strong. IIP at -2% -> manufacturing is slowing, fewer new orders, possible layoffs. IIP fell as much as -57% during the COVID lockdown.',
    current: null,
    current_label: 'IIP Growth',
    source: 'MOSPI',
    source_url: 'https://mospi.gov.in/iip',
    indicator_key: 'iip_growth',
    unit: '%'
  },
  {
    id: 'railway',
    name: 'Railway Freight Traffic',
    cat: 'trade',
    simple: 'How much cargo (coal, cement, steel, grain) Indian Railways moved from one place to another, measured in million tonnes. This is one of the most direct, physical proofs of real economic activity.',
    example: 'Railway freight at 140 MT -> industries are running at full production, raw materials are on the move. Freight at 110 MT -> industrial slowdown, fewer orders, less cargo being transported.',
    current: null,
    current_label: 'Railway Freight',
    source: 'Indian Railways',
    source_url: 'https://indianrailways.gov.in/railwayboard/stat',
    indicator_key: 'railway_freight',
    indicator_source: 'extended',
    unit: 'MT'
  },
  {
    id: 'upi',
    name: 'UPI Transaction Volume',
    cat: 'market',
    simple: 'The number of payments made through apps like PhonePe, GPay, and Paytm — the most real-time available indicator of retail consumer spending. More transactions usually means people are spending, and the economy is active.',
    example: 'UPI volume of 14 billion transactions a month -> people are spending freely, retail demand is strong. Volume drops to 8 billion -> people have cut back on spending, a sign of weaker consumer sentiment. Volume tends to spike during the festive season.',
    current: null,
    current_label: 'UPI Volume',
    source: 'NPCI',
    source_url: 'https://npci.org.in/what-we-do/upi/upi-ecosystem-statistics',
    indicator_key: 'upi_volume',
    indicator_source: 'extended',
    unit: 'B txns'
  },
  {
    id: 'electricity',
    name: 'Electricity Demand',
    cat: 'macro',
    simple: 'How much power the country consumed in a month, measured in Billion Units (BU). Electricity use tracks closely with factory output, commercial activity, and even how hot the summer is — it is a clean, hard-to-fake gauge of activity.',
    example: 'Electricity demand at 165 BU during a heatwave summer -> both industrial activity and air-conditioning load are high. A sharp YoY drop outside of seasonal effects can point to factories cutting back production.',
    current: null,
    current_label: 'Electricity Demand',
    source: 'POSOCO / Grid-India',
    source_url: 'https://posoco.in',
    indicator_key: 'electricity_demand',
    indicator_source: 'extended',
    unit: 'BU'
  },
  {
    id: 'eway',
    name: 'E-Way Bills',
    cat: 'trade',
    simple: 'An E-Way Bill is generated every time goods worth more than ₹50,000 move across state lines under GST rules. The growth in how many are generated each month is a very direct read on goods movement and trade activity within the country.',
    example: 'E-way bill generation growing 15% YoY -> more goods are being shipped around the country, suggesting healthy domestic trade. Growth turning negative -> businesses are moving less stock, often a precursor to weaker GST collections the following month.',
    current: null,
    current_label: 'E-Way Bills YoY',
    source: 'GSTN',
    source_url: 'https://ewaybillgst.gov.in',
    indicator_key: 'eway_bill_growth',
    indicator_source: 'extended',
    unit: '%'
  },
  {
    id: 'diesel',
    name: 'Diesel Consumption',
    cat: 'trade',
    simple: 'How much diesel the country used compared to a year ago. Since trucks, tractors, and generators run on diesel, this number is a good proxy for transport activity, farming, and industrial demand all at once.',
    example: 'Diesel consumption growth at 6% -> more trucks on the road, more goods being moved, farms running irrigation pumps. A drop in diesel demand often shows up before official freight or industrial data does.',
    current: null,
    current_label: 'Diesel Consumption YoY',
    source: 'PPAC',
    source_url: 'https://ppac.gov.in',
    indicator_key: 'diesel_consumption_growth',
    indicator_source: 'extended',
    unit: '%'
  },
  {
    id: 'trade_balance',
    name: 'Trade Balance',
    cat: 'trade',
    simple: 'The difference between what India exports and what it imports, in US dollars. A negative number (a "trade deficit") means India is buying more from the world than it is selling — which it usually does, mainly because of oil imports.',
    example: 'A trade balance of -$20B means India imported $20 billion more than it exported that month. A widening deficit beyond about -$20B puts pressure on the rupee and can be an early warning sign for the currency.',
    current: null,
    current_label: 'Trade Balance',
    source: 'Calculated (exports - imports)',
    source_url: 'https://commerce.gov.in',
    indicator_key: 'trade_balance',
    indicator_source: 'extended',
    unit: '$B'
  }
];

// ── Category colors ────────────────────────────────────────────────────────────
const CAT_CLASS = {
  macro: 'cat-macro', market: 'cat-market',
  banking: 'cat-banking', trade: 'cat-trade', jobs: 'cat-jobs'
};
const CAT_LABEL = {
  macro: 'Macro', market: 'Market',
  banking: 'Banking', trade: 'Trade', jobs: 'Jobs'
};

// ── Inject live values from dashboard data ────────────────────────────────────
function injectLiveValues(indicators) {
  const extended = (indicators && indicators.extended_indicators) || {};
  const derived = (indicators && indicators.derived_features) || {};

  DEFINITIONS.forEach(def => {
    if (!def.indicator_key) return;
    if (def.indicator_source === 'extended' && extended[def.indicator_key] != null) {
      def.current = extended[def.indicator_key];
    } else if (def.indicator_source === 'derived' && derived[def.indicator_key] != null) {
      def.current = derived[def.indicator_key];
    } else if (!def.indicator_source && indicators && indicators[def.indicator_key] != null) {
      def.current = indicators[def.indicator_key];
    }
  });
}

// ── Render definition cards ───────────────────────────────────────────────────
function renderDefCards(filter, search) {
  filter = filter || 'all';
  search = search || '';
  const grid = document.getElementById('def-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const filtered = DEFINITIONS.filter(d => {
    const matchCat = filter === 'all' || d.cat === filter;
    const matchSearch = !search || d.name.toLowerCase().includes(search.toLowerCase())
      || d.simple.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  if (filtered.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:30px">No results found</div>';
    return;
  }

  filtered.forEach(def => {
    const card = document.createElement('div');
    card.className = 'def-card';
    card.dataset.id = def.id;
    card.innerHTML = `
      <div class="def-top">
        <div class="def-name">${def.name}</div>
        <span class="def-cat-badge ${CAT_CLASS[def.cat]}">${CAT_LABEL[def.cat]}</span>
      </div>
      <div class="def-simple">${def.simple}</div>
      ${def.current != null ? `<div class="def-current">Now: ${def.unit === '₹' ? '₹' : ''}${def.current}${def.unit !== '₹' ? (def.unit ? ' ' + def.unit : '') : ''}</div>` : ''}
      <div class="def-example">${def.example}</div>
      <div class="def-footer">
        <span class="def-source">Source: <a href="${def.source_url}" target="_blank">${def.source} &#8599;</a></span>
        <button class="def-toggle" onclick="toggleDef(event,'${def.id}')">Show example &#9662;</button>
      </div>`;
    grid.appendChild(card);
  });
}

function toggleDef(e, id) {
  e.stopPropagation();
  const card = document.querySelector(`.def-card[data-id="${id}"]`);
  const btn  = card.querySelector('.def-toggle');
  card.classList.toggle('expanded');
  btn.innerHTML = card.classList.contains('expanded') ? 'Hide example &#9652;' : 'Show example &#9662;';
}

// ── Category tab clicks ───────────────────────────────────────────────────────
function initLearnTabs() {
  document.querySelectorAll('.learn-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.learn-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderDefCards(tab.dataset.cat, document.getElementById('learn-search')?.value || '');
    });
  });
}

// ── Search ────────────────────────────────────────────────────────────────────
function initLearnSearch() {
  const input = document.getElementById('learn-search');
  if (!input) return;
  input.addEventListener('input', () => {
    const activeCat = document.querySelector('.learn-tab.active')?.dataset.cat || 'all';
    renderDefCards(activeCat, input.value);
  });
}

// ── Chat with Gemini ──────────────────────────────────────────────────────────
const CHAT_HISTORY = [];

function appendMsg(text, role) {
  const box   = document.getElementById('chat-messages');
  const div   = document.createElement('div');
  div.className = `chat-msg ${role === 'user' ? 'user-msg' : 'bot-msg'}`;
  div.innerHTML = `
    <div class="msg-avatar">${role === 'user' ? '<img src="/static/img/user-avatar.svg" alt="You" width="32" height="32">' : '<img src="/static/img/bot-avatar.svg" alt="AI assistant" width="32" height="32">'}</div>
    <div class="msg-bubble">${text}</div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

function showTyping() {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg bot-msg';
  div.id = 'typing-indicator';
  div.innerHTML = `<div class="msg-avatar"><img src="/static/img/bot-avatar.svg" alt="AI assistant" width="32" height="32"></div>
    <div class="msg-bubble typing">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function removeTyping() {
  document.getElementById('typing-indicator')?.remove();
}

async function sendToGemini(question) {
  try {
    const res = await fetch('/api/learn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, history: CHAT_HISTORY.slice(-6) })
    });
    const data = await res.json();
    return data.answer || 'Sorry, I could not generate an answer right now. Please try again in a moment.';
  } catch {
    return 'Network error - could not reach the server. Please refresh and try again.';
  }
}

async function sendQuestion() {
  const input = document.getElementById('chat-input');
  const btn   = document.getElementById('send-btn');
  const q     = input.value.trim();
  if (!q) return;

  input.value = '';
  btn.disabled = true;

  appendMsg(q, 'user');
  CHAT_HISTORY.push({ role: 'user', text: q });

  showTyping();
  const answer = await sendToGemini(q);
  removeTyping();

  appendMsg(answer, 'bot');
  CHAT_HISTORY.push({ role: 'bot', text: answer });
  btn.disabled = false;
  input.focus();
}

function askSuggested(btn) {
  const q = btn.textContent.trim();
  document.getElementById('chat-input').value = q;
  sendQuestion();
}

// ── Init ──────────────────────────────────────────────────────────────────────
function initLearnSection(indicators) {
  if (indicators) injectLiveValues(indicators);
  renderDefCards();
  initLearnTabs();
  initLearnSearch();
}

// Call this after refreshAll() loads data - add to your existing refreshAll():
// initLearnSection(data.indicators);
