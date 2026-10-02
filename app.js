const initialView = new URLSearchParams(window.location.search).get("view");
const state = {
  payload: null,
  source: "all",
  query: "",
  sortBy: initialView === "coarse" ? "radius" : "density",
  direction: "asc",
  visible: initialView === "coarse" ? 12 : 36,
  topologies: null,
  topologyPayload: null,
  catalogById: new Map(),
  sampleIndex: null,
  sampleIndexSource: "all",
  sampleIndexQuery: "",
  sampleIndexPage: 1,
  sampleIndexPageSize: 50,
  selectedIndexRecord: null,
  selectedFullSample: null,
  topologySource: "all",
  topologyQuery: "",
  topologyVisible: 24,
  selectedTopology: null,
  selectedTopologyVariant: 0,
  topologyYaw: -0.68,
  samplesById: new Map(),
  samplesByTopology: new Map(),
  selected: null,
  detailYaw: -0.68,
  comparisonPair: 0,
  comparisonYaw: -0.68,
  renderMode: "surface",
};

const pageSize = 36;
const accent = { panetta: "#4cc7ff", eth: "#4cc7ff" };
const labels = { panetta: "PANETTA / MESHFEM", eth: "ETH ZÜRICH" };
const comparisonPairs = [
  { left: "eth_000001", right: "eth_000000", leftRole: "未扰动基准", rightRole: "原始扰动变体" },
  { left: "eth_173823", right: "eth_508593", leftRole: "原始扰动 A", rightRole: "原始扰动 B" },
];

const els = {
  gallery: document.querySelector("#gallery"),
  loading: document.querySelector("#loading"),
  empty: document.querySelector("#empty"),
  loadMore: document.querySelector("#load-more"),
  resultCount: document.querySelector("#result-count"),
  search: document.querySelector("#search"),
  sortBy: document.querySelector("#sort-by"),
  direction: document.querySelector("#sort-direction"),
  template: document.querySelector("#card-template"),
  dialog: document.querySelector("#detail-dialog"),
  topologyGrid: document.querySelector("#topology-grid"),
  topologyLoading: document.querySelector("#topology-loading"),
  topologyEmpty: document.querySelector("#topology-empty"),
  topologyLoadMore: document.querySelector("#topology-load-more"),
  topologySearch: document.querySelector("#topology-search"),
  topologyStats: document.querySelector("#topology-browser-stats"),
  topologyDialog: document.querySelector("#topology-dialog"),
  sampleIndexLoading: document.querySelector("#sample-index-loading"),
  sampleIndexTable: document.querySelector("#sample-index-table"),
  sampleIndexSearch: document.querySelector("#sample-index-search"),
  sampleIndexStats: document.querySelector("#sample-index-stats"),
  sampleIndexEmpty: document.querySelector("#sample-index-empty"),
  sampleIndexPageSize: document.querySelector("#sample-index-page-size"),
  sampleIndexPrev: document.querySelector("#sample-index-prev"),
  sampleIndexNext: document.querySelector("#sample-index-next"),
  sampleIndexPageLabel: document.querySelector("#sample-index-page-label"),
  sampleIndexDialog: document.querySelector("#sample-index-dialog"),
};

function formatValue(value, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  if ((absolute > 0 && absolute < 0.001) || absolute >= 1000) return value.toExponential(2);
  return value.toFixed(digits);
}

function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function comparisonSamples() {
  if (!state.payload) return null;
  const pair = comparisonPairs[state.comparisonPair];
  const left = state.payload.samples.find((sample) => sample.id === pair.left);
  const right = state.payload.samples.find((sample) => sample.id === pair.right);
  if (!left || !right || left.topology_id !== right.topology_id) return null;
  return { pair, left, right, topology: state.topologies.get(left.topology_id) };
}

function geometryOptions(resolution, extra = {}) {
  return {
    ...extra,
    mode: state.renderMode,
    surfaceResolution: resolution,
    implicitResolution: resolution >= 64 ? 72 : Math.max(resolution, 56),
  };
}

function drawComparisonCanvases() {
  const comparison = comparisonSamples();
  if (!comparison) return;
  const { left, right, topology } = comparison;
  window.TrussGeometry.render(
    document.querySelector("#variant-left-canvas"), left, topology, state.comparisonYaw,
    geometryOptions(52, { showNodes: true, nodeColor: "#70d5ff", showDisplacementGuides: false, highlightEntries: state.comparisonPair === 0 ? right.node_displacements : left.node_displacements, baselineOnly: state.comparisonPair === 0 }),
  );
  window.TrussGeometry.render(
    document.querySelector("#variant-right-canvas"), right, topology, state.comparisonYaw,
    geometryOptions(52, { showNodes: true, nodeColor: "#70d5ff", showDisplacementGuides: false, highlightEntries: right.node_displacements }),
  );
}

function displacementSummary(sample) {
  return sample.node_displacements.map(([index, dx, dy, dz]) => {
    const components = [dx, dy, dz].map((value, axis) => Math.abs(value) > 1e-12 ? `Δ${"xyz"[axis]}=${value.toFixed(4)}` : null).filter(Boolean);
    return `N${index} ${components.join(" ")}`;
  }).join("；");
}

