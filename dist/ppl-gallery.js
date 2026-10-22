(() => {
  const base = "ppl-data/";
  const state = {
    catalog: null,
    topologies: [],
    shards: new Map(),
    selected: null,
    variants: [],
    orientation: null,
    variant: null,
    sortTopology: "asc",
    sortOrientation: "asc",
    sortVariant: "asc",
    visible: 48,
    yaw: -0.68,
    pitch: 0.42,
    zoom: 2.05,
    meshZoom: 0.165,
    mesh: null,
    skeletonRequest: 0,
    meshRequest: 0,
  };
  const $ = (id) => document.getElementById(id);
  const percent = (value) => Number.isFinite(Number(value)) ? `${(100 * Number(value)).toFixed(2)}%` : "—";
  const fmt = (value, digits = 4) => {
    if (value == null || value === "") return "—";
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    if (Math.abs(number) < 1e-7) return "0";
    if (Math.abs(number) > 0 && Math.abs(number) < 1e-3) return number.toExponential(2);
    return number.toFixed(digits);
  };

  function project(point, width, height) {
    const [x, y, z] = point;
    const cy = Math.cos(state.yaw), sy = Math.sin(state.yaw);
    const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
    const qx = cy * x + sy * z, qz = -sy * x + cy * z;
    const qy = cp * y - sp * qz, pz = sp * y + cp * qz;
    const depth = Math.max(0.3, 3 - pz);
    return [width * (0.5 + qx * state.zoom / depth * 0.5),
      height * (0.5 - qy * state.zoom / depth * 0.5)];
  }

  function drawSkeleton(canvas, topology, yaw = state.yaw, pitch = state.pitch) {
    if (!canvas || !topology) return;
    const previous = [state.yaw, state.pitch];
    state.yaw = yaw;
    state.pitch = pitch;
    const width = Math.max(1, Math.floor(canvas.clientWidth * Math.min(devicePixelRatio, 1.4)));
    const height = Math.max(1, Math.floor(canvas.clientHeight * Math.min(devicePixelRatio, 1.4)));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    const points = topology.points.map((point) => project(point, width, height));
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#38b9ee";
    ctx.lineWidth = Math.max(1.2, width / 440);
    for (const [a, b] of topology.edges) {
      const p = points[a], q = points[b];
      if (!p || !q) continue;
      ctx.beginPath();
      ctx.moveTo(...p);
      ctx.lineTo(...q);
      ctx.stroke();
    }
    ctx.fillStyle = "#41baf2";
    const nodeRadius = Math.max(2.2, width / 190);
    for (const [x, y] of points) {
      ctx.beginPath();
      ctx.arc(x, y, nodeRadius, 0, Math.PI * 2);
      ctx.fill();
    }
    [state.yaw, state.pitch] = previous;
  }

  function drawCard(canvas, topology) {
    drawSkeleton(canvas, topology, 0.72, 0.38);
  }

  function createCard(topology) {
    const article = document.createElement("article");
    article.className = "topology-card";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "topology-card-open";
    button.setAttribute("aria-label", `Open PPL variants for ${topology.name}`);
    const visual = document.createElement("div");
    visual.className = "topology-card-visual-wrap";
    const canvas = document.createElement("canvas");
    canvas.className = "topology-card-image";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${topology.name} blue skeleton`);
    visual.append(canvas);
    const index = document.createElement("span");
    index.className = "topology-card-index";
    index.textContent = `P-${String(topology.rank).padStart(4, "0")}`;
    visual.append(index);
    const open = document.createElement("span");
    open.className = "topology-card-open-label";
    open.innerHTML = "Open variants <b>↗</b>";
    visual.append(open);
    const body = document.createElement("div");
    body.className = "topology-card-body";
    const titleRow = document.createElement("div");
    titleRow.className = "topology-card-title-row";
    const title = document.createElement("h3");
    title.textContent = topology.name;
    const pill = document.createElement("span");
    pill.className = "topology-card-variant-pill";
    pill.textContent = `${Number(topology.variants).toLocaleString()} variants`;
    titleRow.append(title, pill);
    const facts = document.createElement("div");
    facts.className = "topology-card-facts";
    for (const text of [
      `${topology.nodes} nodes`,
      `${topology.members} members`,
      topology.symmetry,
    ]) {
      const span = document.createElement("span");
      span.textContent = text;
      facts.append(span);
    }
    body.append(titleRow, facts);
    button.append(visual, body);
    article.append(button);
    requestAnimationFrame(() => drawCard(canvas, topology));
    button.addEventListener("click", () => openTopology(topology));
    return article;
  }

  function renderCatalog() {
    const search = $("ppl-search").value.trim().toLowerCase();
    let rows = state.topologies.filter((topology) =>
      !search || `${topology.name} ${topology.source_id} ${topology.symmetry}`.toLowerCase().includes(search));
    if (state.sortTopology === "desc") rows = [...rows].reverse();
    const grid = $("ppl-grid");
    grid.replaceChildren(...rows.slice(0, state.visible).map(createCard));
    const more = $("ppl-more");
    more.hidden = rows.length <= state.visible;
    more.textContent = `Load more topologies (${Math.min(rows.length, state.visible).toLocaleString()} / ${rows.length.toLocaleString()})`;
    const vfBins = state.catalog.vf_bin_counts.filter((value) => value > 0).length;
    const complete = Number(state.catalog.count || 0);
    $("ppl-stats").textContent = `${complete.toLocaleString()} validated unique variants · ${rows.length.toLocaleString()} topologies · VF 5–35% · ${vfBins}/10 VF bins. Validated snapshot. Generation and property checks continue.`;
    $("ppl-empty").hidden = rows.length !== 0;
  }

  async function loadShard(topology) {
    if (!state.shards.has(topology.id)) {
      const response = await fetch(`${base}${topology.variant_shard}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.shards.set(topology.id, (await response.json()).variants);
    }
    return state.shards.get(topology.id);
  }

  async function loadGeometries() {
    if (state.geometriesLoaded) return;
    const response = await fetch(`${base}topology-geometries.json`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Topology geometry HTTP ${response.status}`);
    const payload = await response.json();
    const geometries = new Map(payload.topologies.map((row) => [row.id, row]));
    for (const topology of state.topologies) {
      const geometry = geometries.get(topology.id);
      if (geometry) {
        topology.points = geometry.points;
        topology.edges = geometry.edges;
      }
    }
    state.geometriesLoaded = true;
  }

  function organize() {
    const groups = [];
    const map = new Map();
    for (const row of state.variants) {
      if (!map.has(row.orientation_key)) {
        const group = {
          key: row.orientation_key,
          name: `O${String(groups.length + 1).padStart(4, "0")}`,
          start: row.orientation.start,
          alpha: Number(row.orientation.alpha),
          beta: Number(row.orientation.beta),
          variants: [],
        };
        map.set(row.orientation_key, group);
        groups.push(group);
      }
      map.get(row.orientation_key).variants.push(row);
    }
    groups.sort((left, right) =>
      left.start.localeCompare(right.start) ||
      left.alpha - right.alpha ||
      left.beta - right.beta);
    for (const group of groups) {
      group.variants.sort((left, right) =>
        left.vf - right.vf || left.thickness - right.thickness || left.id.localeCompare(right.id));
      group.variants.forEach((row, index) => {
        row.orientation_name = group.name;
        row.thickness_name = `T${String(index + 1).padStart(4, "0")}`;
      });
    }
    if (state.sortOrientation === "desc") groups.reverse();
    state.orientations = groups;
    state.orientation = groups.find((group) => group.key === state.orientation?.key) || groups[0] || null;
  }

  function renderOrientations() {
    const list = $("ppl-orientation-list");
    list.replaceChildren();
    for (const group of state.orientations) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `topology-variant-button${group === state.orientation ? " is-active" : ""}`;
      const title = document.createElement("strong");
      title.textContent = `${group.name} · ${group.start}`;
      const detail = document.createElement("span");
      detail.textContent = `α ${group.alpha.toFixed(3)} · β ${group.beta.toFixed(3)} · ${group.variants.length} thickness results`;
      button.append(title, detail);
      button.addEventListener("click", () => {
        state.orientation = group;
        renderOrientations();
        renderVariants();
        selectVariant(group.variants[0]);
      });
      list.append(button);
    }
  }

  function renderVariants() {
    const list = $("ppl-variant-list");
    list.replaceChildren();
    const rows = state.orientation?.variants || [];
    const ordered = state.sortVariant === "asc" ? rows : [...rows].reverse();
    for (const row of ordered) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `topology-variant-button${row.id === state.variant?.id ? " is-active" : ""}`;
      const title = document.createElement("strong");
      title.textContent = `${row.thickness_name} · VF ${percent(row.vf)}`;
      const detail = document.createElement("span");
      detail.textContent = `plate thickness t=${fmt(row.thickness, 5)} · ${row.id}`;
      button.append(title, detail);
      button.addEventListener("click", () => selectVariant(row));
      list.append(button);
    }
    const info = $("ppl-variant-info");
    info.replaceChildren();
    if (!state.variant) return;
    const intro = document.createElement("p");
    intro.textContent = `${state.variant.id} · ${state.variant.orientation_name || ""} · node positions and connections are fixed; this variant changes plate thickness to reach the target VF.`;
    info.append(intro);
  }

  function matrixFromUpper(values, size) {
    if (!Array.isArray(values) || values.length !== size * (size + 1) / 2) return null;
    const matrix = Array.from({ length: size }, () => Array(size).fill(0));
    let offset = 0;
    for (let row = 0; row < size; row++) {
      for (let column = row; column < size; column++) {
        matrix[row][column] = matrix[column][row] = Number(values[offset++]);
      }
    }
    return matrix;
  }

  function bars(values, labels) {
    if (!Array.isArray(values) || !values.length) return "Pending";
    const maximum = Math.max(...values.map((value) => Math.abs(Number(value))), 1e-12);
    return values.map((value, index) => {
      const wide = Math.max(0, Math.min(100, 100 * Math.abs(Number(value)) / maximum));
      return `<div class="bar-item"><div class="bar-meta"><span>${labels[index] || index + 1}</span><strong>${fmt(value, 4)}</strong></div><div class="bar-track"><i style="--bar-width:${wide}%"></i></div></div>`;
    }).join("");
  }

  function matrixTable(matrix, labels) {
    if (!matrix) return "";
    return `<thead><tr><th></th>${labels.map((label) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${matrix.map((row, index) => `<tr><th>${labels[index]}</th>${row.map((value) => `<td>${fmt(value, 4)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  }

  function renderProperties() {
    const row = state.variant;
    if (!row) return;
    const facts = $("ppl-facts");
    facts.innerHTML = [
      ["VF", percent(row.vf)],
      ["Plate thickness", fmt(row.thickness, 6)],
      ["Mean Young's modulus Ē", fmt(row.youngs_modulus)],
      ["Mean diagonal conductivity", fmt(row.thermal_diagonal_mean)],
    ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
    const C = matrixFromUpper(row.C_H_upper, 6);
    const K = matrixFromUpper(row.K_H_upper, 3);
    $("ppl-mechanical-bars").innerHTML = bars(C?.map((line, index) => line[index]), ["C₁₁", "C₂₂", "C₃₃", "C₄₄", "C₅₅", "C₆₆"]);
    $("ppl-mechanical-matrix").innerHTML = matrixTable(C, ["xx", "yy", "zz", "xy", "yz", "zx"]);
    $("ppl-thermal-bars").innerHTML = bars(K?.map((line, index) => line[index]), ["Kₓₓ", "Kᵧᵧ", "K_zz"]);
    $("ppl-thermal-matrix").innerHTML = matrixTable(K, ["x", "y", "z"]);
    $("ppl-property-source").textContent = row.properties_status === "ok"
      ? "Property record for selected variant"
      : "Properties pending for this generation batch";
    $("ppl-quality").textContent = row.properties_status === "ok"
      ? `Connectivity: ${row.solid_components ?? "—"} solid component(s) · boundary: ${Object.entries(row.boundary_faces || {}).filter(([, value]) => value > 0).map(([name]) => name).join(", ") || "—"} · min C eigenvalue ${fmt(row.min_C)} · min K eigenvalue ${fmt(row.min_K)} · residual C ${fmt(row.mechanical_residual)} / K ${fmt(row.thermal_residual)}.`
      : "Geometry is available now. C_H, K_H and the two VF plots are added after the accepted records pass the 32³ VTK audit.";
  }

  function selectVariant(row) {
    state.variant = row;
    renderVariants();
    renderProperties();
    drawSkeleton($("ppl-skeleton-canvas"), state.selected, state.yaw, state.pitch);
    if ($("ppl-mesh-toggle").getAttribute("aria-pressed") === "true") showReconstructedMesh().catch((error) => {
      $("ppl-variant-info").textContent = `Mesh failed: ${error.message}`;
    });
  }

  async function showMesh() {
    if (!state.variant) return;
    const request = ++state.meshRequest;
    const canvas = $("ppl-mesh-canvas");
    canvas.style.display = "block";
    state.mesh?.dispose();
    state.mesh = null;
    $("ppl-variant-info").textContent = "Loading the stored PPL OBJ…";
    const response = await fetch(`/api/ppl-mesh?id=${encodeURIComponent(state.variant.id)}`);
    if (!response.ok) throw new Error(await response.text());
    const obj = await response.text();
    if (request !== state.meshRequest || $("ppl-mesh-toggle").getAttribute("aria-pressed") !== "true") return;
    state.mesh = new window.ShellViewer(canvas, obj, {
      yaw: state.yaw,
      pitch: state.pitch,
      zoom: 2.05,
      normalizeCell: true,
      color: [0.96, 0.65, 0.26],
      onRotate: (yaw, pitch, zoom) => {
        state.yaw = yaw;
        state.pitch = pitch;
        state.meshZoom = zoom;
        drawSkeleton($("ppl-skeleton-canvas"), state.selected, yaw, pitch);
      },
    });
    $("ppl-variant-info").textContent = "Drag to rotate freely · scroll to zoom · orange surface is the stored mesh";
  }

  function browserPreviewAvailable() {
    return Boolean(window.PPLPreview && typeof window.PPLPreview.buildPreview === "function");
  }

  async function showReconstructedMesh() {
    if (!state.variant) return;
    const request = ++state.meshRequest;
    const canvas = $("ppl-mesh-canvas");
    canvas.style.display = "block";
    state.mesh?.dispose();
    state.mesh = null;
    $("ppl-variant-info").textContent = "Reconstructing the PPL field in the browser…";
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    if (request !== state.meshRequest || $("ppl-mesh-toggle").getAttribute("aria-pressed") !== "true") return;
    if (!browserPreviewAvailable()) {
      throw new Error("PPL reconstruction module did not load; refresh this page");
    }
    const preview = window.PPLPreview.buildPreview(state.selected, state.variant, 32);
    if (!preview.count) throw new Error("The reconstructed PPL field has no surface at this resolution");
    state.mesh = new window.ShellViewer(canvas, preview, {
      yaw: state.yaw,
      pitch: state.pitch,
      zoom: 2.05,
      normalizeCell: true,
      color: [0.97, 0.72, 0.2],
      onRotate: (yaw, pitch, zoom) => {
        state.yaw = yaw;
        state.pitch = pitch;
        state.meshZoom = zoom;
        drawSkeleton($("ppl-skeleton-canvas"), state.selected, yaw, pitch);
      },
    });
    $("ppl-variant-info").textContent = "Drag to rotate freely · scroll to zoom · reconstructed PPL surface";
  }

  async function openTopology(topology) {
    state.selected = topology;
    state.variants = await loadShard(topology);
    state.orientations = [];
    state.orientation = null;
    state.variant = null;
    organize();
    $("ppl-dialog-title").textContent = topology.name;
    $("ppl-dialog-meta").textContent = `${topology.nodes} nodes · ${topology.members} members · ${topology.symmetry} · complexity rank ${topology.rank}`;
    $("ppl-dialog-count").textContent = `${Number(topology.variants).toLocaleString()} PPL variants`;
    $("ppl-selected").textContent = state.variant ? state.variant.id : "Select a variant";
    $("ppl-skeleton-canvas").style.display = "block";
    $("ppl-mesh-canvas").style.display = "none";
    $("ppl-topology-toggle").setAttribute("aria-pressed", "true");
    $("ppl-topology-toggle").textContent = "Hide topology";
    $("ppl-mesh-toggle").setAttribute("aria-pressed", "false");
    $("ppl-mesh-toggle").textContent = "Show PPL mesh";
    $("ppl-dialog").showModal();
    renderOrientations();
    renderVariants();
    requestAnimationFrame(() => drawSkeleton($("ppl-skeleton-canvas"), topology));
    if (state.orientation?.variants[0]) selectVariant(state.orientation.variants[0]);
    else renderProperties();
  }

  $("ppl-search").addEventListener("input", () => {
    state.visible = 48;
    renderCatalog();
  });
  $("ppl-more").addEventListener("click", () => {
    state.visible += 48;
    renderCatalog();
  });
  $("ppl-topology-sort").addEventListener("click", (event) => {
    state.sortTopology = state.sortTopology === "asc" ? "desc" : "asc";
    event.currentTarget.textContent = state.sortTopology === "asc" ? "Complexity ↑" : "Complexity ↓";
    event.currentTarget.setAttribute("aria-pressed", String(state.sortTopology === "desc"));
    renderCatalog();
  });
  $("ppl-orientation-sort").addEventListener("click", (event) => {
    state.sortOrientation = state.sortOrientation === "asc" ? "desc" : "asc";
    event.currentTarget.textContent = state.sortOrientation === "asc" ? "Orientation ↑" : "Orientation ↓";
    organize();
    renderOrientations();
  });
  $("ppl-vf-sort").addEventListener("click", (event) => {
    state.sortVariant = state.sortVariant === "asc" ? "desc" : "asc";
    event.currentTarget.textContent = state.sortVariant === "asc" ? "VF ↑" : "VF ↓";
    renderVariants();
  });
  $("ppl-topology-toggle").addEventListener("click", (event) => {
    const visible = event.currentTarget.getAttribute("aria-pressed") !== "true";
    event.currentTarget.setAttribute("aria-pressed", String(visible));
    event.currentTarget.textContent = visible ? "Hide topology" : "Show topology";
    $("ppl-skeleton-canvas").style.display = visible ? "block" : "none";
  });
  $("ppl-mesh-toggle").addEventListener("click", (event) => {
    const visible = event.currentTarget.getAttribute("aria-pressed") !== "true";
    event.currentTarget.setAttribute("aria-pressed", String(visible));
    event.currentTarget.textContent = visible ? "Hide PPL mesh" : "Show PPL mesh";
    if (visible) {
      showReconstructedMesh().catch((error) => {
        $("ppl-variant-info").textContent = `Mesh failed: ${error.message}`;
      });
    } else {
      $("ppl-mesh-canvas").style.display = "none";
      state.mesh?.dispose();
      state.mesh = null;
    }
  });
  $("ppl-close").addEventListener("click", () => $("ppl-dialog").close());
  $("ppl-dialog").addEventListener("click", (event) => {
    if (event.target === $("ppl-dialog")) $("ppl-dialog").close();
  });
  $("ppl-dialog").addEventListener("close", () => {
    state.mesh?.dispose();
    state.mesh = null;
    ++state.meshRequest;
  });
  window.addEventListener("resize", () => {
    if (state.selected) drawSkeleton($("ppl-skeleton-canvas"), state.selected, state.yaw, state.pitch);
    state.mesh?.draw();
  });

  async function init() {
    try {
      const response = await fetch(`${base}catalog.json`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.catalog = await response.json();
      state.topologies = [...state.catalog.topologies].sort((left, right) => left.rank - right.rank);
      await loadGeometries();
      renderCatalog();
      $("ppl-loading").hidden = true;
    } catch (error) {
      $("ppl-loading").innerHTML = `<strong>Plate data failed to load</strong><span>${error.message}</span>`;
    }
  }
  init();
})();
