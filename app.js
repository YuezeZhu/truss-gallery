const initialView = new URLSearchParams(window.location.search).get("view");
const dataPrefix = document.body.dataset.dataPrefix || "dist/data/";
const topologyShardPromises = new Map();

function normalizeQuaternion([x, y, z, w]) {
  const length = Math.hypot(x, y, z, w) || 1;
  return [x / length, y / length, z / length, w / length];
}

function multiplyQuaternion(a, b) {
  return normalizeQuaternion([
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]);
}

function quaternionFromAxisAngle(axis, angle) {
  const half = angle * 0.5;
  const sine = Math.sin(half);
  return [axis[0] * sine, axis[1] * sine, axis[2] * sine, Math.cos(half)];
}

function initialTopologyRotation() {
  return multiplyQuaternion(
    quaternionFromAxisAngle([1, 0, 0], 0.56),
    quaternionFromAxisAngle([0, 0, 1], -0.68),
  );
}

function arcballVector(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  const x = (2 * (event.clientX - rect.left) - rect.width) / rect.width;
  const y = (rect.height - 2 * (event.clientY - rect.top)) / rect.height;
  const lengthSquared = x * x + y * y;
  if (lengthSquared <= 1) return [x, y, Math.sqrt(1 - lengthSquared)];
  const length = Math.sqrt(lengthSquared) || 1;
  return [x / length, y / length, 0];
}

function quaternionBetweenVectors(from, to) {
  const cross = [
    from[1] * to[2] - from[2] * to[1],
    from[2] * to[0] - from[0] * to[2],
    from[0] * to[1] - from[1] * to[0],
  ];
  const dot = Math.max(-1, Math.min(1, from[0] * to[0] + from[1] * to[1] + from[2] * to[2]));
  if (dot < -0.9999) {
    const axis = Math.abs(from[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
    return quaternionFromAxisAngle(axis, Math.PI);
  }
  return normalizeQuaternion([cross[0], cross[1], cross[2], 1 + dot]);
}

const state = {
  payload: null,
  source: "all",
  query: "",
  sortBy: initialView === "coarse" ? "radius" : "density",
  direction: "asc",
  visible: initialView === "coarse" ? 12 : 36,
  topologies: null,
  topologyPayload: null,
  topologyCounts: null,
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
  topologySortDirection: "asc",
  geometrySortDirection: "asc",
  radiusSortDirection: "asc",
  selectedTopology: null,
  selectedTopologyVariant: 0,
  selectedGeometryKey: null,
  selectedVariantId: null,
  activeGeometryGroups: [],
  selectedTopologyVariantRecord: null,
  topologyYaw: -0.68,
  topologyRotation: initialTopologyRotation(),
  topologyArcballVector: null,
  topologyDragging: false,
  topologyPreview: false,
  showMesh: false,
  showTopology: true,
  topologyCanvasFrame: 0,
  topologyQualityTimer: 0,
  samplesById: new Map(),
  samplesByTopology: new Map(),
  indexRowsById: new Map(),
  fullVariantsByTopology: new Map(),
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
  { left: "eth_000001", right: "eth_000000", leftRole: "Unperturbed baseline", rightRole: "Original perturbed variant" },
  { left: "eth_173823", right: "eth_508593", leftRole: "Original perturbation A", rightRole: "Original perturbation B" },
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
  topologyComplexitySort: document.querySelector("#topology-complexity-sort"),
  topologyDisplacementSort: document.querySelector("#topology-displacement-sort"),
  topologyVfSort: document.querySelector("#topology-vf-sort"),
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
  if (absolute < 1e-7) return "0";
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
  for (const value of [`Shared topology ${topology.id}`, `${topology.nodes.length} octant nodes`, `${topology.edges.length} octant members`, sameVoxel ? "Same 32³ occupancy" : "Different 32³ occupancy", "Source: ETH attachment"]) {
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
      ["Moved nodes", String(sample.node_displacements.length)],
      ["Rod radius", sample.radius.toFixed(5)],
      ["Volume fraction", formatPercent(sample.density)],
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
    ? `Blue nodes show each actual position; both records use the same radius, and the right record moves ${right.node_displacements.length} nodes.`
    : `Blue nodes show each actual position; the left record moves ${left.node_displacements.length} nodes and the right record moves ${right.node_displacements.length}. Radius also changes between records.`;
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
  title.textContent = `${yLabel} vs. volume fraction`;
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
  xLabel.textContent = "Volume fraction vf";
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
      mode: "skeleton", showNodes: true, previewStyle: true, skeletonLineWidth: 1.25,
    });
    requestAnimationFrame(drawNext);
  };
  requestAnimationFrame(drawNext);
}