function renderComparison() {
  const comparison = comparisonSamples();
  if (!comparison) return;
  const { pair, left, right, topology } = comparison;
  document.querySelectorAll(".variant-switch-button").forEach((button) => {
    const active = Number(button.dataset.variantPair) === state.comparisonPair;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const meta = document.querySelector("#variant-meta");
  meta.replaceChildren();
  const sameVoxel = left.quality.voxel_sha256 === right.quality.voxel_sha256;
  for (const value of [`共同连接关系 ${topology.id}`, `${topology.nodes.length} 个正八分体节点`, `${topology.edges.length} 条正八分体连杆`, sameVoxel ? "32³ 占据相同" : "32³ 占据不同", "数据来源：ETH 原附件"]) {
    const item = document.createElement("span");
    item.textContent = value;
    meta.append(item);
  }
  for (const [side, sample, role] of [["left", left, pair.leftRole], ["right", right, pair.rightRole]]) {
    document.querySelector(`#variant-${side}-role`).textContent = role;
    document.querySelector(`#variant-${side}-id`).textContent = sample.id;
    const facts = document.querySelector(`#variant-${side}-facts`);
    facts.replaceChildren();
    for (const [name, value] of [
      ["移动节点", String(sample.node_displacements.length)],
      ["杆半径", sample.radius.toFixed(5)],
      ["相对密度", formatPercent(sample.density)],
      ["C₁₁", formatValue(sample.Cdiag[0], 4)],
      ["Kₓₓ", formatValue(sample.Kdiag[0], 4)],
    ]) {
      const item = document.createElement("span");
      const label = document.createElement("strong");
      label.textContent = `${name} `;
      item.append(label, value);
      facts.append(item);
    }
  }
  document.querySelector("#variant-footnote").textContent = state.comparisonPair === 0
    ? `两侧都用蓝点表示各自的实际节点位置；该对照的杆半径相同，右侧包含 ${right.node_displacements.length} 个实际节点位移。`
    : `两侧都用蓝点表示各自的实际节点位置；左侧有 ${left.node_displacements.length} 个节点位移，右侧有 ${right.node_displacements.length} 个节点位移，杆半径也会随样本变化。`;
  requestAnimationFrame(drawComparisonCanvases);
}

function unpackUpper(values, size) {
  const matrix = Array.from({ length: size }, () => Array(size).fill(0));
  let next = 0;
  for (let row = 0; row < size; row++) for (let col = row; col < size; col++) {
    matrix[row][col] = matrix[col][row] = values[next++];
  }
  return matrix;
}

function invertMatrix(matrix) {
  const size = matrix.length;
  const augmented = matrix.map((row, rowIndex) => [
    ...row,
    ...Array.from({ length: size }, (_, colIndex) => rowIndex === colIndex ? 1 : 0),
  ]);
  for (let col = 0; col < size; col++) {
    let pivot = col;
    for (let row = col + 1; row < size; row++) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) pivot = row;
    }
    if (Math.abs(augmented[pivot][col]) < 1e-18) return null;
    [augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]];
    const divisor = augmented[col][col];
    for (let j = 0; j < size * 2; j++) augmented[col][j] /= divisor;
    for (let row = 0; row < size; row++) {
      if (row === col) continue;
      const factor = augmented[row][col];
      if (Math.abs(factor) < 1e-20) continue;
      for (let j = 0; j < size * 2; j++) augmented[row][j] -= factor * augmented[col][j];
    }
  }
  return augmented.map((row) => row.slice(size));
}

