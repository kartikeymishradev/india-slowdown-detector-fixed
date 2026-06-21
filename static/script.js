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

  // ── TIME FIX — always show IST ──
  document.getElementById('last-updated').textContent = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }) + ' IST';

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
  if (!data) { document.getElementById('last-updated').textContent = 'Error — check connection'; return; }
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
}

refreshAll();

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

const CHAT_HISTORY = [];

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
  input.value = ''; btn.disabled = true;
  appendMsg(q, 'user');
  CHAT_HISTORY.push({role:'user', text:q});
  showTyping();
  const answer = await sendToGemini(q);
  removeTyping();
  appendMsg(answer, 'bot');
  CHAT_HISTORY.push({role:'bot', text:answer});
  btn.disabled = false;
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
}
