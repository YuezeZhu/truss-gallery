(() => {
  const base = "/shell-data/";
  const dialog = document.querySelector("#shell-dialog");
  const canvas = document.querySelector("#shell-viewer");
  const status = document.querySelector("#shell-viewer-status");
  let viewer = null;
  let currentLoad = 0;

  const percent = (value) => `${(100 * Number(value)).toFixed(2)}%`;
  const fixed = (value, digits = 4) => Number(value).toFixed(digits);
  const reasonLabels = {
    vf_outside_5_35: "VF outside 5–35%",
    solid_not_connected: "32³ solid is disconnected",
    obj_surface_not_connected: "OBJ surface is disconnected",
    missing_expected_boundary_contact: "missing expected boundary contact",
    skeleton_coverage_below_80pct: "skeleton coverage below 80%",
    symmetry_mismatch: "symmetry mismatch",
    voxelization_failed: "32³ voxelization failed",
    generation_failed: "Shell generation failed",
  };

  function createCard(item) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "shell-card";
    button.dataset.status = item.status;
    button.dataset.quality = item.quality_status || "pending";
    button.dataset.boundary = item.boundary_span_count === 3 ? "xyz" : "partial";
    button.dataset.filter = item.filter_status || "pending";
    button.setAttribute("aria-label", `Open Shell for ${item.topology_name}`);
    const image = document.createElement("img");
    image.loading = "lazy";
    image.alt = `Shell mesh for ${item.topology_name}`;
    if (item.status === "ok") image.src = `${base}${item.preview}?d=${item.shell_diameter}&vf=${item.shell_density_32}`;
    const body = document.createElement("span");
    body.className = "shell-card-body";
    const title = document.createElement("strong");
    title.className = "shell-card-title";
    title.textContent = item.topology_name;
    const meta = document.createElement("span");
    meta.className = "shell-card-meta";
    meta.textContent = `${item.full_cell_nodes} nodes · ${item.full_cell_edges} members · ${item.faces?.toLocaleString() || "—"} mesh faces`;
    const vf = document.createElement("span");
    vf.className = "shell-card-vf";
    vf.textContent = item.status === "ok"
      ? `Shell VF ${percent(item.shell_density_32)}${item.filter_status === "accepted" ? " · passed filters" : item.filter_status === "needs_review" ? " · needs review" : " · validating"}`
      : item.status;
    body.append(title, meta, vf);
    if (item.filter_status === "needs_review") {
      const reasons = document.createElement("span");
      reasons.className = "shell-card-boundary";
      reasons.textContent = (item.filter_reasons || []).map((reason) => reasonLabels[reason] || reason).join(" · ");
      body.append(reasons);
    }
    if (item.boundary_span_count != null && item.boundary_span_count < 3) {
      const boundary = document.createElement("span");
      boundary.className = "shell-card-boundary";
      boundary.textContent = `Boundary reach ${item.boundary_span_count}/3 axes`;
      body.append(boundary);
    }
    button.append(image, body);
    button.disabled = item.status !== "ok";
    button.addEventListener("click", () => openShell(item));
    return button;
  }

  async function loadManifest() {
    const loading = document.querySelector("#shell-gallery-loading");
    try {
      const response = await fetch(`${base}manifest.json`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.schema !== "shell-complexity-extremes-v1") throw new Error("Unexpected Shell manifest format");
      const simple = document.querySelector("#shell-simple-grid");
      const complex = document.querySelector("#shell-complex-grid");
      simple.replaceChildren(...payload.samples.filter((item) => item.group === "simplest").map(createCard));
      complex.replaceChildren(...payload.samples.filter((item) => item.group === "most_complex").map(createCard));
      const complete = payload.samples.filter((item) => item.status === "ok").length;
      const validated = payload.samples.filter((item) => item.filter_status === "accepted").length;
      const review = payload.samples.filter((item) => item.filter_status === "needs_review").length;
      const fullBoundary = payload.samples.filter((item) => item.boundary_span_count === 3).length;
      document.querySelector("#shell-gallery-count").textContent = `${complete} generated · ${validated} passed filters · ${review} needs review · ${fullBoundary} reach XYZ faces`;
      loading.hidden = true;
      if (payload.samples.some((item) => !item.quality_status)) window.setTimeout(loadManifest, 5000);
    } catch (error) {
      loading.innerHTML = `<strong>Shell data failed to load</strong><span>${error.message}</span>`;
      document.querySelector("#shell-gallery-count").textContent = "Shell data unavailable";
    }
  }

  function addFact(facts, label, value) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = value;
    row.append(term, detail);
    facts.append(row);
  }

  async function openShell(item) {
    const token = ++currentLoad;
    document.querySelector("#shell-dialog-title").textContent = item.topology_name;
    document.querySelector("#shell-dialog-subtitle").textContent =
      `${item.group === "simplest" ? "Simplest" : "Most complex"} 20 · complexity rank ${item.complexity_rank.toLocaleString()} · source Truss record ${item.truss_record_id}`;
    const facts = document.querySelector("#shell-facts");
    facts.replaceChildren();
    addFact(facts, "Shell VF at 32³", percent(item.shell_density_32));
    addFact(facts, "Source Truss VF", percent(item.truss_density_32));
    addFact(facts, "Full-cell skeleton", `${item.full_cell_nodes} nodes / ${item.full_cell_edges} members`);
    addFact(facts, "Shell diameter", fixed(item.shell_diameter));
    addFact(facts, "Joint smoothness", fixed(item.shell_smoothness));
    addFact(facts, "Shell half-thickness", fixed(item.shell_half_thickness));
    addFact(facts, "Mesh", `${item.vertices.toLocaleString()} vertices / ${item.faces.toLocaleString()} faces`);
    addFact(facts, "OBJ surface components", item.mesh_components == null ? "Not checked" : String(item.mesh_components));
    addFact(facts, "32³ solid components", item.voxel_components_6_neighbor == null ? "Validating" : String(item.voxel_components_6_neighbor));
    addFact(facts, "Boundary reach", item.boundary_axes_reached == null
      ? "Not checked"
      : `${item.boundary_axes_reached.join(", ")} (${item.boundary_span_count}/3 axes)`);
    addFact(facts, "32³ boundary faces", item.boundary_faces_32 == null
      ? "Not checked"
      : Object.entries(item.boundary_faces_32).filter(([, value]) => value).map(([face]) => face).join(", ") || "none");
    addFact(facts, "Connectivity", item.connectivity_status || "Not checked");
    addFact(facts, "Symmetry", item.symmetry_status == null
      ? "Not checked"
      : `${item.symmetry_mode} · ${item.symmetry_operations} operations · mismatch ${percent(item.symmetry_mismatch_fraction)}`);
    addFact(facts, "Skeleton coverage", item.skeleton_coverage_fraction == null
      ? "Not checked"
      : `${percent(item.skeleton_coverage_fraction)} of sampled edge points`);
    addFact(facts, "Screening", item.filter_status === "accepted" ? "Passed all filters" : "Needs review");
    if (item.filter_status === "needs_review") {
      addFact(facts, "Review reasons", (item.filter_reasons || []).map((reason) => reasonLabels[reason] || reason).join("; "));
    }
    addFact(facts, "Geometry check", item.quality_status === "connected_vf_5_35" ? "Connected · VF 5–35%" : "Needs review");
    const download = document.querySelector("#shell-download");
    download.href = base + item.mesh;
    download.download = item.mesh.split("/").pop();
    status.textContent = "Loading actual Shell OBJ…";
    dialog.showModal();
    try {
      const response = await fetch(`${base}${item.mesh}?d=${item.shell_diameter}&vf=${item.shell_density_32}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const obj = await response.text();
      if (token !== currentLoad || !dialog.open) return;
      if (viewer) viewer.dispose();
      viewer = new ShellViewer(canvas, obj);
      status.textContent = "Drag to rotate · scroll to zoom";
    } catch (error) {
      if (token === currentLoad) status.textContent = `Mesh failed to load: ${error.message}`;
    }
  }

  function parseObj(text) {
    const vertices = [];
    const faces = [];
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("v ")) {
        const parts = line.trim().split(/\s+/);
        vertices.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
      } else if (line.startsWith("f ")) {
        const parts = line.trim().split(/\s+/).slice(1).map((part) => Number(part.split("/")[0]) - 1);
        for (let i = 1; i + 1 < parts.length; i++) faces.push([parts[0], parts[i], parts[i + 1]]);
      }
    }
    if (!vertices.length || !faces.length) throw new Error("OBJ contains no triangles");
    const positions = new Float32Array(faces.length * 9);
    const normals = new Float32Array(faces.length * 9);
    let offset = 0;
    for (const face of faces) {
      const a = vertices[face[0]], b = vertices[face[1]], c = vertices[face[2]];
      if (!a || !b || !c) throw new Error("OBJ has invalid vertex indices");
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const length = Math.hypot(...n) || 1;
      for (const point of [a, b, c]) {
        positions.set(point, offset);
        normals.set(n.map((value) => value / length), offset);
        offset += 3;
      }
    }
    return { positions, normals, count: faces.length * 3 };
  }

  function shader(gl, kind, source) {
    const result = gl.createShader(kind);
    gl.shaderSource(result, source);
    gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result));
    return result;
  }

  class ShellViewer {
    constructor(canvas, obj, options = {}) {
      this.canvas = canvas;
      this.onRotate = options.onRotate || (() => {});
      this.color = options.color || [0.94,0.54,0.14];
      this.gl = canvas.getContext("webgl", { antialias: true, alpha: true, preserveDrawingBuffer: false });
      if (!this.gl) throw new Error("WebGL is unavailable");
      const gl = this.gl;
      const geometry = parseObj(obj);
      const vertex = shader(gl, gl.VERTEX_SHADER, `
        attribute vec3 aPosition;
        attribute vec3 aNormal;
        uniform float uYaw;
        uniform float uPitch;
        uniform float uZoom;
        varying vec3 vNormal;
        void main() {
          float cy = cos(uYaw), sy = sin(uYaw), cp = cos(uPitch), sp = sin(uPitch);
          vec3 q = vec3(cy*aPosition.x + sy*aPosition.z, aPosition.y, -sy*aPosition.x + cy*aPosition.z);
          vec3 p = vec3(q.x, cp*q.y - sp*q.z, sp*q.y + cp*q.z);
          vec3 n = vec3(cy*aNormal.x + sy*aNormal.z, aNormal.y, -sy*aNormal.x + cy*aNormal.z);
          vNormal = normalize(vec3(n.x, cp*n.y - sp*n.z, sp*n.y + cp*n.z));
          gl_Position = vec4(p.x * uZoom, p.y * uZoom, -p.z * 0.45, 3.0 - p.z);
        }
      `);
      const fragment = shader(gl, gl.FRAGMENT_SHADER, `
        precision mediump float;
        uniform vec3 uColor;
        varying vec3 vNormal;
        void main() {
          vec3 light = normalize(vec3(0.5, 0.8, 1.0));
          float diffuse = 0.32 + 0.68 * abs(dot(normalize(vNormal), light));
          vec3 color = uColor * diffuse + vec3(0.06, 0.025, 0.005);
          gl_FragColor = vec4(color, 1.0);
        }
      `);
      this.program = gl.createProgram();
      gl.attachShader(this.program, vertex);
      gl.attachShader(this.program, fragment);
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
      this.position = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.position);
      gl.bufferData(gl.ARRAY_BUFFER, geometry.positions, gl.STATIC_DRAW);
      this.normal = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.normal);
      gl.bufferData(gl.ARRAY_BUFFER, geometry.normals, gl.STATIC_DRAW);
      this.count = geometry.count;
      this.yaw = options.yaw ?? -0.7;
      this.pitch = options.pitch ?? 0.45;
      this.zoom = options.zoom ?? 2.1;
      this.pointer = null;
      this.onDown = (event) => { this.pointer = [event.clientX, event.clientY]; canvas.setPointerCapture(event.pointerId); };
      this.onMove = (event) => {
        if (!this.pointer) return;
        this.yaw += (event.clientX - this.pointer[0]) * 0.008;
        this.pitch += (event.clientY - this.pointer[1]) * 0.008;
        this.pointer = [event.clientX, event.clientY];
        this.draw();
        this.onRotate(this.yaw, this.pitch, this.zoom);
      };
      this.onUp = () => { this.pointer = null; };
      this.onWheel = (event) => { event.preventDefault(); this.zoom = Math.max(1.1, Math.min(4.2, this.zoom * Math.exp(-event.deltaY * 0.001))); this.draw(); this.onRotate(this.yaw,this.pitch,this.zoom); };
      canvas.addEventListener("pointerdown", this.onDown);
      canvas.addEventListener("pointermove", this.onMove);
      canvas.addEventListener("pointerup", this.onUp);
      canvas.addEventListener("pointercancel", this.onUp);
      canvas.addEventListener("wheel", this.onWheel, { passive: false });
      this.draw();
    }

    draw() {
      const gl = this.gl;
      const width = Math.max(1, Math.floor(this.canvas.clientWidth * Math.min(devicePixelRatio, 1.5)));
      const height = Math.max(1, Math.floor(this.canvas.clientHeight * Math.min(devicePixelRatio, 1.5)));
      if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.useProgram(this.program);
      for (const [buffer, attribute] of [[this.position, "aPosition"], [this.normal, "aNormal"]]) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        const location = gl.getAttribLocation(this.program, attribute);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
      }
      gl.uniform1f(gl.getUniformLocation(this.program, "uYaw"), this.yaw);
      gl.uniform1f(gl.getUniformLocation(this.program, "uPitch"), this.pitch);
      gl.uniform1f(gl.getUniformLocation(this.program, "uZoom"), this.zoom);
      gl.uniform3fv(gl.getUniformLocation(this.program, "uColor"),this.color);
      gl.drawArrays(gl.TRIANGLES, 0, this.count);
    }

    dispose() {
      const gl = this.gl;
      this.canvas.removeEventListener("pointerdown", this.onDown);
      this.canvas.removeEventListener("pointermove", this.onMove);
      this.canvas.removeEventListener("pointerup", this.onUp);
      this.canvas.removeEventListener("pointercancel", this.onUp);
      this.canvas.removeEventListener("wheel", this.onWheel);
      gl.deleteBuffer(this.position);
      gl.deleteBuffer(this.normal);
      gl.deleteProgram(this.program);
    }
  }

  // Reusable by the full Shell 100k browser below.  The original pilot
  // gallery and the full gallery share the same lightweight WebGL renderer.
  window.ShellViewer = ShellViewer;

  document.querySelector("#shell-dialog-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { ++currentLoad; if (viewer) { viewer.dispose(); viewer = null; } });
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  window.addEventListener("resize", () => viewer?.draw());
  loadManifest();
})();