function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function normalizeSample(sample) {
  const C = unpackUpper(sample.C_H_upper, 6);
  const K = unpackUpper(sample.K_H_upper, 3);
  const compliance = invertMatrix(C);
  const directionalYoungs = compliance
    ? [0, 1, 2].map((index) => 1 / Math.max(compliance[index][index], 1e-30))
    : [];
  return {
    ...sample,
    C,
    K,
    Cdiag: C.map((row, index) => row[index]),
    Kdiag: K.map((row, index) => row[index]),
    youngsModulus: average(directionalYoungs),
    thermalDiagonalMean: average(K.map((row, index) => row[index])),
    density: sample.quality.relative_density,
    solidVoxels: sample.quality.solid_voxels,
    voxelHash: sample.quality.voxel_sha256.slice(0, 12),
    minC: sample.quality.minimum_C_eigenvalue,
    minK: sample.quality.minimum_K_eigenvalue,
    mechanicalResidual: sample.quality.mechanical_max_relative_residual,
    thermalResidual: sample.quality.thermal_max_relative_residual,
    sourceSampleIndex: sample.source_index,
  };
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function drawPropertyChart(targetId, samples, valueKey, yLabel, formatter) {
  const svg = document.querySelector(`#${targetId}`);
  if (!svg) return;
  svg.replaceChildren();
  const width = 640;
  const height = 280;
  const margin = { top: 16, right: 16, bottom: 46, left: 62 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const observations = samples.filter((sample) => Number.isFinite(sample.density) && Number.isFinite(sample[valueKey]));
  if (!observations.length) return;
  const xValues = observations.map((sample) => sample.density);
  const yValues = observations.map((sample) => sample[valueKey]);
  const xExtent = [Math.min(...xValues), Math.max(...xValues)];
  const yExtent = [Math.min(...yValues), Math.max(...yValues)];
  const xPad = Math.max((xExtent[1] - xExtent[0]) * 0.05, 0.005);
  const yPad = Math.max((yExtent[1] - yExtent[0]) * 0.08, Math.abs(yExtent[1]) * 0.04, 1e-4);
  const xDomain = [xExtent[0] - xPad, xExtent[1] + xPad];
  const yDomain = [Math.max(0, yExtent[0] - yPad), yExtent[1] + yPad];
  const xScale = (value) => margin.left + (value - xDomain[0]) / (xDomain[1] - xDomain[0]) * plotWidth;
  const yScale = (value) => margin.top + plotHeight - (value - yDomain[0]) / (yDomain[1] - yDomain[0]) * plotHeight;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const title = svgElement("title");
  title.textContent = `${yLabel} 与相对体积分数`;
  svg.append(title);
  const tickCount = 5;
  for (let tick = 0; tick <= tickCount; tick++) {
    const fraction = tick / tickCount;
    const x = margin.left + fraction * plotWidth;
    const y = margin.top + plotHeight - fraction * plotHeight;
    svg.append(svgElement("line", { x1: x, x2: x, y1: margin.top, y2: margin.top + plotHeight, class: "chart-grid-line" }));
    svg.append(svgElement("line", { x1: margin.left, x2: margin.left + plotWidth, y1: y, y2: y, class: "chart-grid-line" }));
    const xTick = svgElement("text", { x, y: margin.top + plotHeight + 19, class: "chart-tick", "text-anchor": "middle" });
    xTick.textContent = `${((xDomain[0] + fraction * (xDomain[1] - xDomain[0])) * 100).toFixed(0)}%`;
    const yTick = svgElement("text", { x: margin.left - 9, y: y + 4, class: "chart-tick", "text-anchor": "end" });
    yTick.textContent = formatter(yDomain[0] + fraction * (yDomain[1] - yDomain[0]));
    svg.append(xTick, yTick);
  }
  svg.append(svgElement("line", { x1: margin.left, x2: margin.left + plotWidth, y1: margin.top + plotHeight, y2: margin.top + plotHeight, class: "chart-axis" }));
  svg.append(svgElement("line", { x1: margin.left, x2: margin.left, y1: margin.top, y2: margin.top + plotHeight, class: "chart-axis" }));
  const xLabel = svgElement("text", { x: margin.left + plotWidth / 2, y: height - 8, class: "chart-axis-title", "text-anchor": "middle" });
  xLabel.textContent = "相对体积分数 vf";
  const yLabelElement = svgElement("text", { x: 15, y: margin.top + plotHeight / 2, class: "chart-axis-title", "text-anchor": "middle", transform: `rotate(-90 15 ${margin.top + plotHeight / 2})` });
  yLabelElement.textContent = yLabel;
  svg.append(xLabel, yLabelElement);

  for (const [source, color] of [["panetta", "var(--cyan)"], ["eth", "var(--orange)"]]) {
    const sourceSamples = observations.filter((sample) => sample.source === source).sort((a, b) => a.density - b.density);
    if (!sourceSamples.length) continue;
    const path = svgElement("path", { class: "chart-line", stroke: color, d: sourceSamples.map((sample, index) => `${index ? "L" : "M"}${xScale(sample.density).toFixed(2)},${yScale(sample[valueKey]).toFixed(2)}`).join(" ") });
    svg.append(path);
    for (const sample of sourceSamples) {
      const point = svgElement("circle", { class: "chart-point", cx: xScale(sample.density), cy: yScale(sample[valueKey]), r: 3.1, fill: color });
      const label = document.createElementNS("http://www.w3.org/2000/svg", "title");
      label.textContent = `${sample.id} · vf ${(sample.density * 100).toFixed(2)}% · ${yLabel} ${formatter(sample[valueKey])}`;
      point.append(label);
      svg.append(point);
    }
  }
}

function drawPropertyCharts() {
  if (!state.payload) return;
  drawPropertyChart("youngs-chart", state.payload.samples, "youngsModulus", "Ē", (value) => formatValue(value, 3));
  drawPropertyChart("thermal-chart", state.payload.samples, "thermalDiagonalMean", "mean diag(K)", (value) => formatValue(value, 3));
}

function drawCardCanvases() {
  const canvases = [...els.gallery.querySelectorAll("canvas[data-id]")];
  let cursor = 0;
  const drawNext = () => {
    const canvas = canvases[cursor++];
    if (!canvas) return;
    if (!canvas.isConnected) {
      requestAnimationFrame(drawNext);
      return;
    }
    const sample = state.payload.samples.find((item) => item.id === canvas.dataset.id);
    if (sample) window.TrussGeometry.render(canvas, sample, state.catalogById.get(sample.topology_id) || state.topologies.get(sample.topology_id), -0.68, {
      // Keep full-gallery previews identical to the topology gallery: blue
      // skeleton and nodes only. The yellow mesh is shown after opening.
      mode: "skeleton", showNodes: true, nodeRadius: 4.4, skeletonLineWidth: 1.45,
    });
    requestAnimationFrame(drawNext);
  };
  requestAnimationFrame(drawNext);
}

function topologyVariantLabel(variant) {
  const moved = variant.node_displacements?.length || 0;
  return `${variant.id} · r=${variant.radius.toFixed(4)} · ${moved} 个点`;
}

function filteredTopologies() {
  if (!state.topologyPayload) return [];
  const query = state.topologyQuery.trim().toLowerCase();
  return state.topologyPayload.topologies.filter((topology) => {
    const sourceMatch = state.topologySource === "all" || topology.source === state.topologySource;
    const searchMatch = !query || topology.id.toLowerCase().includes(query) || topology.catalog_id.toLowerCase().includes(query);
    return sourceMatch && searchMatch;
  });
}

function drawTopologyCanvases() {
  if (!state.topologyPayload) return;
  els.topologyGrid.querySelectorAll("canvas[data-topology-id]").forEach((canvas) => {
    const topology = state.topologyPayload.topologies.find((item) => item.id === canvas.dataset.topologyId);
    const variant = topology?.variants?.[0];
    if (topology && variant) {
      window.TrussGeometry.render(canvas, variant, topology, -0.68, {
        mode: "skeleton", showNodes: true, nodeRadius: 4.4, skeletonLineWidth: 1.45,
      });
    }
  });
}

function topologyCardFor(topology, position) {
  const card = document.querySelector("#topology-card-template").content.firstElementChild.cloneNode(true);
  const variant = topology.variants[0];
  const button = card.querySelector(".topology-card-open");
  const canvas = card.querySelector(".topology-card-image");
  button.dataset.topologyId = topology.id;
  button.setAttribute("aria-label", `查看 ${topology.id} 的节点位置和半径变体`);
  canvas.dataset.topologyId = topology.id;
  card.style.setProperty("--card-accent", accent[topology.source]);
  card.querySelector(".topology-card-source").textContent = labels[topology.source];
  card.querySelector(".topology-card-index").textContent = String(position + 1).padStart(3, "0");
  card.querySelector("h3").textContent = topology.id;
  const hasNodePerturbations = topology.variants.some((item) => item.node_displacements?.length);
  card.querySelector(".topology-card-variant-pill").textContent = hasNodePerturbations
    ? `${topology.variants.length} 个变体`
    : `${topology.variants.length} 个半径变体`;
  card.querySelector('[data-topology-fact="nodes"]').textContent = `${topology.nodes.length} 节点`;
  card.querySelector('[data-topology-fact="edges"]').textContent = `${topology.edges.length} 连杆`;
  card.querySelector('[data-topology-fact="radius"]').textContent = variant ? `r ${variant.radius.toFixed(4)}` : "无样本";
  return card;
}

function renderTopologies() {
  const topologies = filteredTopologies();
  const shown = topologies.slice(0, state.topologyVisible);
  const fragment = document.createDocumentFragment();
  shown.forEach((topology, index) => fragment.append(topologyCardFor(topology, index)));
  els.topologyGrid.replaceChildren(fragment);
  requestAnimationFrame(drawTopologyCanvases);
  const variants = topologies.reduce((total, topology) => total + topology.variants.length, 0);
  els.topologyStats.textContent = `${topologies.length.toLocaleString("zh-CN")} 个拓扑 · ${variants.toLocaleString("zh-CN")} 个变体`;
  els.topologyEmpty.hidden = topologies.length !== 0;
  els.topologyLoadMore.hidden = shown.length >= topologies.length;
  els.topologyLoadMore.textContent = `加载更多拓扑 · ${topologies.length - shown.length} remaining`;
}

function renderTopologyDialog() {
  const topology = state.selectedTopology;
  if (!topology) return;
  const propertySample = state.selectedFullSample?.topology_id === topology.id
    ? state.selectedFullSample
    : state.samplesByTopology.get(topology.id);
  const browserVariants = topology.variants || [];
  const variants = propertySample
    ? [propertySample, ...browserVariants.filter((item) => item.id !== propertySample.id)]
    : browserVariants;
  const variant = variants[state.selectedTopologyVariant] || variants[0];
  if (!variant) return;
  const radii = variants.map((item) => item.radius).filter(Number.isFinite);
  const actualMin = radii.length ? Math.min(...radii) : 0;
  const actualMax = radii.length ? Math.max(...radii) : 1;
  const radiusMin = actualMin;
  const radiusMax = actualMax;
  const radiusSpan = Math.max(radiusMax - radiusMin, 1e-9);
  const dialog = els.topologyDialog;
  dialog.style.setProperty("--detail-accent", accent[topology.source]);
  document.querySelector("#topology-dialog-source").textContent = labels[topology.source];
  document.querySelector("#topology-dialog-title").textContent = topology.id;
  const hasNodePerturbations = variants.some((item) => item.node_displacements?.length);
  document.querySelector("#topology-dialog-meta").textContent = hasNodePerturbations
    ? `${topology.nodes.length} 个节点 · ${topology.edges.length} 条连接 · 连接关系固定，节点位置和半径随样本变化`
    : `${topology.nodes.length} 个节点 · ${topology.edges.length} 条连接 · 节点位置固定，变体只改变杆半径`;
  document.querySelector("#topology-dialog-variant-count").textContent = `${browserVariants.length} 个几何变体 · ${propertySample ? "含 1 条属性记录" : "暂无属性记录"}`;
  document.querySelector("#topology-selected-variant").textContent = topologyVariantLabel(variant);
  const list = document.querySelector("#topology-variant-list");
  list.replaceChildren();
  variants.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `topology-variant-button${index === state.selectedTopologyVariant ? " is-active" : ""}`;
    button.dataset.variantIndex = String(index);
    const title = document.createElement("strong");
    title.textContent = item.id;
    const facts = document.createElement("span");
    facts.className = "topology-variant-facts";
    const radiusText = document.createElement("b");
    radiusText.textContent = `r=${item.radius.toFixed(5)}`;
    const meter = document.createElement("i");
    meter.className = "variant-radius-meter";
    meter.style.setProperty("--radius-level", `${((item.radius - radiusMin) / radiusSpan) * 100}%`);
    const detailText = document.createElement("em");
    const propertyNote = state.selectedFullSample?.id === item.id || state.samplesById.has(item.id) ? " · 有 Cₕ/Kₕ" : "";
    detailText.textContent = `vf ${(item.density * 100).toFixed(2)}% · ${item.node_displacements.length} 个点位移${propertyNote}`;
    facts.append(radiusText, meter, detailText);
    button.append(title, facts);
    list.append(button);
  });
  const info = document.querySelector("#topology-variant-info");
  info.replaceChildren();
  const intro = document.createElement("p");
  intro.textContent = itemDisplacementText(variant);
  info.append(intro);
  const radiusNote = document.createElement("p");
  radiusNote.className = "radius-note";
  radiusNote.textContent = `蓝色是连接骨架，黄色实体网格按实际直径 2r 绘制：当前 r=${variant.radius.toFixed(5)}。`;
  info.append(radiusNote);
  const variantProperties = state.selectedFullSample?.id === variant.id
    ? state.selectedFullSample
    : state.samplesById.get(variant.id);
  renderTopologyProperties(variantProperties, variant);
  const canvas = document.querySelector("#topology-detail-canvas");
  canvas.setAttribute("aria-label", `${topology.id} 的骨架、节点和 ${variant.id} 的扰动位置`);
  requestAnimationFrame(() => window.TrussGeometry.render(canvas, variant, topology, state.topologyYaw, {
    mode: "surface", surfaceResolution: 48, meshWireframe: true, surfaceColor: { body: "#ffd166", light: "#fff1a8", shade: "#936d18" },
    overlaySkeleton: true, overlaySkeletonColor: "#4cc7ff", overlaySkeletonWidth: 1.35, overlayNodeColor: "#4cc7ff", overlayNodeRadius: 2.8,
    showNodes: true, nodeColor: "#4cc7ff", showDisplacementGuides: false, nodeRadius: 2.8, highlightNodeRadius: 2.8,
    highlightEntries: variant.node_displacements,
  }));
}