function topologyDisplayName(topology) {
  if (topology?.display_name) return topology.display_name;
  const topologies = state.topologyPayload?.topologies || [];
  const index = topologies.findIndex((item) => item.id === topology?.id || item.catalog_id === topology?.catalog_id);
  return `Lattice ${String(Math.max(0, index) + 1).padStart(4, "0")}`;
}

function variantDisplayName(topology, variant, index = 0) {
  const geometry = variant?.geometry_name || "G0001";
  const radius = variant?.radius_name || `R${String(index + 1).padStart(4, "0")}`;
  return `${topology.topology_code || topologyDisplayName(topology)} · ${geometry} · ${radius}`;
}

function geometryKey(variant) {
  return JSON.stringify((variant.node_displacements || []).map(([node, dx, dy, dz]) => [
    Number(node), ...[dx, dy, dz].map((value) => Number(Number(value).toFixed(4))),
  ]));
}

function geometryGroups(variants) {
  const groupsByKey = new Map();
  for (const variant of variants) {
    const key = geometryKey(variant);
    if (!groupsByKey.has(key)) groupsByKey.set(key, { key, variants: [] });
    groupsByKey.get(key).variants.push(variant);
  }
  const groups = Array.from(groupsByKey.values()).sort((left, right) => {
    const a = left.variants[0], b = right.variants[0];
    if (a.geometry_index && b.geometry_index) return a.geometry_index - b.geometry_index;
    return Number(a.perturbation_rms_norm || 0) - Number(b.perturbation_rms_norm || 0)
      || Number(a.perturbation_max_norm || 0) - Number(b.perturbation_max_norm || 0)
      || (a.node_displacements?.length || 0) - (b.node_displacements?.length || 0)
      || left.key.localeCompare(right.key);
  });
  groups.forEach((group, geometryIndex) => {
    group.name = group.variants[0].geometry_name || `G${String(geometryIndex + 1).padStart(4, "0")}`;
    group.variants.sort((left, right) =>
      (left.radius_index && right.radius_index ? left.radius_index - right.radius_index : 0)
      || Number(left.density) - Number(right.density) || left.id.localeCompare(right.id));
    group.variants.forEach((variant, radiusIndex) => {
      variant.geometry_name = group.name;
      variant.radius_name ||= `R${String(radiusIndex + 1).padStart(4, "0")}`;
    });
    if (state.radiusSortDirection === "desc") group.variants.reverse();
  });
  if (state.geometrySortDirection === "desc") groups.reverse();
  return groups;
}

function updateHierarchySortButtons() {
  for (const [button, label, direction] of [
    [els.topologyComplexitySort, "Complexity", state.topologySortDirection],
    [els.topologyDisplacementSort, "Displacement", state.geometrySortDirection],
    [els.topologyVfSort, "VF", state.radiusSortDirection],
  ]) {
    button.textContent = `${label} ${direction === "asc" ? "↑" : "↓"}`;
    button.setAttribute("aria-label", `${label}: ${direction === "asc" ? "ascending" : "descending"}. Click to reverse order`);
    button.setAttribute("aria-pressed", String(direction === "desc"));
  }
}

function topologyVariantLabel(variant, topology, index = 0) {
  const moved = variant.node_displacements?.length || 0;
  const maxDisplacement = Number(variant.perturbation_max_norm ?? 0);
  const displacementText = maxDisplacement > 0 ? ` · max |Δ|=${maxDisplacement.toFixed(4)}` : "";
  return `${variant.geometry_name || "G0001"} · ${variant.radius_name || "R0001"} · VF ${(variant.density * 100).toFixed(2)}% · ${moved} moved${displacementText}`;
}

function topologySortKey(topology) {
  return [
    Number.isFinite(Number(topology.complexity_rank)) ? Number(topology.complexity_rank) : Number.MAX_SAFE_INTEGER,
    topology.symmetry_code || "",
    topology.display_name || topology.id || "",
  ];
}

function filteredTopologies() {
  if (!state.topologyPayload) return [];
  const query = state.topologyQuery.trim().toLowerCase();
  const matches = state.topologyPayload.topologies.filter((topology) => {
    const searchText = [
      topology.id, topology.catalog_id, topology.display_name, topology.topology_code,
      topology.construction_symmetry_name, topology.complexity_rank,
    ].filter(Boolean).join(" ").toLowerCase();
    const searchMatch = !query || searchText.includes(query);
    return searchMatch;
  }).sort((left, right) => {
    const a = topologySortKey(left);
    const b = topologySortKey(right);
    return a[0] - b[0] || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]);
  });
  return state.topologySortDirection === "desc" ? matches.reverse() : matches;
}

