const state = {
  payload: null,
  source: "all",
  query: "",
  sortBy: "density",
  direction: "desc",
  visible: 36,
  topologies: null,
  selected: null,
  detailYaw: -0.68,
  comparisonPair: 0,
  comparisonYaw: -0.68,
  renderMode: "surface",
};

const pageSize = 36;
const accent = { panetta: "#4cc7ff", eth: "#ff913b" };
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
  return { ...extra, mode: state.renderMode, surfaceResolution: resolution };
}

function drawComparisonCanvases() {
  const comparison = comparisonSamples();
  if (!comparison) return;
  const { left, right, topology } = comparison;
  window.TrussGeometry.render(
    document.querySelector("#variant-left-canvas"), left, topology, state.comparisonYaw,
    geometryOptions(52, { highlightEntries: state.comparisonPair === 0 ? right.node_displacements : left.node_displacements, baselineOnly: state.comparisonPair === 0 }),
  );
  window.TrussGeometry.render(
    document.querySelector("#variant-right-canvas"), right, topology, state.comparisonYaw,
    geometryOptions(52, { highlightEntries: right.node_displacements }),
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
    ? `两侧拓扑、杆半径均相同；橙色节点是原附件中已有的位移：${displacementSummary(right)}。这次连续几何变化未改变 32³ 占据，因此 Cₕ、Kₕ 相同。`
    : `两侧拓扑相同，但节点位移和为 32³ 目标密度选出的半径略有差异；左侧移动 ${left.node_displacements.length} 个节点，右侧移动 ${right.node_displacements.length} 个节点。32³ 占据不同，可点开比较完整属性张量。`;
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
  els.gallery.querySelectorAll("canvas[data-id]").forEach((canvas) => {
    const sample = state.payload.samples.find((item) => item.id === canvas.dataset.id);
    if (sample) window.TrussGeometry.render(canvas, sample, state.topologies.get(sample.topology_id), -0.68, geometryOptions(30));
  });
}

function anisotropy(values) {
  const safe = values.map(Math.abs).filter((value) => value > 1e-14);
  return safe.length ? Math.max(...safe) / Math.min(...safe) : 0;
}

function sortValue(sample, key) {
  const mapping = {
    density: sample.density,
    C11: sample.Cdiag[0],
    C44: sample.Cdiag[3],
    Kxx: sample.Kdiag[0],
    anisotropyC: anisotropy(sample.Cdiag.slice(0, 3)),
    anisotropyK: anisotropy(sample.Kdiag),
    id: sample.id,
  };
  return mapping[key];
}

function filteredSamples() {
  const query = state.query.trim().toLowerCase();
  const filtered = state.payload.samples.filter((sample) => {
    const sourceMatch = state.source === "all" || sample.source === state.source;
    const searchMatch = !query || sample.id.toLowerCase().includes(query) || sample.voxelHash.includes(query);
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
  image.setAttribute("aria-label", `${sample.id} 的骨架和杆半径几何`);
  card.querySelector(".card-source").textContent = labels[sample.source];
  card.querySelector(".card-index").textContent = String(position + 1).padStart(3, "0");
  card.querySelector("h3").textContent = sample.id;
  card.querySelector(".density-pill").textContent = formatPercent(sample.density);
  card.querySelector('[data-value="c11"]').textContent = formatValue(sample.Cdiag[0]);
  card.querySelector('[data-value="c44"]').textContent = formatValue(sample.Cdiag[3]);
  card.querySelector('[data-value="kxx"]').textContent = formatValue(sample.Kdiag[0]);
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
  document.querySelectorAll(".variant-switch-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.comparisonPair = Number(button.dataset.variantPair);
      renderComparison();
    });
  });
  document.querySelectorAll(".variant-detail-link").forEach((button) => {
    button.addEventListener("click", () => {
      const comparison = comparisonSamples();
      if (comparison) openDetail(comparison[button.dataset.variantSide]);
    });
  });
  let comparisonDragX = null;
  document.querySelectorAll(".variant-panel canvas").forEach((canvas) => {
    canvas.addEventListener("pointerdown", (event) => {
      comparisonDragX = event.clientX;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (comparisonDragX === null) return;
      state.comparisonYaw += (event.clientX - comparisonDragX) * 0.012;
      comparisonDragX = event.clientX;
      drawComparisonCanvases();
    });
    canvas.addEventListener("pointerup", () => { comparisonDragX = null; });
    canvas.addEventListener("pointercancel", () => { comparisonDragX = null; });
  });
  document.querySelectorAll(".source-tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".source-tab").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      state.source = button.dataset.source;
      state.visible = pageSize;
      render();
    });
  });

  document.querySelectorAll(".render-mode-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.renderMode = button.dataset.renderMode;
      document.querySelectorAll(".render-mode-button").forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      render();
      drawComparisonCanvases();
      if (els.dialog.open && state.selected) {
        window.TrussGeometry.render(document.querySelector("#detail-image"), state.selected, state.topologies.get(state.selected.topology_id), state.detailYaw, geometryOptions(64));
      }
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
    state.direction = state.direction === "desc" ? "asc" : "desc";
    const isDesc = state.direction === "desc";
    els.direction.querySelector("span").textContent = isDesc ? "降序" : "升序";
    els.direction.setAttribute("aria-label", `当前${isDesc ? "降序" : "升序"}，点击切换`);
    render();
  });

  els.loadMore.addEventListener("click", () => {
    state.visible += pageSize;
    render();
  });

  els.gallery.addEventListener("click", (event) => {
    const button = event.target.closest(".card-open");
    if (!button) return;
    const sample = state.payload.samples.find((item) => item.id === button.dataset.id);
    if (sample) openDetail(sample);
  });

  document.querySelector("#dialog-close").addEventListener("click", () => els.dialog.close());
  els.dialog.addEventListener("click", (event) => {
    if (event.target === els.dialog) els.dialog.close();
  });

  const detailCanvas = document.querySelector("#detail-image");
  let dragX = null;
  detailCanvas.addEventListener("pointerdown", (event) => {
    dragX = event.clientX;
    detailCanvas.setPointerCapture(event.pointerId);
  });
  detailCanvas.addEventListener("pointermove", (event) => {
    if (dragX === null || !state.selected) return;
    state.detailYaw += (event.clientX - dragX) * 0.012;
    dragX = event.clientX;
    window.TrussGeometry.render(detailCanvas, state.selected, state.topologies.get(state.selected.topology_id), state.detailYaw, geometryOptions(64));
  });
  detailCanvas.addEventListener("pointerup", () => { dragX = null; });
  detailCanvas.addEventListener("pointercancel", () => { dragX = null; });
  window.addEventListener("resize", () => {
    if (state.payload) drawCardCanvases();
    if (state.payload) drawComparisonCanvases();
    if (state.payload) drawPropertyCharts();
    if (els.dialog.open && state.selected) window.TrussGeometry.render(detailCanvas, state.selected, state.topologies.get(state.selected.topology_id), state.detailYaw, geometryOptions(64));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== els.search && !els.dialog.open) {
      event.preventDefault();
      els.search.focus();
    }
  });
}

async function initialize() {
  bindEvents();
  try {
    const response = await fetch("data/samples.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const compact = await response.json();
    state.topologies = new Map(compact.topologies.map((topology) => [topology.id, topology]));
    state.payload = {
      sampleCount: compact.samples.length,
      uniqueVoxelCount: new Set(compact.samples.map((item) => item.quality.voxel_sha256)).size,
      samples: compact.samples.map(normalizeSample),
    };
    document.querySelector("#stat-samples").textContent = state.payload.sampleCount.toLocaleString("zh-CN");
    document.querySelector("#stat-unique").textContent = state.payload.uniqueVoxelCount.toLocaleString("zh-CN");
    const counts = state.payload.samples.reduce((total, sample) => {
      total[sample.source] += 1;
      return total;
    }, { panetta: 0, eth: 0 });
    document.querySelector("#count-all").textContent = state.payload.sampleCount;
    document.querySelector("#count-panetta").textContent = counts.panetta;
    document.querySelector("#count-eth").textContent = counts.eth;
    els.loading.remove();
    renderComparison();
    render();
    drawPropertyCharts();
  } catch (error) {
    els.loading.innerHTML = `<strong>数据载入失败</strong><span>${error.message}</span>`;
  }
}

initialize();