function renderTopologyProperties(sample, variant) {
  const facts = document.querySelector("#topology-property-facts");
  const mechanicalBars = document.querySelector("#topology-mechanical-bars");
  const thermalBars = document.querySelector("#topology-thermal-bars");
  const mechanicalMatrix = document.querySelector("#topology-mechanical-matrix");
  const thermalMatrix = document.querySelector("#topology-thermal-matrix");
  const quality = document.querySelector("#topology-property-quality");
  const source = document.querySelector("#topology-property-source");
  facts.replaceChildren();
  if (!sample) {
    source.textContent = "该变体暂无属性记录";
    facts.innerHTML = "<span>该变体暂无对应的等效属性记录</span>";
    mechanicalBars.replaceChildren();
    thermalBars.replaceChildren();
    mechanicalMatrix.replaceChildren();
    thermalMatrix.replaceChildren();
    quality.textContent = "属性将在样本记录与拓扑变体编号匹配后显示。";
    return;
  }
  source.textContent = sample.id === variant.id ? `属性记录 ${sample.id}` : `参考记录 ${sample.id}`;
  const factItems = [
    ["VF", formatPercent(sample.density)],
    ["杆半径 r", formatValue(sample.radius, 5)],
    ["平均杨氏模量 Ē", formatValue(sample.youngsModulus, 4)],
    ["mean diag(K)", formatValue(sample.thermalDiagonalMean, 4)],
  ];
  factItems.forEach(([label, value]) => {
    const item = document.createElement("div");
    const title = document.createElement("span");
    title.textContent = label;
    const content = document.createElement("strong");
    content.textContent = value;
    item.append(title, content);
    facts.append(item);
  });
  mechanicalBars.innerHTML = barsMarkup(sample.Cdiag, ["C₁₁", "C₂₂", "C₃₃", "C₄₄", "C₅₅", "C₆₆"]);
  thermalBars.innerHTML = barsMarkup(sample.Kdiag, ["Kₓₓ", "Kᵧᵧ", "Kzz"]);
  mechanicalMatrix.innerHTML = matrixMarkup(sample.C, ["xx", "yy", "zz", "xy", "yz", "zx"]);
  thermalMatrix.innerHTML = matrixMarkup(sample.K, ["x", "y", "z"]);
  quality.textContent = `质量：最小特征值 C=${formatValue(sample.minC, 5)} · K=${formatValue(sample.minK, 5)}；残差 C=${formatValue(sample.mechanicalResidual, 2)} · K=${formatValue(sample.thermalResidual, 2)}。`;
}