function drawTopologyCanvases() {
  if (!state.topologyPayload) return;
  els.topologyGrid.querySelectorAll("canvas[data-topology-id]").forEach((canvas) => {
    const topology = state.topologyPayload.topologies.find((item) => item.id === canvas.dataset.topologyId);
    if (topology) {
      window.TrussGeometry.render(canvas, { radius: 0, node_displacements: [] }, topology, -0.68, {
        mode: "skeleton", showNodes: true, previewStyle: true, skeletonLineWidth: 1.25,
      });
    }
  });
}

function topologyCardFor(topology, position) {
  const card = document.querySelector("#topology-card-template").content.firstElementChild.cloneNode(true);
  const counts = state.topologyCounts?.[topology.id] || { variants: 0, geometries: 0 };
  const button = card.querySelector(".topology-card-open");
  const canvas = card.querySelector(".topology-card-image");
  button.dataset.topologyId = topology.id;
  button.setAttribute("aria-label", `Open ${topologyDisplayName(topology)} node-position and radius variants`);
  canvas.dataset.topologyId = topology.id;
  card.style.setProperty("--card-accent", accent[topology.source]);
  card.querySelector(".topology-card-index").textContent = String(topology.complexity_rank ?? position + 1).padStart(5, "0");
  card.querySelector("h3").textContent = topologyDisplayName(topology);
  card.querySelector(".topology-card-variant-pill").textContent = `${counts.geometries} ${counts.geometries === 1 ? "geometry" : "geometries"} · ${counts.variants} ${counts.variants === 1 ? "result" : "results"}`;
  card.querySelector('[data-topology-fact="nodes"]').textContent = `${topology.full_cell_node_count ?? topology.nodes.length} nodes`;
  card.querySelector('[data-topology-fact="edges"]').textContent = `${topology.full_cell_edge_count ?? topology.edges.length} members`;
  const classification = card.querySelector('[data-topology-fact="classification"]');
  if (classification) classification.textContent = `Construction symmetry ${topology.construction_symmetry_name || "—"} · Rank ${topology.complexity_rank || "—"}`;
  return card;
}

function renderTopologies() {
  const topologies = filteredTopologies();
  const shown = topologies.slice(0, state.topologyVisible);
  const fragment = document.createDocumentFragment();
  shown.forEach((topology, index) => fragment.append(topologyCardFor(topology, index)));
  els.topologyGrid.replaceChildren(fragment);
  requestAnimationFrame(drawTopologyCanvases);
  const variants = topologies.reduce((total, topology) => total + (state.topologyCounts?.[topology.id]?.variants || 0), 0);
  els.topologyStats.textContent = `${topologies.length.toLocaleString("en-US")} topology groups · ${variants.toLocaleString("en-US")} variants`;
  els.topologyEmpty.hidden = topologies.length !== 0;
  els.topologyLoadMore.hidden = shown.length >= topologies.length;
  els.topologyLoadMore.textContent = `Load more topologies · ${topologies.length - shown.length} remaining`;
}

