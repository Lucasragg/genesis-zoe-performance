const state = { data: null };

const number = new Intl.NumberFormat("pt-BR");
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const decimal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const safeDiv = (a, b) => b ? a / b : 0;
const $ = id => document.getElementById(id);
const fmt = {
  money: v => usd.format(v || 0),
  number: v => number.format(Math.round(v || 0)),
  compact: v => compact.format(v || 0),
  percent: v => pct.format(v || 0),
  decimal: v => decimal.format(v || 0),
  roas: (revenue, spend) => spend ? `${decimal.format(revenue / spend)}x` : "—"
};

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function setText(id, value) {
  const node = $(id);
  if (node) node.textContent = value;
}

function formatDate(date) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" });
}

function metricValues(row) {
  return {
    cpm: safeDiv(row.spend * 1000, row.impressions),
    ctr: safeDiv(row.clicks, row.impressions),
    connect: safeDiv(row.landingPageViews, row.clicks),
    checkoutRate: safeDiv(row.checkouts, row.landingPageViews),
    conversion: safeDiv(row.sales, row.landingPageViews),
    cac: safeDiv(row.spend, row.sales),
    ticket: safeDiv(row.revenue, row.sales),
    roas: safeDiv(row.revenue, row.spend)
  };
}

function renderOverview(data) {
  const t = data.totals;
  const m = metricValues(t);
  setText("period-label", `${formatDate(data.metadata.periodStart)} — ${formatDate(data.metadata.periodEnd)}`);
  setText("sync-date", new Date(data.metadata.generatedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }));
  setText("coverage-badge", fmt.percent(data.coverage.attributionRate));
  setText("kpi-spend", fmt.money(t.spend));
  setText("kpi-sales", fmt.number(t.sales));
  setText("kpi-total-sales", `${fmt.number(data.coverage.totalSales)} vendas totais`);
  setText("kpi-revenue", fmt.money(t.revenue));
  setText("kpi-cac", fmt.money(m.cac));
  setText("kpi-ticket", fmt.money(m.ticket));
  setText("kpi-roas", fmt.roas(t.revenue, t.spend));
  setText("metric-impressions", fmt.number(t.impressions));
  setText("metric-cpm", `${fmt.money(m.cpm)} CPM`);
  setText("metric-clicks", fmt.number(t.clicks));
  setText("metric-ctr", `${fmt.percent(m.ctr)} CTR`);
  setText("metric-lpv", fmt.number(t.landingPageViews));
  setText("metric-connect", `${fmt.percent(m.connect)} connect rate`);
  setText("metric-checkouts", fmt.number(t.checkouts));
  setText("metric-checkout-rate", `${fmt.percent(m.checkoutRate)} avanço`);
  setText("metric-sales", fmt.number(t.sales));
  setText("metric-conversion", `${fmt.percent(m.conversion)} conversão`);
  setText("method-note", data.metadata.attribution);
}