function itemDisplacementText(variant) {
  if (!variant.node_displacements?.length) return "该样本没有额外节点位移；模型变化来自该样本的杆半径。";
  const parts = variant.node_displacements.map(([index, dx, dy, dz]) => {
    const values = [dx, dy, dz].map((value, axis) => Math.abs(value) > 1e-12 ? `${"xyz"[axis]}${value >= 0 ? "+" : ""}${value.toFixed(4)}` : null).filter(Boolean);
    return `N${index} (${values.join(", ")})`;
  });
  return `节点位置变化：${parts.join("；")}`;
}

function openTopology(topology) {
  state.selectedFullSample = null;
  state.selectedTopology = topology;
  state.selectedTopologyVariant = 0;
  state.topologyYaw = -0.68;
  els.topologyDialog.showModal();
  renderTopologyDialog();
}

function normalizeIndexRow(row) {
  const quality = row.quality || {};
  return normalizeSample({
    ...row,
    C_H_upper: row.C_H_upper || [],
    K_H_upper: row.K_H_upper || [],
    quality: {
      relative_density: row.density,
      solid_voxels: quality.solid_voxels ?? 0,
      minimum_C_eigenvalue: quality.minimum_C_eigenvalue ?? 0,
      minimum_K_eigenvalue: quality.minimum_K_eigenvalue ?? 0,
      mechanical_max_relative_residual: quality.mechanical_max_relative_residual ?? 0,
      thermal_max_relative_residual: quality.thermal_max_relative_residual ?? 0,
      voxel_sha256: quality.voxel_sha256 || "",
    },
    source_index: row.source_index,
  });
}

function anisotropy(values) {
  const safe = values.map(Math.abs).filter((value) => value > 1e-14);
  return safe.length ? Math.max(...safe) / Math.min(...safe) : 0;
}

function sortValue(sample, key) {
  const mapping = {
    density: sample.density,
    youngs: sample.youngs,
    thermal: sample.thermal,
    radius: sample.radius,
    id: sample.id,
  };
  return mapping[key];
}