function renderTopologyDialog({ sortOnly = false } = {}) {
  const topology = state.selectedTopology;
  if (!topology) return;
  const propertySample = state.selectedFullSample?.topology_id === topology.id
    ? state.selectedFullSample
    : state.samplesByTopology.get(topology.id);
  const browserVariants = state.fullVariantsByTopology.get(topology.catalog_id) || topology.variants || [];
  // Keep the deterministic per-topology V-names stable. A compact reference
  // sample is only used before the full index is loaded, never prepended to a
  // sorted full list.
  const variants = browserVariants.length
    ? browserVariants
    : (propertySample ? [propertySample] : []);
  const groups = geometryGroups(variants);
  state.activeGeometryGroups = groups;
  const selectedGroup = groups.find((group) => group.key === state.selectedGeometryKey)
    || groups.find((group) => group.variants.some((item) => item.id === state.selectedVariantId))
    || groups[0];
  const variant = selectedGroup?.variants.find((item) => item.id === state.selectedVariantId)
    || selectedGroup?.variants[0];
  if (!variant) return;
  const previousVariantId = state.selectedTopologyVariantRecord?.id;
  state.selectedGeometryKey = selectedGroup.key;
  state.selectedVariantId = variant.id;
  state.selectedTopologyVariantRecord = variant;
  const radii = variants.map((item) => item.radius).filter(Number.isFinite);
  const actualMin = radii.length ? Math.min(...radii) : 0;
  const actualMax = radii.length ? Math.max(...radii) : 1;
  const radiusMin = actualMin;
  const radiusMax = actualMax;
  const radiusSpan = Math.max(radiusMax - radiusMin, 1e-9);
  const dialog = els.topologyDialog;
  dialog.style.setProperty("--detail-accent", accent[topology.source]);
  document.querySelector("#topology-dialog-title").textContent = topologyDisplayName(topology);
  const hasNodePerturbations = variants.some((item) => item.node_displacements?.length);
  const graphDescription = `${topology.full_cell_node_count ?? topology.nodes.length} full-cell nodes · ${topology.full_cell_edge_count ?? topology.edges.length} members · construction symmetry ${topology.construction_symmetry_name || "unknown"} · complexity rank ${topology.complexity_rank || "—"}`;
  document.querySelector("#topology-dialog-meta").textContent = hasNodePerturbations
    ? `${graphDescription} · connectivity fixed; node positions and radius vary by record`
    : `${graphDescription} · node positions fixed; variants change radius only`;
  document.querySelector("#topology-dialog-variant-count").textContent = `${groups.length} node ${groups.length === 1 ? "geometry" : "geometries"} · ${variants.length} radius ${variants.length === 1 ? "result" : "results"}`;
  document.querySelector("#topology-selected-variant").textContent = topologyVariantLabel(variant, topology);
  const geometryList = document.querySelector("#topology-geometry-list");
  geometryList.replaceChildren();
  groups.forEach((group, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `topology-variant-button${group.key === selectedGroup.key ? " is-active" : ""}`;
    button.dataset.geometryIndex = String(index);
    const title = document.createElement("strong");
    title.textContent = group.name + (group.key === "[]" ? " · fixed nodes" : " · moved nodes");
    const facts = document.createElement("span");
    const first = group.variants[0];
    facts.textContent = `${first.node_displacements.length} moved · RMS |Δ| ${Number(first.perturbation_rms_norm || 0).toFixed(4)} · ${group.variants.length} radius result${group.variants.length === 1 ? "" : "s"}`;
    button.append(title, facts);
    geometryList.append(button);
  });
  const list = document.querySelector("#topology-variant-list");
  list.replaceChildren();
  selectedGroup.variants.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `topology-variant-button${item.id === variant.id ? " is-active" : ""}`;
    button.dataset.radiusIndex = String(index);
    const title = document.createElement("strong");
    title.textContent = `${item.radius_name} · VF ${(item.density * 100).toFixed(2)}%`;
    const facts = document.createElement("span");
    facts.className = "topology-variant-facts";
    const radiusText = document.createElement("b");
    radiusText.textContent = `r=${item.radius.toFixed(5)}`;
    const detailText = document.createElement("em");
    const propertyNote = state.selectedFullSample?.id === item.id || state.samplesById.has(item.id) || state.indexRowsById.has(item.id) ? " · Cₕ/Kₕ loaded" : "";
    detailText.textContent = propertyNote ? "Elastic + thermal properties available" : "Properties loading";
    facts.append(radiusText, detailText);
    button.append(title, facts);
    list.append(button);
  });
  const info = document.querySelector("#topology-variant-info");
  info.replaceChildren();
  const intro = document.createElement("p");
  intro.textContent = itemDisplacementText(variant);
  info.append(intro);
  if (!sortOnly || previousVariantId !== variant.id) {
    const variantProperties = state.selectedFullSample?.id === variant.id
      ? state.selectedFullSample
      : state.samplesById.get(variant.id) || (state.indexRowsById.has(variant.id) ? normalizeIndexRow(state.indexRowsById.get(variant.id)) : null);
    renderTopologyProperties(variantProperties, variant);
  }
  const canvas = document.querySelector("#topology-detail-canvas");
  canvas.setAttribute("aria-label", `${topologyDisplayName(topology)} skeleton and ${variantDisplayName(topology, variant)}`);
  updateMeshToggle();
  if (!sortOnly || previousVariantId !== variant.id) scheduleTopologyCanvasRender();
}

function updateMeshToggle() {
  const toggle = document.querySelector("#topology-mesh-toggle");
  const topologyToggle = document.querySelector("#topology-topology-toggle");
  if (toggle) {
    toggle.textContent = state.showMesh ? "Hide mesh" : "Show mesh";
    toggle.setAttribute("aria-pressed", String(state.showMesh));
    toggle.classList.toggle("is-active", state.showMesh);
  }
  if (topologyToggle) {
    topologyToggle.textContent = state.showTopology ? "Hide topology" : "Show topology";
    topologyToggle.setAttribute("aria-pressed", String(state.showTopology));
    topologyToggle.classList.toggle("is-active", state.showTopology);
  }
  const label = document.querySelector(".visual-mode-label");
  if (label) {
    label.textContent = state.showMesh
      ? (state.showTopology ? "Mesh + topology" : "Mesh only")
      : (state.showTopology ? "Topology preview" : "Topology hidden");
  }
  document.querySelector("#topology-legend-nodes")?.toggleAttribute("hidden", !state.showTopology);
  document.querySelector("#topology-legend-skeleton")?.toggleAttribute("hidden", !state.showTopology);
}

