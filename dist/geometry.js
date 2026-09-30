/* Projection-only gallery renderer. Source geometry comes from data/samples.json. */
(() => {
  const palette = {
    panetta: { body: "#6bc7ea", light: "#b7eaff", shade: "#296a86" },
    // Keep both source geometries in the same blue material family. Source
    // labels still identify ETH vs Panetta; color no longer implies a
    // different physical material or render path.
    eth: { body: "#6bc7ea", light: "#b7eaff", shade: "#296a86" },
  };

  function makeGeometry(sample, topology) {
    const nodes = topology.nodes.map((point) => point.slice());
    for (const [index, dx, dy, dz] of sample.node_displacements) {
      nodes[index][0] += dx;
      nodes[index][1] += dy;
      nodes[index][2] += dz;
    }
    // Compact topology variants inherit their source from the parent topology.
    // Without this fallback ETH variants (whose coordinates are one-octant
    // records) skip the symmetry expansion and render into a single corner.
    const source = sample.source || topology.source;
    if (source !== "eth") return { nodes, edges: topology.edges };

    const mirroredNodes = [];
    const mirroredEdges = [];
    const ids = new Map();
    const seen = new Set();
    const pointId = (point) => {
      const key = point.map((value) => Math.round(value * 1e12)).join(":");
      if (!ids.has(key)) {
        ids.set(key, mirroredNodes.length);
        mirroredNodes.push(point);
      }
      return ids.get(key);
    };
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      for (const [a, b] of topology.edges) {
        const i = pointId([nodes[a][0] * sx, nodes[a][1] * sy, nodes[a][2] * sz]);
        const j = pointId([nodes[b][0] * sx, nodes[b][1] * sy, nodes[b][2] * sz]);
        if (i === j) continue;
        const edge = i < j ? [i, j] : [j, i];
        const key = edge.join(":");
        if (!seen.has(key)) {
          seen.add(key);
          mirroredEdges.push(edge);
        }
      }
    }
    return { nodes: mirroredNodes, edges: mirroredEdges };
  }

  const surfaceCache = new Map();
  const cubeCorners = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ];
  const tetrahedra = [
    [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
    [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6],
  ];
  const tetraEdges = [[0, 1], [1, 2], [2, 0], [0, 3], [1, 3], [2, 3]];

  function sampleField(geometry, radius, resolution) {
    const count = resolution + 1;
    const values = new Float32Array(count * count * count);
    const step = 2 / resolution;
    const index = (x, y, z) => (z * count + y) * count + x;
    const segmentDistanceSquared = (p, a, b) => {
      const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
      const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
      const denom = abx * abx + aby * aby + abz * abz;
      const t = denom > 1e-12 ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / denom)) : 0;
      const dx = p[0] - (a[0] + t * abx);
      const dy = p[1] - (a[1] + t * aby);
      const dz = p[2] - (a[2] + t * abz);
      return dx * dx + dy * dy + dz * dz;
    };
    for (let z = 0; z < count; z++) for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) {
      const point = [-1 + x * step, -1 + y * step, -1 + z * step];
      let nearest = Infinity;
      for (const [a, b] of geometry.edges) {
        nearest = Math.min(nearest, segmentDistanceSquared(point, geometry.nodes[a], geometry.nodes[b]));
      }
      values[index(x, y, z)] = radius - Math.sqrt(nearest);
    }
    return { values, count, step, index };
  }

  function extractSurface(geometry, radius, resolution) {
    const cacheKey = `${geometry.nodes.length}:${geometry.edges.length}:${radius.toFixed(7)}:${resolution}:${geometry.nodes.flat().map((v) => v.toFixed(5)).join(",")}`;
    if (surfaceCache.has(cacheKey)) return surfaceCache.get(cacheKey);
    const field = sampleField(geometry, radius, resolution);
    const { values, count, step, index } = field;
    const triangles = [];
    const interpolate = (left, right) => {
      const lv = left.value, rv = right.value;
      const denominator = rv - lv;
      const t = Math.abs(denominator) < 1e-12 ? 0.5 : Math.max(0, Math.min(1, -lv / denominator));
      return [
        left.point[0] + (right.point[0] - left.point[0]) * t,
        left.point[1] + (right.point[1] - left.point[1]) * t,
        left.point[2] + (right.point[2] - left.point[2]) * t,
      ];
    };
    const addTetra = (corners) => {
      const intersections = [];
      for (const [a, b] of tetraEdges) {
        const left = corners[a], right = corners[b];
        if ((left.value >= 0) !== (right.value >= 0)) intersections.push(interpolate(left, right));
      }
      if (intersections.length < 3) return;
      const addTriangle = (a, b, c) => {
        const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const normal = [
          ab[1] * ac[2] - ab[2] * ac[1],
          ab[2] * ac[0] - ab[0] * ac[2],
          ab[0] * ac[1] - ab[1] * ac[0],
        ];
        const length = Math.hypot(...normal) || 1;
        triangles.push({ points: [a, b, c], normal: normal.map((value) => value / length) });
      };
      if (intersections.length === 3) addTriangle(intersections[0], intersections[1], intersections[2]);
      else {
        addTriangle(intersections[0], intersections[1], intersections[2]);
        addTriangle(intersections[0], intersections[2], intersections[3]);
      }
    };
    for (let z = 0; z < resolution; z++) for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
      const corners = cubeCorners.map(([dx, dy, dz]) => {
        const gx = x + dx, gy = y + dy, gz = z + dz;
        return { point: [-1 + gx * step, -1 + gy * step, -1 + gz * step], value: values[index(gx, gy, gz)] };
      });
      for (const tetra of tetrahedra) addTetra(tetra.map((corner) => corners[corner]));
    }
    const mesh = { triangles, resolution };
    surfaceCache.set(cacheKey, mesh);
    while (surfaceCache.size > 14) surfaceCache.delete(surfaceCache.keys().next().value);
    return mesh;
  }

  function hexToRgb(hex) {
    return [0, 2, 4].map((offset) => parseInt(hex.slice(1 + offset, 3 + offset), 16));
  }

  function shadeColor(hex, amount) {
    const rgb = hexToRgb(hex).map((value) => Math.max(0, Math.min(255, Math.round(value * (0.62 + amount * 0.48)))));
    return `rgb(${rgb.join(",")})`;
  }

  function renderSurface(ctx, mesh, project, rotate, color, width, height, scale, options = {}) {
    const projected = mesh.triangles.map((triangle) => {
      const points = triangle.points.map(project);
      const rotatedNormal = rotate(triangle.normal);
      const brightness = Math.max(0.08, Math.min(1, 0.38 + Math.abs(rotatedNormal[2]) * 0.55 + rotatedNormal[1] * 0.12));
      const depth = points.reduce((total, point) => total + point[2], 0) / 3;
      return { points, depth, fill: shadeColor(color.body, brightness) };
    });
    projected.sort((left, right) => left.depth - right.depth);
    for (const triangle of projected) {
      ctx.beginPath();
      ctx.moveTo(triangle.points[0][0], triangle.points[0][1]);
      ctx.lineTo(triangle.points[1][0], triangle.points[1][1]);
      ctx.lineTo(triangle.points[2][0], triangle.points[2][1]);
      ctx.closePath();
      ctx.fillStyle = triangle.fill;
      ctx.fill();
      ctx.strokeStyle = options.meshWireframe ? color.light : color.shade;
      ctx.globalAlpha = options.meshWireframe ? 0.34 : 0.055;
      ctx.lineWidth = options.meshWireframe
        ? Math.max(0.45, scale * 0.0055)
        : Math.max(0.25, scale * 0.003);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function renderImplicitSurface(ctx, mesh, project, rotate, color, width, height, scale) {
    const projected = mesh.triangles.map((triangle) => {
      const points = triangle.points.map(project);
      const rotatedNormal = rotate(triangle.normal);
      const facing = Math.max(0, rotatedNormal[2]);
      const sideLight = Math.max(0, rotatedNormal[1]) * 0.18;
      const brightness = Math.max(0.12, Math.min(1, 0.28 + facing * 0.68 + sideLight));
      const depth = points.reduce((total, point) => total + point[2], 0) / 3;
      return { points, depth, fill: shadeColor(color.body, brightness) };
    });
    projected.sort((left, right) => left.depth - right.depth);
    for (const triangle of projected) {
      ctx.beginPath();
      ctx.moveTo(triangle.points[0][0], triangle.points[0][1]);
      ctx.lineTo(triangle.points[1][0], triangle.points[1][1]);
      ctx.lineTo(triangle.points[2][0], triangle.points[2][1]);
      ctx.closePath();
      ctx.fillStyle = triangle.fill;
      ctx.fill();
      // A very light contour keeps the implicit surface readable without
      // turning it back into a wireframe.
      ctx.strokeStyle = color.light;
      ctx.globalAlpha = 0.09;
      ctx.lineWidth = Math.max(0.35, scale * 0.0045);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function radiusT(sample, options) {
    const range = options.radiusRange;
    if (!range || range.length < 2) return 0.5;
    const span = range[1] - range[0];
    if (span <= 1e-9) return 0.5;
    return clamp((sample.radius - range[0]) / span, 0, 1);
  }

  function render(canvas, sample, topology, yaw = -0.68, options = {}) {
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const fill = ctx.createLinearGradient(0, 0, width, height);
    fill.addColorStop(0, "#111f30");
    fill.addColorStop(1, "#071321");
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, width, height);

    const pitch = 0.56;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const rotate = ([x, y, z]) => {
      const horizontal = cy * x - sy * y;
      const depth = sy * x + cy * y;
      return [horizontal, cp * z - sp * depth, sp * z + cp * depth];
    };

    const cubeWorld = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) cubeWorld.push([x, y, z]);
    const cube = cubeWorld.map(rotate);
    const maxX = Math.max(...cube.map((point) => Math.abs(point[0])));
    const maxY = Math.max(...cube.map((point) => Math.abs(point[1])));
    const scale = Math.min((width * 0.77) / (2 * maxX), (height * 0.77) / (2 * maxY));
    const project = (point) => {
      const [x, y, depth] = rotate(point);
      return [width / 2 + x * scale, height / 2 - y * scale, depth];
    };

    const boxEdges = [];
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
      const different = [0, 1, 2].filter((axis) => cubeWorld[i][axis] !== cubeWorld[j][axis]);
      if (different.length === 1) boxEdges.push([i, j]);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(150,190,220,.16)";
    for (const [i, j] of boxEdges) {
      const a = [width / 2 + cube[i][0] * scale, height / 2 - cube[i][1] * scale];
      const b = [width / 2 + cube[j][0] * scale, height / 2 - cube[j][1] * scale];
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
    }

    const geometry = makeGeometry(sample, topology);
    // Topology-browser variants are compact records and inherit their source
    // from the parent topology rather than duplicating it per variant.
    const color = palette[sample.source] || palette[topology.source] || palette.panetta;
    const mode = options.mode || "surface";
    if (mode === "surface" || mode === "implicit") {
      const resolution = mode === "implicit"
        ? (options.implicitResolution || 72)
        : (options.surfaceResolution || 48);
      const mesh = extractSurface(geometry, sample.radius, resolution);
      if (mode === "implicit") renderImplicitSurface(ctx, mesh, project, rotate, color, width, height, scale);
      else renderSurface(ctx, mesh, project, rotate, color, width, height, scale, options);
      if (options.showNodes) {
        const nodeRadius = options.nodeRadius || 4.8;
        for (const node of geometry.nodes.map(project)) {
          ctx.beginPath();
          ctx.arc(node[0], node[1], nodeRadius + 1.4, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(3, 12, 23, .88)";
          ctx.fill();
          ctx.beginPath();
          ctx.arc(node[0], node[1], nodeRadius, 0, Math.PI * 2);
          ctx.fillStyle = options.nodeColor || "#70d5ff";
          ctx.fill();
          ctx.strokeStyle = "#d8f5ff";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      if (options.highlightEntries && options.showDisplacementGuides !== false) {
        ctx.font = "bold 10px ui-monospace, Consolas, monospace";
        for (const [index, dx, dy, dz] of options.highlightEntries) {
          const base = project(topology.nodes[index]);
          const moved = project([topology.nodes[index][0] + dx, topology.nodes[index][1] + dy, topology.nodes[index][2] + dz]);
          if (!options.baselineOnly) {
            ctx.beginPath(); ctx.setLineDash([4, 3]); ctx.moveTo(base[0], base[1]); ctx.lineTo(moved[0], moved[1]);
            ctx.lineWidth = 2; ctx.strokeStyle = "#ffb36d"; ctx.stroke(); ctx.setLineDash([]);
          }
          ctx.beginPath(); ctx.arc(base[0], base[1], 4, 0, Math.PI * 2); ctx.fillStyle = "#70d5ff"; ctx.fill();
          if (!options.baselineOnly) {
            ctx.beginPath();
            ctx.arc(moved[0], moved[1], 5, 0, Math.PI * 2);
            ctx.fillStyle = options.nodeColor || "#70d5ff";
            ctx.fill();
          }
          ctx.fillStyle = "#f1f6ff"; ctx.fillText(`N${index}`, (options.baselineOnly ? base : moved)[0] + 8, (options.baselineOnly ? base : moved)[1] - 8);
        }
      }
      return mesh.triangles.length;
    }
    const projected = geometry.nodes.map(project);
    const edges = geometry.edges.map(([a, b]) => ({ a: projected[a], b: projected[b] }));
    edges.sort((left, right) => (left.a[2] + left.b[2]) - (right.a[2] + right.b[2]));
    // Topology cards stay fine and legible by default. The detail dialog opts
    // into the physical radius: diameter = 2r in the same normalized cell
    // coordinates used by the surface renderer, so the line width is not
    // remapped to an arbitrary global radius range.
    const skeletonWidth = options.radiusDisplay
      ? Math.max(0.8, 2 * sample.radius * scale)
      : (options.skeletonLineWidth || 1.8);
    const thickness = mode === "skeleton"
      ? skeletonWidth
      : Math.max(2.5, 2 * sample.radius * scale);

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const { a, b } of edges) {
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      ctx.lineWidth = thickness + (mode === "skeleton" ? 2.2 : 2);
      ctx.strokeStyle = color.shade;
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      ctx.lineWidth = thickness;
      ctx.strokeStyle = color.body;
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(a[0] - thickness * 0.1, a[1] - thickness * 0.16);
      ctx.lineTo(b[0] - thickness * 0.1, b[1] - thickness * 0.16);
      ctx.lineWidth = Math.max(0.8, thickness * (mode === "skeleton" ? 0.2 : 0.25));
      ctx.strokeStyle = color.light;
      ctx.globalAlpha = 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (options.showNodes) {
      const nodeRadius = options.nodeRadius || Math.max(2.6, thickness * 0.74);
      for (const node of projected) {
        ctx.beginPath();
        ctx.arc(node[0], node[1], nodeRadius + 1.2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(3, 12, 23, .82)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(node[0], node[1], nodeRadius, 0, Math.PI * 2);
        ctx.fillStyle = options.nodeColor || "#70d5ff";
        ctx.fill();
        ctx.strokeStyle = color.shade;
        ctx.lineWidth = mode === "skeleton" ? 1.2 : 0.8;
        ctx.stroke();
      }
    }

    if (options.highlightEntries && options.showDisplacementGuides !== false) {
      ctx.font = "bold 10px ui-monospace, Consolas, monospace";
      for (const [index, dx, dy, dz] of options.highlightEntries) {
        const base = project(topology.nodes[index]);
        const moved = project([
          topology.nodes[index][0] + dx,
          topology.nodes[index][1] + dy,
          topology.nodes[index][2] + dz,
        ]);
        if (!options.baselineOnly) {
          ctx.beginPath();
          ctx.setLineDash([4, 3]);
          ctx.moveTo(base[0], base[1]);
          ctx.lineTo(moved[0], moved[1]);
          ctx.lineWidth = 2.6;
          ctx.strokeStyle = "#ffb36d";
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.beginPath();
        ctx.arc(base[0], base[1], 5.4, 0, Math.PI * 2);
        ctx.fillStyle = "#70d5ff";
        ctx.fill();
        const labelPoint = options.baselineOnly ? base : moved;
        if (!options.baselineOnly) {
          ctx.beginPath();
          ctx.arc(moved[0], moved[1], 7.2, 0, Math.PI * 2);
          ctx.fillStyle = options.nodeColor || "#70d5ff";
          ctx.fill();
        }
        ctx.fillStyle = "#f1f6ff";
        ctx.fillText(`N${index}`, labelPoint[0] + 8, labelPoint[1] - 8);
      }
    }

    return geometry.edges.length;
  }

  window.TrussGeometry = { render, makeGeometry };
})();