function filteredSamples() {
  const query = state.query.trim().toLowerCase();
  const filtered = state.payload.samples.filter((sample) => {
    const sourceMatch = state.source === "all" || sample.source === state.source;
    const searchMatch = !query || sample.id.toLowerCase().includes(query) || sample.topology_id.toLowerCase().includes(query) || String(sample.source_index ?? "").includes(query);
    return sourceMatch && searchMatch;
  });
  const direction = state.direction === "asc" ? 1 : -1;
  return filtered.sort((a, b) => {
    const av = sortValue(a, state.sortBy);
    const bv = sortValue(b, state.sortBy);
    if (typeof av === "string") return av.localeCompare(bv) * direction;
    return (av - bv) * direction || a.id.localeCompare(b.id);
  });
}

function cardFor(sample, position) {
  const card = els.template.content.firstElementChild.cloneNode(true);
  card.style.setProperty("--card-accent", accent[sample.source]);
  const button = card.querySelector(".card-open");
  button.dataset.id = sample.id;
  button.setAttribute("aria-label", `查看 ${sample.id} 的几何与属性`);
  const image = card.querySelector(".card-image");
  image.dataset.id = sample.id;
  image.setAttribute("aria-label", `${sample.id} 的蓝色骨架和节点`);
  card.querySelector(".card-source").textContent = sample.dataset === "gap_samples" ? `${labels[sample.source]} · VF 补齐` : labels[sample.source];
  card.querySelector(".card-index").textContent = String(position + 1).padStart(3, "0");
  card.querySelector("h3").textContent = sample.id;
  card.querySelector(".density-pill").textContent = formatPercent(sample.density);
  card.querySelector('[data-value="youngs"]').textContent = formatValue(sample.youngs, 4);
  card.querySelector('[data-value="thermal"]').textContent = formatValue(sample.thermal, 4);
  card.querySelector('[data-value="radius"]').textContent = formatValue(sample.radius, 5);
  return card;
}

function render() {
  const samples = filteredSamples();
  const shown = samples.slice(0, state.visible);
  const fragment = document.createDocumentFragment();
  shown.forEach((sample, index) => fragment.append(cardFor(sample, index)));
  els.gallery.replaceChildren(fragment);
  requestAnimationFrame(drawCardCanvases);
  els.resultCount.textContent = `${samples.length} / ${state.payload.sampleCount} SAMPLES`;
  els.empty.hidden = samples.length !== 0;
  els.loadMore.hidden = shown.length >= samples.length;
  els.loadMore.textContent = `加载更多结构 · ${samples.length - shown.length} remaining`;
}

function filteredIndexRows() {
  if (!state.sampleIndex) return [];
  const query = state.sampleIndexQuery.trim().toLowerCase();
  return state.sampleIndex.rows.filter((row) => {
    if (state.sampleIndexSource !== "all" && row.source !== state.sampleIndexSource) return false;
    if (!query) return true;
    return [row.id, row.topology_id, row.source_index].some((value) => String(value ?? "").toLowerCase().includes(query));
  });
}

function indexNumber(value, digits = 4) {
  return Number.isFinite(value) ? formatValue(value, digits) : "—";
}

function renderSampleIndex() {
  if (!state.sampleIndex || !els.sampleIndexTable) return;
  const rows = filteredIndexRows();
  const totalPages = Math.max(1, Math.ceil(rows.length / state.sampleIndexPageSize));
  state.sampleIndexPage = Math.min(state.sampleIndexPage, totalPages);
  const start = (state.sampleIndexPage - 1) * state.sampleIndexPageSize;
  const visible = rows.slice(start, start + state.sampleIndexPageSize);
  const tbody = els.sampleIndexTable.querySelector("tbody");
  tbody.replaceChildren();
  for (const row of visible) {
    const tr = document.createElement("tr");
    const values = [
      row.n.toLocaleString("zh-CN"),
      row.id,
      labels[row.source] || row.source,
      row.topology_id,
      formatPercent(row.density),
      indexNumber(row.radius, 5),
      indexNumber(row.youngs, 3),
      indexNumber(row.thermal, 3),
      String(row.node_count ?? row.node_displacements?.length ?? 0),
    ];
    values.forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (index === 1 || index === 3) cell.className = "sample-index-mono";
      tr.append(cell);
    });
    const actionCell = document.createElement("td");
    const action = document.createElement("button");
    action.type = "button";
    action.className = "sample-index-open";
    action.dataset.indexRow = String(row.n);
    action.textContent = "查看";
    actionCell.append(action);
    tr.append(actionCell);
    tbody.append(tr);
  }
  els.sampleIndexEmpty.hidden = rows.length !== 0;
  els.sampleIndexStats.textContent = `${rows.length.toLocaleString("zh-CN")} 条匹配 · 主数据 ${state.sampleIndex.counts.samples.toLocaleString("zh-CN")} · VF 补齐 ${state.sampleIndex.counts.gap_samples.toLocaleString("zh-CN")} · 分页 ${state.sampleIndexPageSize} / 页`;
  els.sampleIndexPageLabel.textContent = `第 ${state.sampleIndexPage.toLocaleString("zh-CN")} / ${totalPages.toLocaleString("zh-CN")} 页`;
  els.sampleIndexPrev.disabled = state.sampleIndexPage <= 1;
  els.sampleIndexNext.disabled = state.sampleIndexPage >= totalPages;
}

function openIndexedSample(row) {
  const topology = state.catalogById.get(row.topology_id);
  if (!topology) return;
  const sample = normalizeIndexRow(row);
  // Full-index records use the exact same detail dialog as topology cards.
  // The catalog supplies the shared skeleton; this row supplies the actual
  // radius, node perturbations, C_H, K_H and quality values.
  state.selectedIndexRecord = row;
  state.selectedFullSample = sample;
  state.selectedTopology = { ...topology, variants: [sample] };
  state.selectedTopologyVariant = 0;
  state.topologyYaw = -0.68;
  els.topologyDialog.showModal();
  renderTopologyDialog();
}