function renderTopologyCanvas() {
  const topology = state.selectedTopology;
  const variant = state.selectedTopologyVariantRecord;
  const canvas = document.querySelector("#topology-detail-canvas");
  const webglCanvas = document.querySelector("#topology-detail-webgl");
  if (!topology || !variant || !canvas) return;
  const dragging = state.topologyDragging || state.topologyPreview;
  const meshOptions = state.showMesh
    ? {
      mode: "surface",
      rotation: state.topologyRotation,
      // Keep a connected surface while dragging. The former 12³ preview was
      // fast but undersampled thin rods, so the orange interaction preview
      // appeared as broken islands. Caching avoids rebuilding this mesh on
      // each pointer move; only depth sorting is skipped during the drag.
      surfaceResolution: dragging ? 32 : 40,
      maxSurfaceResolution: dragging ? 36 : 64,
      pixelRatio: dragging ? 0.82 : 1.7,
      meshWireframe: !dragging,
      adaptiveResolution: true,
      skipSurfaceSort: dragging,
      fastSurface: dragging,
      surfaceColor: { body: "#f08a24", light: "#fff0bd", shade: "#6b2f08" },
      meshEdgeColor: "#ffe1a0", meshEdgeAlpha: 0.38, meshEdgeWidth: 0.0058,
      overlaySkeleton: true, overlaySkeletonColor: "#4cc7ff", overlaySkeletonWidth: 1.25,
      overlayNodeColor: "#4cc7ff", overlayNodeRadius: 2.5,
    }
    : {
      mode: "skeleton", skeletonLineWidth: 1.55,
    };
  if (state.showMesh && webglCanvas && window.TrussGeometry.renderWebGL) {
    webglCanvas.hidden = false;
    const webglRendered = window.TrussGeometry.renderWebGL(webglCanvas, variant, topology, state.topologyYaw, meshOptions);
    if (webglRendered) {
      // Keep the 2D layer for the blue skeleton and nodes only. WebGL owns the
      // orange surface, so pointer rotation updates a GPU buffer projection
      // instead of repainting every mesh triangle in Canvas 2D.
      window.TrussGeometry.render(canvas, variant, topology, state.topologyYaw, {
        mode: "skeleton", overlayOnly: true, rotation: state.topologyRotation, pixelRatio: dragging ? 0.82 : 1.1,
        showTopology: state.showTopology, showNodes: state.showTopology,
        nodeColor: "#4cc7ff", skeletonLineWidth: 1.55,
        highlightEntries: variant.node_displacements, showDisplacementGuides: false,
      });
      return;
    }
    webglCanvas.hidden = true;
  } else if (webglCanvas) {
    webglCanvas.hidden = true;
  }
  window.TrussGeometry.render(canvas, variant, topology, state.topologyYaw, {
    ...meshOptions, rotation: state.topologyRotation, showTopology: state.showTopology,
    showNodes: state.showTopology, nodeColor: "#4cc7ff", showDisplacementGuides: false,
    nodeRadius: 2.7, highlightNodeRadius: 2.7, highlightEntries: variant.node_displacements,
  });
}

function scheduleTopologyCanvasRender() {
  if (state.topologyCanvasFrame) return;
  state.topologyCanvasFrame = requestAnimationFrame(() => {
    state.topologyCanvasFrame = 0;
    renderTopologyCanvas();
  });
}

function queueTopologyMeshUpgrade(delay = 180) {
  if (state.topologyQualityTimer) window.clearTimeout(state.topologyQualityTimer);
  state.topologyQualityTimer = window.setTimeout(() => {
    state.topologyQualityTimer = 0;
    state.topologyPreview = false;
    if (state.showMesh && !state.topologyDragging) scheduleTopologyCanvasRender();
  }, delay);
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
    source.textContent = "No property record for this variant";
    facts.innerHTML = "<span>No effective-property record is attached to this variant.</span>";
    mechanicalBars.replaceChildren();
    thermalBars.replaceChildren();
    mechanicalMatrix.replaceChildren();
    thermalMatrix.replaceChildren();
    quality.textContent = "Properties appear when a full sample record matches this variant.";
    return;
  }
  source.textContent = sample.id === variant.id ? "Property record for selected variant" : "Reference property record";
  const factItems = [
    ["VF", formatPercent(sample.density)],
    ["Rod radius r", formatValue(sample.radius, 5)],
    ["Mean Young's modulus Ē", formatValue(sample.youngsModulus, 4)],
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
  quality.textContent = `Quality: min eigenvalues C=${formatValue(sample.minC, 5)} · K=${formatValue(sample.minK, 5)}; residuals C=${formatValue(sample.mechanicalResidual, 2)} · K=${formatValue(sample.thermalResidual, 2)}.`;
}

