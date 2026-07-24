const state = {
  data: null,
  viewDaily: [],
  filters: { date: null, campaign: null, adset: null, ad: null }
};

const number = new Intl.NumberFormat("pt-BR");
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const decimal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const safeDiv = (a, b) => b ? a / b : 0;
const $ = id => document.getElementById(id);
const hasFilters = () => Object.values(state.filters).some(Boolean);
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
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "short", timeZone: "UTC"
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
}

function emptyRollup(id = "", name = "") {
  return {
    id, name, spend: 0, impressions: 0, clicks: 0,
    landingPageViews: 0, checkouts: 0, sales: 0, revenue: 0
  };
}

function addMetrics(target, row) {
  target.spend += Number(row.spend || 0);
  target.impressions += Number(row.impressions || 0);
  target.clicks += Number(row.clicks || 0);
  target.landingPageViews += Number(row.landingPageViews || 0);
  target.checkouts += Number(row.checkouts || 0);
  target.sales += Number(row.sales || 0);
  target.revenue += Number(row.revenue || 0);
  return target;
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

function factsMatching(options = {}) {
  const f = state.filters;
  return state.data.facts.filter(row =>
    (options.ignoreDate || !f.date || row.date === f.date) &&
    (options.ignoreCampaign || !f.campaign || row.campaignId === f.campaign) &&
    (options.ignoreAdset || !f.adset || row.adsetId === f.adset) &&
    (options.ignoreAd || !f.ad || row.adId === f.ad)
  );
}

function sumFacts(facts) {
  return facts.reduce((total, row) => addMetrics(total, row), emptyRollup("total", "Total"));
}

function groupFacts(facts, type) {
  const config = {
    date: { id: "date", name: "date" },
    campaign: { id: "campaignId", name: "campaignName" },
    adset: { id: "adsetId", name: "adsetName" },
    ad: { id: "adId", name: "adName" }
  }[type];
  const groups = new Map();

  facts.forEach(fact => {
    const id = fact[config.id];
    if (!id) return;
    if (!groups.has(id)) {
      groups.set(id, {
        ...emptyRollup(id, fact[config.name] || id),
        date: fact.date,
        campaignId: fact.campaignId,
        campaignName: fact.campaignName,
        adsetId: fact.adsetId,
        adsetName: fact.adsetName,
        adId: fact.adId,
        adName: fact.adName
      });
    }
    addMetrics(groups.get(id), fact);
  });

  const rows = [...groups.values()];
  return type === "date"
    ? rows.sort((a, b) => a.id.localeCompare(b.id))
    : rows.sort((a, b) => b.spend - a.spend || b.revenue - a.revenue);
}

function entityName(type, id) {
  if (!id || !state.data) return "";
  const fields = {
    campaign: ["campaigns", "name"],
    adset: ["adsets", "name"],
    ad: ["ads", "name"]
  }[type];
  return state.data[fields[0]].find(row => row.id === id)?.[fields[1]] || id;
}

function renderFilters() {
  const entries = [
    state.filters.date && { key: "date", label: "Dia", value: formatDate(state.filters.date) },
    state.filters.campaign && { key: "campaign", label: "Campanha", value: entityName("campaign", state.filters.campaign) },
    state.filters.adset && { key: "adset", label: "Conjunto", value: entityName("adset", state.filters.adset) },
    state.filters.ad && { key: "ad", label: "Anúncio", value: entityName("ad", state.filters.ad) }
  ].filter(Boolean);

  $("filter-chips").innerHTML = entries.length
    ? entries.map(item => `<span class="filter-chip"><b>${item.label}</b><span title="${escapeHtml(item.value)}">${escapeHtml(item.value)}</span><button type="button" data-remove-filter="${item.key}" aria-label="Remover filtro ${item.label}">×</button></span>`).join("")
    : `<span class="filter-empty">Nenhum filtro ativo</span>`;
  $("clear-filters").disabled = !entries.length;
}

function renderOverview(data, totals) {
  const m = metricValues(totals);
  const period = state.filters.date
    ? formatDate(state.filters.date)
    : `${formatDate(data.metadata.periodStart)} — ${formatDate(data.metadata.periodEnd)}`;
  setText("period-label", period);
  setText("sync-date", new Date(data.metadata.generatedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }));
  setText("coverage-badge", hasFilters() ? "Filtro ativo" : fmt.percent(data.coverage.attributionRate));
  setText("kpi-spend", fmt.money(totals.spend));
  setText("kpi-sales", fmt.number(totals.sales));
  setText("kpi-total-sales", hasFilters() ? "visão filtrada" : `${fmt.number(data.coverage.totalSales)} vendas totais`);
  setText("kpi-revenue", fmt.money(totals.revenue));
  setText("kpi-cac", totals.sales ? fmt.money(m.cac) : "—");
  setText("kpi-ticket", totals.sales ? fmt.money(m.ticket) : "—");
  setText("kpi-roas", totals.spend ? fmt.roas(totals.revenue, totals.spend) : "—");
  setText("metric-impressions", fmt.number(totals.impressions));
  setText("metric-cpm", `${fmt.money(m.cpm)} CPM`);
  setText("metric-clicks", fmt.number(totals.clicks));
  setText("metric-ctr", `${fmt.percent(m.ctr)} CTR`);
  setText("metric-lpv", fmt.number(totals.landingPageViews));
  setText("metric-connect", `${fmt.percent(m.connect)} connect rate`);
  setText("metric-checkouts", fmt.number(totals.checkouts));
  setText("metric-checkout-rate", `${fmt.percent(m.checkoutRate)} avanço`);
  setText("metric-sales", fmt.number(totals.sales));
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
    const opacity = state.filters.date && state.filters.date !== d.id ? .28 : 1;
    return `<rect class="bar" opacity="${opacity}" x="${x}" y="${top}" width="${barW}" height="${margin.top + plotH - top}" rx="3">
      <title>${formatDate(d.id)} · Receita ${fmt.money(d.revenue)}</title></rect>`;
  }).join("");

  const points = rows.map((d, i) => [margin.left + i * step + step / 2, y(d.spend)]);
  const path = points.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
  const line = `<path class="line" d="${path}"/>` + points.map((p, i) =>
    `<circle class="point" cx="${p[0]}" cy="${p[1]}" r="${state.filters.date === rows[i].id ? 5 : 3}"><title>${formatDate(rows[i].id)} · Investimento ${fmt.money(rows[i].spend)}</title></circle>`
  ).join("");
  const labels = rows.map((d, i) => {
    if (rows.length > 18 && i % 2) return "";
    return `<text x="${margin.left + i * step + step / 2}" y="${height - 17}" text-anchor="end" transform="rotate(-38 ${margin.left + i * step + step / 2} ${height - 17})">${formatDate(d.id)}</text>`;
  }).join("");

  host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
    <defs><linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ad2b7e"/><stop offset="1" stop-color="#5c1748"/></linearGradient></defs>
    ${grids}${bars}${line}${labels}
  </svg>`;
}

function renderDaily(rows) {
  $("daily-table").innerHTML = [...rows].reverse().map(row => {
    const m = metricValues(row);
    const selected = state.filters.date === row.id ? "selected" : "";
    return `<tr class="${selected}" data-filter="date" data-id="${row.id}">
      <td><strong>${formatDate(row.id)}</strong></td>
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
  state.viewDaily = rows;
  requestAnimationFrame(() => renderChart(rows));
}