function matrixMarkup(matrix, axisLabels) {
  const headings = axisLabels.map((label) => `<th scope="col">${label}</th>`).join("");
  const rows = matrix.map((row, i) => {
    const cells = row.map((value, j) => `<td class="${i === j ? "diagonal" : ""}">${formatValue(value, 4)}</td>`).join("");
    return `<tr><th scope="row">${axisLabels[i]}</th>${cells}</tr>`;
  }).join("");
  return `<thead><tr><th></th>${headings}</tr></thead><tbody>${rows}</tbody>`;
}

function barsMarkup(values, names) {
  const maximum = Math.max(...values.map(Math.abs), 1e-15);
  return values.map((value, index) => {
    const width = Math.max(2, (Math.abs(value) / maximum) * 100);
    return `<div class="bar-item"><div class="bar-meta"><span>${names[index]}</span><strong>${formatValue(value, 4)}</strong></div><div class="bar-track"><i style="--bar-width:${width}%"></i></div></div>`;
  }).join("");
}

function iterationRange(values) {
  return `${Math.min(...values)}–${Math.max(...values)}`;
}

function openDetail(sample) {
  state.selected = sample;
  state.detailYaw = -0.68;
  els.dialog.style.setProperty("--detail-accent", accent[sample.source]);
  const image = document.querySelector("#detail-image");
  image.setAttribute("aria-label", `${sample.id} 的骨架和杆半径几何，可拖动旋转`);
  const source = document.querySelector("#detail-source");
  source.textContent = labels[sample.source];
  document.querySelector("#detail-title").textContent = sample.id;
  document.querySelector("#detail-hash").textContent = `VOXEL SHA-256 · ${sample.voxelHash}`;
  document.querySelector("#detail-density").textContent = formatPercent(sample.density);
  document.querySelector("#detail-voxels").textContent = sample.solidVoxels.toLocaleString("zh-CN");
  document.querySelector("#detail-min-c").textContent = formatValue(sample.minC, 5);
  document.querySelector("#detail-min-k").textContent = formatValue(sample.minK, 5);
  document.querySelector("#mechanical-bars").innerHTML = barsMarkup(sample.Cdiag, ["C₁₁", "C₂₂", "C₃₃", "C₄₄", "C₅₅", "C₆₆"]);
  document.querySelector("#thermal-bars").innerHTML = barsMarkup(sample.Kdiag, ["Kₓₓ", "Kᵧᵧ", "Kzz"]);
  document.querySelector("#mechanical-matrix").innerHTML = matrixMarkup(sample.C, ["xx", "yy", "zz", "xy", "yz", "zx"]);
  document.querySelector("#thermal-matrix").innerHTML = matrixMarkup(sample.K, ["x", "y", "z"]);
  document.querySelector("#detail-mech-residual").textContent = formatValue(sample.mechanicalResidual, 2);
  document.querySelector("#detail-thermal-residual").textContent = formatValue(sample.thermalResidual, 2);
  document.querySelector("#detail-mech-iterations").textContent = "已收敛";
  document.querySelector("#detail-thermal-iterations").textContent = "已收敛";

  const sourceNote = sample.source === "eth"
    ? `原始样本 #${sample.sourceSampleIndex.toLocaleString("zh-CN")} · 保留原始节点几何扰动 · 可拖动旋转`
    : `Panetta / MeshFEM topology enumeration · 可拖动旋转`;
  document.querySelector("#detail-source-note").textContent = sourceNote;

  els.dialog.showModal();
  requestAnimationFrame(() => window.TrussGeometry.render(image, sample, state.topologies.get(sample.topology_id), state.detailYaw, geometryOptions(64)));
}