function itemDisplacementText(variant) {
  if (!variant.node_displacements?.length) return "This variant has no additional node displacement; its geometry changes through rod radius.";
  const parts = variant.node_displacements.map(([index, dx, dy, dz]) => {
    const values = [dx, dy, dz].map((value, axis) => Math.abs(value) > 1e-12 ? `${"xyz"[axis]}${value >= 0 ? "+" : ""}${value.toFixed(4)}` : null).filter(Boolean);
    return `N${index} (${values.join(", ")})`;
  });
  return `Node displacements: ${parts.join("; ")}`;
}

async function loadTopologyShard(topology) {
  const shard = state.topologyCounts?.[topology.id]?.shard;
  if (!Number.isInteger(shard)) throw new Error(`No variant shard for ${topology.id}`);
  if (!topologyShardPromises.has(shard)) {
    const promise = (async () => {
      if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot read compressed variant data");
      const response = await fetch(`${dataPrefix}topology_shards/shard_${String(shard).padStart(2, "0")}.json.gz?v=1`);
      if (!response.ok || !response.body) throw new Error(`Variant shard HTTP ${response.status}`);
      const payload = await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).json();
      if (payload.schema !== "topology-shard-v1") throw new Error("Variant shard format mismatch");
      const variantsByTopology = new Map();
      for (const row of payload.rows) {
        const variants = variantsByTopology.get(row.topology_id) || [];
        variants.push(row);
        variantsByTopology.set(row.topology_id, variants);
        state.indexRowsById.set(row.id, row);
      }
      for (const [topologyId, variants] of variantsByTopology) {
        variants.sort((left, right) =>
          Number(left.variant_index || 0) - Number(right.variant_index || 0)
          || Number(left.density) - Number(right.density)
          || left.id.localeCompare(right.id));
        state.fullVariantsByTopology.set(topologyId, variants);
      }
    })();
    topologyShardPromises.set(shard, promise);
    promise.catch(() => topologyShardPromises.delete(shard));
  }
  await topologyShardPromises.get(shard);
}

function openTopology(topology) {
  state.selectedFullSample = null;
  state.selectedTopology = topology;
  state.selectedTopologyVariant = 0;
  state.selectedGeometryKey = null;
  state.selectedVariantId = null;
  state.selectedTopologyVariantRecord = null;
  state.topologyYaw = -0.68;
  state.topologyRotation = initialTopologyRotation();
  state.topologyArcballVector = null;
  state.topologyDragging = false;
  state.topologyPreview = false;
  if (state.topologyQualityTimer) window.clearTimeout(state.topologyQualityTimer);
  state.showMesh = false;
  state.showTopology = true;
  els.topologyDialog.showModal();
  document.querySelector("#topology-dialog-title").textContent = topologyDisplayName(topology);
  document.querySelector("#topology-dialog-meta").textContent = "Loading node geometries, radius results, and effective properties…";
  document.querySelector("#topology-dialog-variant-count").textContent = `${state.topologyCounts?.[topology.id]?.variants || 0} results`;
  document.querySelector("#topology-selected-variant").textContent = "Loading variants…";
  document.querySelector("#topology-geometry-list").replaceChildren();
  document.querySelector("#topology-variant-list").replaceChildren();
  document.querySelector("#topology-variant-info").replaceChildren();
  renderTopologyProperties(null, { id: "" });
  state.selectedTopologyVariantRecord = { radius: 0, node_displacements: [] };
  updateMeshToggle();
  scheduleTopologyCanvasRender();
  loadTopologyShard(topology).then(() => {
    if (state.selectedTopology !== topology || !els.topologyDialog.open) return;
    state.selectedTopologyVariantRecord = null;
    renderTopologyDialog();
  }).catch((error) => {
    if (state.selectedTopology !== topology || !els.topologyDialog.open) return;
    document.querySelector("#topology-selected-variant").textContent = `Variant data failed to load: ${error.message}. Reopen to retry.`;
    console.warn("Topology variant data failed to load", error);
  });
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
  button.setAttribute("aria-label", `Open geometry and properties for ${sample.id}`);
  const image = card.querySelector(".card-image");
  image.dataset.id = sample.id;
  image.setAttribute("aria-label", `${sample.id} blue skeleton and nodes`);
  card.querySelector(".card-source").textContent = sample.dataset === "gap_samples" ? `${labels[sample.source]} · VF gap fill` : labels[sample.source];
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
  els.loadMore.textContent = `Load more records · ${samples.length - shown.length} remaining`;
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
      row.n.toLocaleString("en-US"),
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
    action.textContent = "Open";
    actionCell.append(action);
    tr.append(actionCell);
    tbody.append(tr);
  }
  els.sampleIndexEmpty.hidden = rows.length !== 0;
  els.sampleIndexStats.textContent = `${rows.length.toLocaleString("en-US")} matches · ${state.sampleIndex.counts.samples.toLocaleString("en-US")} primary · ${state.sampleIndex.counts.gap_samples.toLocaleString("en-US")} VF gap fills · ${state.sampleIndexPageSize} / page`;
  els.sampleIndexPageLabel.textContent = `Page ${state.sampleIndexPage.toLocaleString("en-US")} / ${totalPages.toLocaleString("en-US")}`;
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
  state.selectedGeometryKey = null;
  state.selectedVariantId = sample.id;
  state.selectedTopologyVariantRecord = null;
  state.topologyYaw = -0.68;
  state.topologyRotation = initialTopologyRotation();
  state.topologyArcballVector = null;
  state.topologyDragging = false;
  state.topologyPreview = false;
  if (state.topologyQualityTimer) window.clearTimeout(state.topologyQualityTimer);
  state.showMesh = false;
  state.showTopology = true;
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
  image.setAttribute("aria-label", `${sample.id} skeleton and radius geometry; drag to rotate`);
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
  document.querySelector("#detail-mech-iterations").textContent = "Converged";
  document.querySelector("#detail-thermal-iterations").textContent = "Converged";

  const sourceNote = sample.source === "eth"
    ? `Original sample #${sample.sourceSampleIndex.toLocaleString("en-US")} · original node geometry retained · drag to rotate`
    : `Panetta / MeshFEM topology enumeration · drag to rotate`;
  document.querySelector("#detail-source-note").textContent = sourceNote;

  els.dialog.showModal();
  requestAnimationFrame(() => window.TrussGeometry.render(image, sample, state.topologies.get(sample.topology_id), state.detailYaw, geometryOptions(64)));
}