function renderChart(rows) {
  const host = $("daily-chart");
  const width = Math.max(host.clientWidth - 16, 620);
  const height = 306;
  const margin = { top: 26, right: 22, bottom: 48, left: 48 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const max = Math.max(1, ...rows.flatMap(d => [d.revenue, d.spend]));
  const step = plotW / Math.max(rows.length, 1);
  const barW = Math.max(5, Math.min(20, step * .46));
  const y = v => margin.top + plotH - (v / max) * plotH;

  const grids = [0, .25, .5, .75, 1].map(r => {
    const gy = margin.top + plotH - r * plotH;
    return `<line class="gridline" x1="${margin.left}" y1="${gy}" x2="${width - margin.right}" y2="${gy}"/>
      <text x="${margin.left - 8}" y="${gy + 3}" text-anchor="end">${fmt.compact(max * r)}</text>`;
  }).join("");

  const bars = rows.map((d, i) => {
    const x = margin.left + i * step + step / 2 - barW / 2;
    const top = y(d.revenue);
    return `<rect class="bar" x="${x}" y="${top}" width="${barW}" height="${margin.top + plotH - top}" rx="3">
      <title>${formatDate(d.date)} · Receita ${fmt.money(d.revenue)}</title></rect>`;
  }).join("");

  const points = rows.map((d, i) => [margin.left + i * step + step / 2, y(d.spend)]);
  const path = points.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
  const line = `<path class="line" d="${path}"/>` + points.map((p, i) =>
    `<circle class="point" cx="${p[0]}" cy="${p[1]}" r="3"><title>${formatDate(rows[i].date)} · Investimento ${fmt.money(rows[i].spend)}</title></circle>`
  ).join("");
  const labels = rows.map((d, i) => {
    if (rows.length > 18 && i % 2) return "";
    return `<text x="${margin.left + i * step + step / 2}" y="${height - 17}" text-anchor="end" transform="rotate(-38 ${margin.left + i * step + step / 2} ${height - 17})">${formatDate(d.date)}</text>`;
  }).join("");

  host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
    <defs><linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ad2b7e"/><stop offset="1" stop-color="#5c1748"/></linearGradient></defs>
    ${grids}${bars}${line}${labels}
  </svg>`;
}

function renderDaily(rows) {
  $("daily-table").innerHTML = [...rows].reverse().map(row => {
    const m = metricValues(row);
    return `<tr>
      <td><strong>${formatDate(row.date)}</strong></td>
      <td>${fmt.money(row.spend)}</td>
      <td>${fmt.money(m.cpm)}</td>
      <td>${fmt.percent(m.ctr)}</td>
      <td>${fmt.number(row.checkouts)}</td>
      <td>${fmt.number(row.sales)}</td>
      <td>${row.sales ? fmt.money(m.cac) : "—"}</td>
      <td class="positive">${fmt.money(row.revenue)}</td>
      <td class="${m.roas >= 1 ? "positive" : "warning"}">${row.spend ? fmt.roas(row.revenue, row.spend) : "—"}</td>
    </tr>`;
  }).join("");
  requestAnimationFrame(() => renderChart(rows));
}

function nameCell(row, secondary = "") {
  return `<span class="entity-name" title="${escapeHtml(row.name)}">${escapeHtml(row.name || "Sem nome")}</span>
    <span class="entity-id">${escapeHtml(secondary || row.id)}</span>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

function entityRow(row, secondaryName = "") {
  const m = metricValues(row);
  return `<tr>
    <td>${nameCell(row)}</td>
    ${secondaryName ? `<td><span class="entity-name" title="${escapeHtml(secondaryName)}">${escapeHtml(secondaryName)}</span></td>` : ""}
    <td>${fmt.money(row.spend)}</td>
    ${secondaryName ? "" : `<td>${fmt.number(row.impressions)}</td>`}
    <td>${fmt.percent(m.ctr)}</td>
    <td>${fmt.number(row.sales)}</td>
    <td class="positive">${fmt.money(row.revenue)}</td>
    <td>${row.sales ? fmt.money(m.cac) : "—"}</td>
    <td class="${m.roas >= 1 ? "positive" : m.roas ? "warning" : "muted"}">${row.spend ? fmt.roas(row.revenue, row.spend) : "—"}</td>
  </tr>`;
}

function renderEntities(data) {
  const campaigns = data.campaigns.filter(x => x.spend || x.revenue);
  const adsets = data.adsets.filter(x => x.spend || x.revenue);
  const ads = data.ads.filter(x => x.spend || x.revenue);
  setText("campaign-count", `${campaigns.length} campanhas`);
  setText("adset-count", `${adsets.length} conjuntos`);
  setText("ad-count", `${ads.length} anúncios`);
  $("campaign-table").innerHTML = campaigns.map(row => entityRow(row)).join("");
  $("adset-table").innerHTML = adsets.map(row => entityRow(row, row.campaignName)).join("");
  $("ad-table").innerHTML = ads.map(row => entityRow(row, row.adsetName)).join("");
}

function setupNavigation() {
  const links = [...document.querySelectorAll(".nav-link")];
  const sections = links.map(link => document.querySelector(link.getAttribute("href")));
  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    links.forEach(link => link.classList.toggle("active", link.getAttribute("href") === `#${visible.target.id}`));
  }, { rootMargin: "-20% 0px -65% 0px", threshold: [0, .2, .5] });
  sections.forEach(section => observer.observe(section));
}

async function loadData(force = false) {
  const button = $("refresh-button");
  button.disabled = true;
  button.textContent = "…";
  try {
    const response = await fetch(`data.json${force ? `?v=${Date.now()}` : ""}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.data = data;
    renderOverview(data);
    renderDaily(data.daily);
    renderEntities(data);
    if (force) showToast("Dados recarregados.");
  } catch (error) {
    console.error(error);
    showToast("Não foi possível carregar data.json.");
  } finally {
    button.disabled = false;
    button.textContent = "↻";
  }
}

window.addEventListener("resize", () => {
  if (state.data) renderChart(state.data.daily);
});
$("refresh-button").addEventListener("click", () => loadData(true));
setupNavigation();
loadData();