function bindEvents() {
  document.querySelectorAll(".source-tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".source-tab").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      state.source = button.dataset.source;
      state.visible = pageSize;
      render();
    });
  });
  els.search.addEventListener("input", () => {
    state.query = els.search.value;
    state.visible = pageSize;
    render();
  });
  els.sortBy.addEventListener("change", () => {
    state.sortBy = els.sortBy.value;
    state.visible = pageSize;
    render();
  });
  els.direction.addEventListener("click", () => {
    state.direction = state.direction === "asc" ? "desc" : "asc";
    els.direction.querySelector("span").textContent = state.direction === "asc" ? "升序" : "降序";
    els.direction.setAttribute("aria-label", `当前${state.direction === "asc" ? "升序" : "降序"}，点击切换`);
    render();
  });
  els.loadMore.addEventListener("click", () => {
    state.visible += pageSize;
    render();
  });
  els.gallery.addEventListener("click", (event) => {
    const button = event.target.closest(".card-open");
    if (!button || !state.payload) return;
    const row = state.payload.samples.find((item) => item.id === button.dataset.id);
    if (row) openIndexedSample(row);
  });

  document.querySelectorAll(".topology-source-tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".topology-source-tab").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      state.topologySource = button.dataset.topologySource;
      state.topologyVisible = 24;
      renderTopologies();
    });
  });

  els.topologySearch.addEventListener("input", () => {
    state.topologyQuery = els.topologySearch.value;
    state.topologyVisible = 24;
    renderTopologies();
  });

  els.topologyLoadMore.addEventListener("click", () => {
    state.topologyVisible += 24;
    renderTopologies();
  });

  document.querySelectorAll(".sample-index-source-tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".sample-index-source-tab").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      state.sampleIndexSource = button.dataset.sampleSource;
      state.sampleIndexPage = 1;
      renderSampleIndex();
    });
  });
  els.sampleIndexSearch.addEventListener("input", () => {
    state.sampleIndexQuery = els.sampleIndexSearch.value;
    state.sampleIndexPage = 1;
    renderSampleIndex();
  });
  els.sampleIndexPageSize.addEventListener("change", () => {
    state.sampleIndexPageSize = Number(els.sampleIndexPageSize.value) || 50;
    state.sampleIndexPage = 1;
    renderSampleIndex();
  });
  els.sampleIndexPrev.addEventListener("click", () => {
    state.sampleIndexPage = Math.max(1, state.sampleIndexPage - 1);
    renderSampleIndex();
  });
  els.sampleIndexNext.addEventListener("click", () => {
    state.sampleIndexPage += 1;
    renderSampleIndex();
  });
  els.sampleIndexTable.addEventListener("click", (event) => {
    const button = event.target.closest(".sample-index-open");
    if (!button || !state.sampleIndex) return;
    const row = state.sampleIndex.rows.find((item) => item.n === Number(button.dataset.indexRow));
    if (row) openIndexedSample(row);
  });
  document.querySelector("#sample-index-dialog-close").addEventListener("click", () => els.sampleIndexDialog.close());
  els.sampleIndexDialog.addEventListener("click", (event) => {
    if (event.target === els.sampleIndexDialog) els.sampleIndexDialog.close();
  });

  els.topologyGrid.addEventListener("click", (event) => {
    const button = event.target.closest(".topology-card-open");
    if (!button || !state.topologyPayload) return;
    const topology = state.topologyPayload.topologies.find((item) => item.id === button.dataset.topologyId);
    if (topology) openTopology(topology);
  });

  document.querySelector("#topology-dialog-close").addEventListener("click", () => els.topologyDialog.close());
  els.topologyDialog.addEventListener("click", (event) => {
    if (event.target === els.topologyDialog) els.topologyDialog.close();
    const button = event.target.closest(".topology-variant-button");
    if (!button || !state.selectedTopology) return;
    state.selectedTopologyVariant = Number(button.dataset.variantIndex);
    renderTopologyDialog();
  });

  const topologyCanvas = document.querySelector("#topology-detail-canvas");
  let topologyDragX = null;
  topologyCanvas.addEventListener("pointerdown", (event) => {
    topologyDragX = event.clientX;
    topologyCanvas.setPointerCapture(event.pointerId);
  });
  topologyCanvas.addEventListener("pointermove", (event) => {
    if (topologyDragX === null || !state.selectedTopology) return;
    state.topologyYaw += (event.clientX - topologyDragX) * 0.012;
    topologyDragX = event.clientX;
    renderTopologyDialog();
  });
  topologyCanvas.addEventListener("pointerup", () => { topologyDragX = null; });
  topologyCanvas.addEventListener("pointercancel", () => { topologyDragX = null; });

  window.addEventListener("resize", () => {
    if (state.topologyPayload) drawTopologyCanvases();
    if (els.topologyDialog.open && state.selectedTopology) renderTopologyDialog();
  });
}

async function initialize() {
  bindEvents();
  try {
    const [response, topologyResponse, catalogResponse] = await Promise.all([
      fetch("samples.json"), fetch("topology_browser.json"), fetch("catalog.json"),
    ]);
    const failed = [response, topologyResponse, catalogResponse].find((item) => !item.ok);
    if (failed) throw new Error(`HTTP ${failed.status}`);
    const [compact, topologyPayload, catalog] = await Promise.all([response.json(), topologyResponse.json(), catalogResponse.json()]);
    state.topologies = new Map(compact.topologies.map((topology) => [topology.id, topology]));
    state.topologyPayload = topologyPayload;
    state.catalogById = new Map(catalog.topologies.map((topology) => [topology.id, topology]));
    // The compact records retain full C_H/K_H tensors for the topology detail
    // panel. The full gallery uses the lightweight 120,894-row index.
    state.samplesById = new Map(compact.samples.map((sample) => [sample.id, normalizeSample(sample)]));
    state.samplesByTopology = new Map();
    for (const sample of state.samplesById.values()) {
      if (!state.samplesByTopology.has(sample.topology_id)) state.samplesByTopology.set(sample.topology_id, sample);
    }
    els.topologyLoading.remove();
    renderTopologies();
    // The compact topology view becomes interactive immediately. The 100k-row
    // index is intentionally fetched afterwards so the first paint is not
    // blocked by parsing a large metadata payload.
    try {
      if (typeof DecompressionStream === "undefined") throw new Error("当前浏览器不支持压缩索引加载");
      const loadIndexPart = async (partNumber) => {
        const indexResponse = await fetch(`sample_index_${partNumber}.json.gz?v=3`);
        if (!indexResponse.ok || !indexResponse.body) throw new Error(`索引分片 ${partNumber} HTTP ${indexResponse.status}`);
        const decompressed = indexResponse.body.pipeThrough(new DecompressionStream("gzip"));
        return new Response(decompressed).json();
      };
      const parts = await Promise.all([1, 2, 3, 4].map(loadIndexPart));
      state.sampleIndex = { ...parts[0], rows: parts.flatMap((part) => part.rows) };
      state.payload = {
        sampleCount: state.sampleIndex.counts.all,
        uniqueVoxelCount: 0,
        samples: state.sampleIndex.rows,
      };
      els.sampleIndexLoading.remove();
      els.loading.remove();
      render();
      renderSampleIndex();
    } catch (indexError) {
      els.sampleIndexLoading.innerHTML = `<strong>全量索引载入失败</strong><span>${indexError.message}</span>`;
    }
  } catch (error) {
    els.topologyLoading.innerHTML = `<strong>数据载入失败</strong><span>${error.message}</span>`;
    if (els.sampleIndexLoading) els.sampleIndexLoading.innerHTML = `<strong>全量索引载入失败</strong><span>${error.message}</span>`;
  }
}

initialize();