function bindEvents() {
  updateHierarchySortButtons();
  els.topologySearch.addEventListener("input", () => {
    state.topologyQuery = els.topologySearch.value;
    state.topologyVisible = 24;
    renderTopologies();
  });

  els.topologyLoadMore.addEventListener("click", () => {
    state.topologyVisible += 24;
    renderTopologies();
  });

  els.topologyComplexitySort.addEventListener("click", () => {
    state.topologySortDirection = state.topologySortDirection === "asc" ? "desc" : "asc";
    updateHierarchySortButtons();
    renderTopologies();
  });
  els.topologyDisplacementSort.addEventListener("click", () => {
    state.geometrySortDirection = state.geometrySortDirection === "asc" ? "desc" : "asc";
    updateHierarchySortButtons();
    if (state.selectedTopology) renderTopologyDialog({ sortOnly: true });
  });
  els.topologyVfSort.addEventListener("click", () => {
    state.radiusSortDirection = state.radiusSortDirection === "asc" ? "desc" : "asc";
    updateHierarchySortButtons();
    if (state.selectedTopology) renderTopologyDialog({ sortOnly: true });
  });

  els.topologyGrid.addEventListener("click", (event) => {
    const button = event.target.closest(".topology-card-open");
    if (!button || !state.topologyPayload) return;
    const topology = state.topologyPayload.topologies.find((item) => item.id === button.dataset.topologyId);
    if (topology) openTopology(topology);
  });

  document.querySelector("#topology-dialog-close").addEventListener("click", () => els.topologyDialog.close());
  document.querySelector("#topology-mesh-toggle").addEventListener("click", () => {
    state.showMesh = !state.showMesh;
    // First show a very lightweight preview so the control responds quickly;
    // the denser mesh is queued after the browser has painted the preview.
    state.topologyPreview = state.showMesh;
    if (!state.showMesh && state.topologyQualityTimer) {
      window.clearTimeout(state.topologyQualityTimer);
      state.topologyQualityTimer = 0;
      state.topologyPreview = false;
    }
    updateMeshToggle();
    scheduleTopologyCanvasRender();
  });
  document.querySelector("#topology-topology-toggle").addEventListener("click", () => {
    state.showTopology = !state.showTopology;
    updateMeshToggle();
    scheduleTopologyCanvasRender();
  });
  els.topologyDialog.addEventListener("click", (event) => {
    if (event.target === els.topologyDialog) els.topologyDialog.close();
    const geometryButton = event.target.closest("[data-geometry-index]");
    if (geometryButton && state.selectedTopology) {
      const group = state.activeGeometryGroups[Number(geometryButton.dataset.geometryIndex)];
      if (!group) return;
      state.selectedGeometryKey = group.key;
      state.selectedVariantId = group.variants[0]?.id || null;
      renderTopologyDialog();
      return;
    }
    const radiusButton = event.target.closest("[data-radius-index]");
    if (radiusButton && state.selectedTopology) {
      const group = state.activeGeometryGroups.find((item) => item.key === state.selectedGeometryKey);
      const variant = group?.variants[Number(radiusButton.dataset.radiusIndex)];
      if (!variant) return;
      state.selectedVariantId = variant.id;
      renderTopologyDialog();
    }
  });

  const topologyCanvas = document.querySelector("#topology-detail-canvas");
  // Keep the last pointer position in screen pixels.  Using a direct
  // screen-space delta here is more reliable than an arcball-only mapping:
  // a vertical drag must always produce a visible pitch, even when the
  // current view or lattice is symmetric around that axis.
  let topologyDragPoint = null;
  topologyCanvas.addEventListener("pointerdown", (event) => {
    topologyDragPoint = { x: event.clientX, y: event.clientY };
    state.topologyArcballVector = arcballVector(event, topologyCanvas);
    if (state.topologyQualityTimer) window.clearTimeout(state.topologyQualityTimer);
    state.topologyPreview = false;
    state.topologyDragging = true;
    topologyCanvas.setPointerCapture(event.pointerId);
    scheduleTopologyCanvasRender();
  });
  topologyCanvas.addEventListener("pointermove", (event) => {
    if (topologyDragPoint === null || !state.selectedTopology) return;
    const dx = event.clientX - topologyDragPoint.x;
    const dy = event.clientY - topologyDragPoint.y;
    if (dx === 0 && dy === 0) return;
    const canvasRect = topologyCanvas.getBoundingClientRect();
    const scale = 2.35 / Math.max(1, Math.min(canvasRect.width, canvasRect.height));
    // Horizontal motion yaws around the world Y axis; vertical motion pitches
    // around the world X axis.  Combining both quaternions gives unrestricted
    // free rotation without reintroducing the old yaw/pitch lock.
    const yawDelta = quaternionFromAxisAngle([0, 1, 0], dx * scale);
    const pitchDelta = quaternionFromAxisAngle([1, 0, 0], dy * scale);
    const delta = multiplyQuaternion(yawDelta, pitchDelta);
    state.topologyRotation = multiplyQuaternion(delta, state.topologyRotation);
    topologyDragPoint = { x: event.clientX, y: event.clientY };
    state.topologyArcballVector = arcballVector(event, topologyCanvas);
    scheduleTopologyCanvasRender();
  });
  topologyCanvas.addEventListener("pointerup", () => {
    topologyDragPoint = null;
    state.topologyArcballVector = null;
    state.topologyDragging = false;
    if (state.showMesh) queueTopologyMeshUpgrade(260);
    else scheduleTopologyCanvasRender();
  });
  topologyCanvas.addEventListener("pointercancel", () => {
    topologyDragPoint = null;
    state.topologyArcballVector = null;
    state.topologyDragging = false;
    if (state.showMesh) queueTopologyMeshUpgrade(260);
    else scheduleTopologyCanvasRender();
  });

  window.addEventListener("resize", () => {
    if (state.topologyPayload) drawTopologyCanvases();
    if (els.topologyDialog.open && state.selectedTopology) scheduleTopologyCanvasRender();
  });
}