function nameCell(row) {
  return `<span class="entity-name" title="${escapeHtml(row.name)}">${escapeHtml(row.name || "Sem nome")}</span>
    <span class="entity-id">${escapeHtml(row.id)}</span>`;
}

function entityRow(row, type, secondaryName = "") {
  const m = metricValues(row);
  const selected = state.filters[type] === row.id ? "selected" : "";
  const hierarchy = `data-campaign-id="${escapeHtml(row.campaignId || (type === "campaign" ? row.id : ""))}" data-adset-id="${escapeHtml(row.adsetId || (type === "adset" ? row.id : ""))}"`;
  return `<tr class="${selected}" data-filter="${type}" data-id="${escapeHtml(row.id)}" ${hierarchy}>
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

function renderCpaChart(hostId, averageId, rows, type) {
  const eligible = rows.filter(row => row.sales > 0)
    .sort((a, b) => b.spend - a.spend || b.sales - a.sales);
  const totals = eligible.reduce((sum, row) => addMetrics(sum, row), emptyRollup());
  setText(averageId, totals.sales ? `CAC médio ${fmt.money(totals.spend / totals.sales)}` : "Sem aquisições");
  const host = $(hostId);

  if (!eligible.length) {
    host.innerHTML = `<div class="chart-empty">Nenhuma aquisição para os filtros selecionados.</div>`;
    return;
  }

  const maxCac = Math.max(...eligible.map(row => row.spend / row.sales), 1);
  host.innerHTML = eligible.map(row => {
    const cac = row.spend / row.sales;
    const selected = state.filters[type] === row.id ? "selected" : "";
    return `<div class="cpa-row ${selected}" data-filter="${type}" data-id="${escapeHtml(row.id)}"
      data-campaign-id="${escapeHtml(row.campaignId || (type === "campaign" ? row.id : ""))}"
      data-adset-id="${escapeHtml(row.adsetId || (type === "adset" ? row.id : ""))}">
      <span class="cpa-label" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</span>
      <span class="cpa-track"><i class="cpa-bar" style="width:${Math.max(1, cac / maxCac * 100)}%"></i></span>
      <span class="cpa-value">${fmt.money(cac)}</span>
    </div>`;
  }).join("");
}

function renderEntities(campaigns, adsets, ads) {
  setText("campaign-count", `${campaigns.length} campanhas`);
  setText("adset-count", `${adsets.length} conjuntos`);
  setText("ad-count", `${ads.length} anúncios`);
  $("campaign-table").innerHTML = campaigns.map(row => entityRow(row, "campaign")).join("");
  $("adset-table").innerHTML = adsets.map(row => entityRow(row, "adset", row.campaignName)).join("");
  $("ad-table").innerHTML = ads.map(row => entityRow(row, "ad", row.adsetName)).join("");
  renderCpaChart("campaign-cpa-chart", "campaign-cpa-average", campaigns, "campaign");
  renderCpaChart("adset-cpa-chart", "adset-cpa-average", adsets, "adset");
  renderCpaChart("ad-cpa-chart", "ad-cpa-average", ads, "ad");
}

function renderAll() {
  const activeFacts = factsMatching();
  const hierarchyFacts = factsMatching({ ignoreDate: true });
  const daily = groupFacts(hierarchyFacts, "date");
  const campaigns = groupFacts(factsMatching({ ignoreCampaign: true }), "campaign");
  const adsets = groupFacts(factsMatching({ ignoreAdset: true }), "adset");
  const ads = groupFacts(factsMatching({ ignoreAd: true }), "ad");

  renderFilters();
  renderOverview(state.data, sumFacts(activeFacts));
  renderDaily(daily);
  renderEntities(campaigns, adsets, ads);
}

function applyFilter(type, id, element = null) {
  if (type === "date") {
    state.filters.date = state.filters.date === id ? null : id;
  } else if (type === "campaign") {
    const next = state.filters.campaign === id ? null : id;
    state.filters.campaign = next;
    state.filters.adset = null;
    state.filters.ad = null;
  } else if (type === "adset") {
    const next = state.filters.adset === id ? null : id;
    state.filters.campaign = next ? element?.dataset.campaignId || state.filters.campaign : state.filters.campaign;
    state.filters.adset = next;
    state.filters.ad = null;
  } else if (type === "ad") {
    const next = state.filters.ad === id ? null : id;
    if (next) {
      state.filters.campaign = element?.dataset.campaignId || state.filters.campaign;
      state.filters.adset = element?.dataset.adsetId || state.filters.adset;
    }
    state.filters.ad = next;
  }
  renderAll();
}

function removeFilter(type) {
  state.filters[type] = null;
  if (type === "campaign") {
    state.filters.adset = null;
    state.filters.ad = null;
  }
  if (type === "adset") state.filters.ad = null;
  renderAll();
}

function clearFilters() {
  state.filters = { date: null, campaign: null, adset: null, ad: null };
  renderAll();
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
    if (!Array.isArray(data.facts)) throw new Error("Snapshot sem fatos filtráveis.");
    state.data = data;
    renderAll();
    if (!force && window.location.hash) {
      const scrollToHash = () => document.querySelector(window.location.hash)?.scrollIntoView();
      requestAnimationFrame(scrollToHash);
      window.setTimeout(scrollToHash, 180);
    }
    if (force) showToast("Dados recarregados.");
  } catch (error) {
    console.error(error);
    showToast("Não foi possível carregar data.json.");
  } finally {
    button.disabled = false;
    button.textContent = "↻";
  }
}

document.addEventListener("click", event => {
  const remove = event.target.closest("[data-remove-filter]");
  if (remove) {
    removeFilter(remove.dataset.removeFilter);
    return;
  }
  const filter = event.target.closest("[data-filter]");
  if (filter) applyFilter(filter.dataset.filter, filter.dataset.id, filter);
});

window.addEventListener("resize", () => {
  if (state.viewDaily.length) renderChart(state.viewDaily);
});
$("refresh-button").addEventListener("click", () => loadData(true));
$("clear-filters").addEventListener("click", clearFilters);
setupNavigation();
loadData();
