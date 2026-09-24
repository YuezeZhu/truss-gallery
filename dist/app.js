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
};

const pageSize = 36;
const accent = { panetta: "#4cc7ff", eth: "#ff913b" };
const labels = { panetta: "PANETTA / MESHFEM", eth: "ETH ZÜRICH" };

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

function unpackUpper(values, size) {
  const matrix = Array.from({ length: size }, () => Array(size).fill(0));
  let next = 0;
  for (let row = 0; row < size; row++) for (let col = row; col < size; col++) {
    matrix[row][col] = matrix[col][row] = values[next++];
  }
  return matrix;
}

function normalizeSample(sample) {
  const C = unpackUpper(sample.C_H_upper, 6);
  const K = unpackUpper(sample.K_H_upper, 3);
  return {
    ...sample,
    C,
    K,
    Cdiag: C.map((row, index) => row[index]),
    Kdiag: K.map((row, index) => row[index]),
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

function drawCardCanvases() {
  els.gallery.querySelectorAll("canvas[data-id]").forEach((canvas) => {
    const sample = state.payload.samples.find((item) => item.id === canvas.dataset.id);
    if (sample) window.TrussGeometry.render(canvas, sample, state.topologies.get(sample.topology_id));
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
  requestAnimationFrame(() => window.TrussGeometry.render(image, sample, state.topologies.get(sample.topology_id), state.detailYaw));
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
    window.TrussGeometry.render(detailCanvas, state.selected, state.topologies.get(state.selected.topology_id), state.detailYaw);
  });
  detailCanvas.addEventListener("pointerup", () => { dragX = null; });
  detailCanvas.addEventListener("pointercancel", () => { dragX = null; });
  window.addEventListener("resize", () => {
    if (state.payload) drawCardCanvases();
    if (els.dialog.open && state.selected) window.TrussGeometry.render(detailCanvas, state.selected, state.topologies.get(state.selected.topology_id), state.detailYaw);
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
    render();
  } catch (error) {
    els.loading.innerHTML = `<strong>数据载入失败</strong><span>${error.message}</span>`;
  }
}

initialize();