async function initialize() {
  bindEvents();
  try {
    const [catalogResponse, countsResponse] = await Promise.all([
      fetch(`${dataPrefix}catalog.json?v=11`), fetch(`${dataPrefix}topology_counts.json?v=1`),
    ]);
    const failed = [catalogResponse, countsResponse].find((item) => !item.ok);
    if (failed) throw new Error(`HTTP ${failed.status}`);
    const [catalog, counts] = await Promise.all([catalogResponse.json(), countsResponse.json()]);
    if (counts.topology_count !== catalog.topologies.length || counts.variant_count !== 120894) {
      throw new Error("Topology and variant counts do not match the published dataset");
    }
    state.topologyCounts = counts.topologies;
    const topologies = catalog.topologies.map((topology) => ({ ...topology, catalog_id: topology.id, variants: [] }));
    state.topologyPayload = { topologies };
    state.topologies = new Map(topologies.map((topology) => [topology.id, topology]));
    state.catalogById = new Map(catalog.topologies.map((topology) => [topology.id, topology]));
    els.topologyLoading.remove();
    renderTopologies();
  } catch (error) {
    els.topologyLoading.innerHTML = `<strong>Data failed to load</strong><span>${error.message}</span>`;
    console.warn("Topology catalog failed to load", error);
  }
}

initialize();

