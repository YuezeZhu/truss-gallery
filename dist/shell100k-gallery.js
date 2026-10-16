(() => {
  const base = "/shell-data/";
  const state = { catalog: null, topologies: [], shards: new Map(), selected: null, variants: [], geometries: [], geometry: null, displacementDesc: false, variant: null, variantGeometry: null, skeletonRequest: 0, meshRequest: 0, visible: 48, sort: "asc", mesh: null, yaw: -0.7, pitch: 0.45, zoom: 2.1, drag: null };
  const $ = (id) => document.getElementById(id);
  const percent = (value) => `${(Number(value) * 100).toFixed(2)}%`;
  const fmt = (value, digits = 4) => Number(value).toFixed(digits);
  const metric = (value) => {
    const number = Number(value);
    if (value == null || !Number.isFinite(number)) return "—";
    return formatValue(number, 4);
  };

  function project(point, width, height, yaw = state.yaw, pitch = state.pitch) {
    const [x, y, z] = point;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const qx = cy * x + sy * z, qz = -sy * x + cy * z;
    const qy = cp * y - sp * qz, pz = sp * y + cp * qz;
    const perspective = Math.max(0.35, 3.0 - pz);
    const ndcX = qx * state.zoom / perspective;
    const ndcY = qy * state.zoom / perspective;
    return [width * (0.5 + ndcX * 0.5), height * (0.5 - ndcY * 0.5)];
  }

  function drawSkeleton(canvas, topology, yaw = state.yaw, pitch = state.pitch) {
    const width = Math.max(1, Math.floor(canvas.clientWidth * Math.min(devicePixelRatio, 1.5)));
    const height = Math.max(1, Math.floor(canvas.clientHeight * Math.min(devicePixelRatio, 1.5)));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext("2d"); ctx.clearRect(0, 0, width, height);
    const points = topology.points.map((point) => project(point, width, height, yaw, pitch));
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#38b9ee"; ctx.lineWidth = Math.max(1.5, width / 360);
    for (const [a, b] of topology.edges) { const p = points[a], q = points[b]; if (!p || !q) continue; ctx.beginPath(); ctx.moveTo(...p); ctx.lineTo(...q); ctx.stroke(); }
    ctx.fillStyle = "#41baf2"; const radius = Math.max(2.1, width / 200);
    for (const [x, y] of points) { ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); }
  }

  function drawCard(canvas, topology) {
    drawSkeleton(canvas, topology, 0.72, 0.38);
  }

  function parseSkeleton(text) {
    const points = [], edges = [], indices = new Map();
    const lines = text.trim().split(/\r?\n/);
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const pair = [];
      for (const line of [lines[i], lines[i + 1]]) {
        const point = line.split(",").map(Number);
        if (point.length !== 3 || point.some((value) => !Number.isFinite(value))) continue;
        const key = point.map((value) => value.toFixed(12)).join(",");
        if (!indices.has(key)) { indices.set(key, points.length); points.push(point); }
        pair.push(indices.get(key));
      }
      if (pair.length === 2 && pair[0] !== pair[1]) edges.push(pair);
    }
    return { points, edges };
  }

  async function showVariantSkeleton(row) {
    const request = ++state.skeletonRequest;
    const response = await fetch(`/api/shell100k-skeleton?id=${encodeURIComponent(row.id)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const geometry = parseSkeleton(await response.text());
    if (request !== state.skeletonRequest) return;
    state.variantGeometry = geometry;
    drawSkeleton($("shell-100k-skeleton-canvas"), geometry);
  }

  function createCard(topology, index) {
    const article = document.createElement("article"); article.className = "topology-card";
    const button = document.createElement("button"); button.type = "button"; button.className = "topology-card-open";
    const visual = document.createElement("div"); visual.className = "topology-card-visual-wrap";
    const canvas = document.createElement("canvas"); canvas.className = "topology-card-image"; canvas.setAttribute("aria-label", `${topology.name} Shell skeleton`); visual.append(canvas);
    const rank = document.createElement("span"); rank.className = "topology-card-index"; rank.textContent = `S-${String(topology.rank).padStart(4, "0")}`; visual.append(rank);
    const open = document.createElement("span"); open.className = "topology-card-open-label"; open.innerHTML = "Open variants <b>↗</b>"; visual.append(open);
    const body = document.createElement("div"); body.className = "topology-card-body";
    const titleRow = document.createElement("div"); titleRow.className = "topology-card-title-row";
    const title = document.createElement("h3"); title.textContent = topology.name; const pill = document.createElement("span"); pill.className = "topology-card-variant-pill"; pill.textContent = `${topology.variants.toLocaleString()} variants`; titleRow.append(title, pill);
    const facts = document.createElement("div"); facts.className = "topology-card-facts";
    for (const text of [`${topology.nodes} nodes`, `${topology.members} members`, topology.symmetry]) { const span = document.createElement("span"); span.textContent = text; facts.append(span); }
    body.append(titleRow, facts); button.append(visual, body); article.append(button);
    requestAnimationFrame(() => drawCard(canvas, topology));
    button.addEventListener("click", () => openTopology(topology));
    return article;
  }

  async function loadShard(topology) {
    if (!state.shards.has(topology.id)) {
      const response = await fetch(`${base}${topology.variant_shard}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json(); state.shards.set(topology.id, payload.variants || []);
    }
    return state.shards.get(topology.id);
  }

  function renderList() {
    const list = $("shell-100k-variant-list"); list.replaceChildren();
    const variants = state.geometry?.variants || [];
    const page = Number(list.dataset.page || 0); const pageSize = 180;
    const first = page * pageSize;
    const rows = variants.slice(first, first + pageSize);
    for (const row of rows) {
      const button = document.createElement("button"); button.type = "button"; button.className = `topology-variant-button${row.id === state.variant?.id ? " is-active" : ""}`;
      button.innerHTML = `<span>${row.radius_name || row.id}</span><small>VF ${percent(row.vf)} · diameter ${fmt(row.diameter, 5)}</small>`;
      button.addEventListener("click", () => selectVariant(row)); list.append(button);
    }
    const footer = document.createElement("div"); footer.className = "shell-100k-list-footer";
    const pages = Math.max(1, Math.ceil(variants.length / pageSize)); footer.innerHTML = `<span>Showing ${first + 1}–${Math.min(first + rows.length, variants.length)} of ${variants.length.toLocaleString()}</span>`;
    const previous = document.createElement("button"); previous.type = "button"; previous.textContent = "Previous"; previous.disabled = page === 0; previous.addEventListener("click", () => { list.dataset.page = String(page - 1); renderList(); });
    const next = document.createElement("button"); next.type = "button"; next.textContent = "Next"; next.disabled = page >= pages - 1; next.addEventListener("click", () => { list.dataset.page = String(page + 1); renderList(); }); footer.append(previous, next); list.append(footer);
  }

  function organizeGeometries() {
    const groups = new Map();
    for (const row of state.variants) {
      const key = row.geometry_key || JSON.stringify(row.node_displacements || []);
      if (!groups.has(key)) groups.set(key, {key, displacement: row.displacement_norm || 0, variants: []});
      groups.get(key).variants.push(row);
    }
    state.geometries = [...groups.values()].sort((a,b) => a.displacement-b.displacement || a.key.localeCompare(b.key));
    state.geometries.forEach((group, i) => {
      group.name = `G${String(i+1).padStart(4,"0")}`;
      group.variants.sort((a,b) => a.vf-b.vf || a.diameter-b.diameter || a.id.localeCompare(b.id));
      group.variants.forEach((row,j) => { row.geometry_name = group.name; row.radius_name = `R${String(j+1).padStart(4,"0")}`; });
    });
    state.geometry = state.geometries[0];
  }

  function renderGeometries() {
    const list = $("shell-100k-geometry-list"); list.replaceChildren();
    const groups = state.displacementDesc ? [...state.geometries].reverse() : state.geometries;
    for (const group of groups) {
      const button = document.createElement("button"); button.type="button";
      button.className = `topology-variant-button${group === state.geometry ? " is-active" : ""}`;
      button.innerHTML = `<span>${group.name}</span><small>Displacement ${metric(group.displacement)} · ${group.variants.length} results</small>`;
      button.addEventListener("click", () => { state.geometry=group; $("shell-100k-variant-list").dataset.page="0"; renderGeometries(); selectVariant(group.variants[0]); });
      list.append(button);
    }
  }

  function renderFacts() {
    const row = state.variant; if (!row) return;
    $("shell-100k-selected").textContent = `${row.geometry_name} → ${row.radius_name} · VF ${percent(row.vf)}`;
    $("shell-100k-variant-info").textContent = `Diameter ${fmt(row.diameter,6)} · Half-thickness ${fmt(row.thickness,6)} · Joint smoothness ${fmt(row.smoothness,6)} · ${row.id}`;
    $("shell-100k-property-source").textContent = row.properties_status === "ok" ? "Property record for selected variant" : (row.properties_status === "elastic_only" ? "Elastic computed · thermal pending" : "Properties pending");
    $("shell-100k-facts").innerHTML = [["VF",percent(row.vf)], ["Diameter",fmt(row.diameter,5)], ["Mean Young's modulus Ē",metric(row.youngs_modulus)], ["mean diag(K)",metric(row.thermal_diagonal_mean)]]
      .map(([label,value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
    const C = row.C_H_upper?.length === 21 ? unpackUpper(row.C_H_upper,6) : null;
    const K = row.K_H_upper?.length === 6 ? unpackUpper(row.K_H_upper,3) : null;
    $("shell-100k-mechanical-bars").innerHTML = C ? barsMarkup(C.map((r,i)=>r[i]), ["C₁₁","C₂₂","C₃₃","C₄₄","C₅₅","C₆₆"]) : "Pending";
    $("shell-100k-mechanical-matrix").innerHTML = C ? matrixMarkup(C,["xx","yy","zz","xy","yz","zx"]) : "";
    $("shell-100k-thermal-bars").innerHTML = K ? barsMarkup(K.map((r,i)=>r[i]),["Kₓₓ","Kᵧᵧ","Kzz"]) : "Pending";
    $("shell-100k-thermal-matrix").innerHTML = K ? matrixMarkup(K,["x","y","z"]) : "";
    $("shell-100k-property-quality").textContent = `Connectivity: ${row.connectivity} · Boundary: ${(row.boundary_axes || []).join(", ")} · Symmetry: ${row.symmetry} · min eigenvalue C=${metric(row.min_C)} · thermal residual=${metric(row.thermal_residual)}.`;
  }

  async function showMesh() {
    if (!state.variant) return; const canvas = $("shell-100k-mesh-canvas"); canvas.style.display = "block";
    const request = ++state.meshRequest;
    if (state.mesh) { state.mesh.dispose(); state.mesh = null; }
    $("shell-100k-variant-info").textContent = "Generating Shell mesh from the stored skeleton and parameters…";
    const response = await fetch(`/api/shell100k-mesh?id=${encodeURIComponent(state.variant.id)}`);
    if (!response.ok) throw new Error(await response.text());
    const obj = await response.text();
    if (request !== state.meshRequest || $("shell-100k-mesh-toggle").getAttribute("aria-pressed") !== "true") return;
    state.mesh = new window.ShellViewer(canvas, obj, {
      yaw: state.yaw, pitch: state.pitch, zoom: state.zoom,
      onRotate: (yaw, pitch, zoom) => {
        state.yaw = yaw; state.pitch = pitch; state.zoom = zoom;
        if (state.variantGeometry) drawSkeleton($("shell-100k-skeleton-canvas"), state.variantGeometry, yaw, pitch);
      },
    });
    $("shell-100k-variant-info").textContent = "Mesh generated on demand · drag to rotate · scroll to zoom";
  }

  function selectVariant(row) {
    state.variant = row; state.variantGeometry = null; renderList(); renderFacts(); drawSkeleton($("shell-100k-skeleton-canvas"), state.selected, state.yaw, state.pitch);
    showVariantSkeleton(row).catch((error) => { $("shell-100k-variant-info").textContent = `Skeleton failed: ${error.message}`; });
    if ($("shell-100k-mesh-toggle").getAttribute("aria-pressed") === "true") showMesh().catch((error) => { $("shell-100k-variant-info").textContent = `Mesh failed: ${error.message}`; });
  }

  async function openTopology(topology) {
    state.mesh?.dispose(); state.mesh = null; ++state.meshRequest;
    state.selected = topology; state.variants = await loadShard(topology); state.sort = "asc"; state.displacementDesc=false; organizeGeometries(); state.variant = state.geometry?.variants[0]; renderGeometries();
    $("shell-100k-displacement-sort").textContent="Displacement ↑"; $("shell-100k-vf-sort").textContent="VF ↑";
    $("shell-100k-dialog-title").textContent = topology.name; $("shell-100k-dialog-meta").textContent = `${topology.nodes} nodes · ${topology.members} members · ${topology.symmetry} · topology rank ${topology.rank}`; $("shell-100k-dialog-count").textContent = `${topology.variants.toLocaleString()} Shell variants`;
    $("shell-100k-variant-list").dataset.page = "0"; renderList(); renderFacts(); $("shell-100k-topology-toggle").setAttribute("aria-pressed", "true"); $("shell-100k-topology-toggle").textContent = "Hide topology"; $("shell-100k-mesh-toggle").setAttribute("aria-pressed", "false"); $("shell-100k-mesh-toggle").textContent = "Show mesh"; $("shell-100k-skeleton-canvas").style.display = "block"; $("shell-100k-mesh-canvas").style.display = "none";
    $("shell-100k-dialog").showModal(); requestAnimationFrame(() => drawSkeleton($("shell-100k-skeleton-canvas"), topology, state.yaw, state.pitch));
    if (state.variant) showVariantSkeleton(state.variant).catch((error) => { $("shell-100k-variant-info").textContent = `Skeleton failed: ${error.message}`; });
  }

  function renderCatalog() {
    const search = $("shell-100k-search").value.trim().toLowerCase(); const list = state.topologies.filter((topology) => !search || `${topology.name} ${topology.source_id} ${topology.symmetry}`.toLowerCase().includes(search));
    const grid = $("shell-100k-grid"); grid.replaceChildren(...list.slice(0, state.visible).map(createCard));
    const more = $("shell-100k-more"); more.hidden = list.length <= state.visible; more.textContent = `Load more topologies (${Math.min(state.visible, list.length).toLocaleString()} / ${list.length.toLocaleString()})`;
    const duplicateLabel = Number(state.catalog.duplicate_count || 0) > 0
      ? ` · ${Number(state.catalog.duplicate_count).toLocaleString()} duplicates removed`
      : "";
    const vfBins = Array.isArray(state.catalog.vf_bin_counts) ? state.catalog.vf_bin_counts.filter((value) => Number(value) > 0).length : 0;
    const propertyCount = Number(state.catalog.property_count || 0);
    const propertyLabel = propertyCount ? ` · properties ${propertyCount.toLocaleString()}/${state.catalog.count.toLocaleString()}` : "";
    $("shell-100k-stats").textContent = `${state.catalog.count.toLocaleString()} unique variants · ${state.catalog.topology_count.toLocaleString()} topology groups${duplicateLabel} · VF 5–35% · ${vfBins}/10 VF bins populated${propertyLabel}`;
  }

  async function init() {
    try {
      const response = await fetch(`${base}catalog.json`, { cache: "no-store" }); if (!response.ok) throw new Error(`HTTP ${response.status}`); state.catalog = await response.json(); state.topologies = state.catalog.topologies.slice().sort((a, b) => a.rank - b.rank); renderCatalog(); $("shell-100k-loading").hidden = true;
    } catch (error) { $("shell-100k-loading").innerHTML = `<strong>Shell data failed to load</strong><span>${error.message}</span>`; }
  }

  async function updateCompletion() {
    try {
      const response = await fetch(`${base}completion-status.json`, {cache:"no-store"});
      if (!response.ok) return;
      const progress = await response.json();
      const total = Number(progress.unique_count || state.catalog?.count || 0);
      const phaseLabel = ({complete:"Completed", count_complete_vf_gaps_remain:"Count reached; VF gaps remain", needs_generation_adjustment:"Generation needs adjustment", failed:"Stopped with an error"})[progress.phase] || "Generating";
      $("shell-completion-status").textContent = progress.phase === "recomputing_properties"
        ? `Unique records: ${total.toLocaleString()} / 100,000 · Finite-element properties: ${Number(progress.property_completed || 0).toLocaleString()} / ${Number(progress.property_total || total).toLocaleString()} · Filling resumes after the audit`
        : `${phaseLabel} · ${total.toLocaleString()} / 100,000 unique records · ${progress.empty_fine_bins?.length ?? "—"} empty VF intervals (0.1 percentage-point bins)`;
    } catch { /* Keep the last known progress when a refresh is unavailable. */ }
  }

  $("shell-100k-search").addEventListener("input", () => { state.visible = 48; renderCatalog(); });
  $("shell-100k-more").addEventListener("click", () => { state.visible += 48; renderCatalog(); });
  $("shell-100k-sort").addEventListener("click", () => { state.topologies.reverse(); renderCatalog(); const button = $("shell-100k-sort"); button.setAttribute("aria-pressed", button.getAttribute("aria-pressed") !== "true"); button.textContent = button.getAttribute("aria-pressed") === "true" ? "Complexity ↓" : "Complexity ↑"; });
  $("shell-100k-vf-sort").addEventListener("click", (event) => { state.sort = state.sort === "asc" ? "desc" : "asc"; state.geometries.forEach(g=>g.variants.reverse()); event.currentTarget.textContent=state.sort === "asc" ? "VF ↑" : "VF ↓"; event.currentTarget.setAttribute("aria-pressed",String(state.sort==="desc")); renderList(); renderFacts(); });
  $("shell-100k-displacement-sort").addEventListener("click", (event) => { state.displacementDesc=!state.displacementDesc; event.currentTarget.textContent=state.displacementDesc ? "Displacement ↓" : "Displacement ↑"; event.currentTarget.setAttribute("aria-pressed",String(state.displacementDesc)); renderGeometries(); });
  $("shell-100k-dialog").addEventListener("close",()=> { ++state.meshRequest; ++state.skeletonRequest; state.mesh?.dispose(); state.mesh=null; });
  $("shell-100k-close").addEventListener("click", () => $("shell-100k-dialog").close());
  $("shell-100k-topology-toggle").addEventListener("click", (event) => { const visible = event.currentTarget.getAttribute("aria-pressed") !== "true"; event.currentTarget.setAttribute("aria-pressed", String(visible)); event.currentTarget.textContent = visible ? "Hide topology" : "Show topology"; $("shell-100k-skeleton-canvas").style.display = visible ? "block" : "none"; });
  $("shell-100k-mesh-toggle").addEventListener("click", (event) => { const visible = event.currentTarget.getAttribute("aria-pressed") !== "true"; event.currentTarget.setAttribute("aria-pressed", String(visible)); event.currentTarget.textContent = visible ? "Hide mesh" : "Show mesh"; if (visible) showMesh().catch((error) => { $("shell-100k-variant-info").textContent = `Mesh failed: ${error.message}`; }); else { $("shell-100k-mesh-canvas").style.display = "none"; if (state.mesh) { state.mesh.dispose(); state.mesh = null; } } });
  window.addEventListener("resize", () => {
    if (!state.selected) return;
    drawSkeleton($("shell-100k-skeleton-canvas"), state.variantGeometry || state.selected, state.yaw, state.pitch);
    state.mesh?.draw();
  });
  init();
  updateCompletion(); setInterval(updateCompletion, 15000);
})();
