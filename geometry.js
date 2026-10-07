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
  // Node positions and ETH symmetry expansion are invariant during a drag.
  // Keep the expanded centerline geometry by sample object so pointer moves
  // only perform projection work instead of rebuilding all nodes and edges.
  const geometryCache = new WeakMap();
  const geometryIds = new WeakMap();
  let nextGeometryId = 1;
  const cubeCorners = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ];
  const tetrahedra = [
    [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
    [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6],
  ];
  const tetraEdges = [[0, 1], [1, 2], [2, 0], [0, 3], [1, 3], [2, 3]];

  function sampleField(geometry, radius, resolution, paddingVoxels = 1) {
    const step = 2 / resolution;
    // Boundary-centered ETH members need a complete radius on both sides of
    // the cell boundary. One voxel of padding is not enough for the larger
    // radii, otherwise MC keeps only the inner half of the capsule and the
    // blue centerline appears outside the yellow surface.
    const geometryExtent = geometry.nodes.reduce(
      (maximum, node) => Math.max(maximum, Math.abs(node[0]), Math.abs(node[1]), Math.abs(node[2])),
      1,
    );
    const padding = Math.max(0, radius) + Math.max(1, Math.floor(paddingVoxels)) * step;
    // Build the MC domain from the displaced centerline bounds, not only from
    // the nominal unit cell. Otherwise a perturbed endpoint outside ±1 is
    // clipped and the reconstructed mesh appears shorter than the skeleton.
    const targetExtent = geometryExtent + padding;
    const cells = Math.max(resolution, Math.ceil((2 * targetExtent) / step));
    const origin = -(cells * step) / 2;
    const count = cells + 1;
    const values = new Float32Array(count * count * count);
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
    // The sampling domain now covers every finite centerline segment and a
    // complete radius around it, so endpoint caps stay aligned with the blue
    // skeleton overlay even after node-position perturbations.
    const segments = geometry.edges.map(([aIndex, bIndex]) => [geometry.nodes[aIndex], geometry.nodes[bIndex]]);
    for (let z = 0; z < count; z++) for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) {
      const point = [origin + x * step, origin + y * step, origin + z * step];
      let nearest = Infinity;
      for (const [a, b] of segments) {
        nearest = Math.min(nearest, segmentDistanceSquared(point, a, b));
      }
      values[index(x, y, z)] = radius - Math.sqrt(nearest);
    }
    return { values, count, cells, origin, step, index };
  }

  function extractSurface(geometry, radius, resolution, paddingVoxels = 1) {
    let geometryId = geometryIds.get(geometry);
    if (!geometryId) {
      geometryId = nextGeometryId++;
      geometryIds.set(geometry, geometryId);
    }
    // Geometry is immutable for a selected variant, so avoid flattening and
    // stringifying every node on every pointer frame just to hit the cache.
    const cacheKey = `${geometryId}:${radius.toFixed(7)}:${resolution}:pad${paddingVoxels}`;
    if (surfaceCache.has(cacheKey)) return surfaceCache.get(cacheKey);
    const field = sampleField(geometry, radius, resolution, paddingVoxels);
    const { values, cells, origin, step, index } = field;
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
    for (let z = 0; z < cells; z++) for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
      const corners = cubeCorners.map(([dx, dy, dz]) => {
        const gx = x + dx, gy = y + dy, gz = z + dz;
        return { point: [origin + gx * step, origin + gy * step, origin + gz * step], value: values[index(gx, gy, gz)] };
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
    const fastSurface = options.fastSurface || options.skipSurfaceSort;
    const projected = mesh.triangles.map((triangle) => {
      const points = triangle.points.map(project);
      if (fastSurface) return { points, depth: 0, fill: color.body };
      const rotatedNormal = rotate(triangle.normal);
      const brightness = Math.max(0.08, Math.min(1, 0.38 + Math.abs(rotatedNormal[2]) * 0.55 + rotatedNormal[1] * 0.12));
      const depth = points.reduce((total, point) => total + point[2], 0) / 3;
      return { points, depth, fill: shadeColor(color.body, brightness) };
    });
    if (!options.skipSurfaceSort) projected.sort((left, right) => left.depth - right.depth);
    if (fastSurface) {
      // Batch the whole preview into one fill operation. Calling beginPath /
      // fill once per triangle is the dominant cost while dragging a dense
      // adaptive mesh and causes visible pointer lag.
      ctx.beginPath();
      for (const triangle of projected) {
        ctx.moveTo(triangle.points[0][0], triangle.points[0][1]);
        ctx.lineTo(triangle.points[1][0], triangle.points[1][1]);
        ctx.lineTo(triangle.points[2][0], triangle.points[2][1]);
        ctx.closePath();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = color.body;
      ctx.fill();
      return;
    }
    for (const triangle of projected) {
      ctx.beginPath();
      ctx.moveTo(triangle.points[0][0], triangle.points[0][1]);
      ctx.lineTo(triangle.points[1][0], triangle.points[1][1]);
      ctx.lineTo(triangle.points[2][0], triangle.points[2][1]);
      ctx.closePath();
      ctx.fillStyle = triangle.fill;
      ctx.fill();
      // During pointer interaction the surface is rendered without a
      // wireframe. Avoid stroking every triangle in that mode: on a 64^3
      // adaptive mesh this can be tens of thousands of extra canvas paths per
      // frame and makes rotation feel sluggish, while the filled surface is
      // already sufficient for a clear preview.
      if (options.meshWireframe) {
        ctx.strokeStyle = options.meshEdgeColor || color.light;
        ctx.globalAlpha = options.meshEdgeAlpha || 0.5;
        ctx.lineWidth = Math.max(0.55, scale * (options.meshEdgeWidth || 0.0065));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  function renderSkeletonOverlay(ctx, geometry, project, color, options = {}) {
    const projected = geometry.nodes.map(project);
    const edges = geometry.edges.map(([a, b]) => ({ a: projected[a], b: projected[b] }));
    edges.sort((left, right) => (left.a[2] + left.b[2]) - (right.a[2] + right.b[2]));
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = options.overlaySkeletonWidth || 1.35;
    ctx.strokeStyle = color;
    ctx.globalAlpha = options.overlaySkeletonAlpha || 0.95;
    for (const { a, b } of edges) {
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (options.overlayNodes === false) return;
    const radius = options.overlayNodeRadius || 3;
    const nodeColor = options.overlayNodeColor || color;
    for (const node of projected) {
      ctx.beginPath();
      ctx.arc(node[0], node[1], radius + 0.7, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(3, 12, 23, .92)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(node[0], node[1], radius, 0, Math.PI * 2);
      ctx.fillStyle = nodeColor;
      ctx.fill();
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

  function quaternionToMatrix([x, y, z, w]) {
    const xx = x * x, yy = y * y, zz = z * z;
    const xy = x * y, xz = x * z, yz = y * z;
    const wx = w * x, wy = w * y, wz = w * z;
    // Column-major order matches GLSL mat3 uniforms and the vector transform
    // used by the Canvas 2D overlay.
    return [
      1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy),
      2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx),
      2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy),
    ];
  }

  function legacyRotationMatrix(yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    return [
      cy, -sp * sy, cp * sy,
      -sy, -sp * cy, cp * cy,
      0, cp, sp,
    ];
  }

  function rotateByMatrix([x, y, z], matrix) {
    return [
      matrix[0] * x + matrix[3] * y + matrix[6] * z,
      matrix[1] * x + matrix[4] * y + matrix[7] * z,
      matrix[2] * x + matrix[5] * y + matrix[8] * z,
    ];
  }

  function resolveRotationMatrix(rotation, yaw, pitch) {
    // The interaction layer stores a normalized quaternion.  The projection
    // and WebGL paths both consume a column-major 3x3 matrix, so convert here
    // at the renderer boundary and keep both paths numerically identical.
    return Array.isArray(rotation) && rotation.length === 4
      ? quaternionToMatrix(rotation)
      : (rotation || legacyRotationMatrix(yaw, pitch));
  }

  function previewRotation(geometry, width, height) {
    // A fixed isometric view makes distinct nodes overlap in dense skeletons.
    // Pick a repeatable view with the fewest near-coincident projected nodes.
    const extent = Math.max(1.06, ...geometry.nodes.flatMap((node) => node.map((value) => Math.abs(value) + 0.05)));
    let best = null;
    for (const yaw of [-0.88, -0.57, -0.29, 0.29, 0.57, 0.88]) {
      for (const pitch of [0.34, 0.55, 0.78]) {
        const matrix = legacyRotationMatrix(yaw, pitch);
        const corners = [];
        for (const x of [-extent, extent]) for (const y of [-extent, extent]) for (const z of [-extent, extent]) {
          corners.push(rotateByMatrix([x, y, z], matrix));
        }
        const maxX = Math.max(...corners.map((point) => Math.abs(point[0])));
        const maxY = Math.max(...corners.map((point) => Math.abs(point[1])));
        const scale = Math.min(width * 0.88 / (2 * maxX), height * 0.88 / (2 * maxY));
        const points = geometry.nodes.map((node) => {
          const point = rotateByMatrix(node, matrix);
          return [point[0] * scale, point[1] * scale];
        });
        let score = 0;
        for (let i = 0; i < points.length; i++) {
          let nearest = Infinity;
          for (let j = 0; j < points.length; j++) {
            if (i === j) continue;
            nearest = Math.min(nearest, Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]));
          }
          score += Math.min(nearest, 12) - 2 * Math.max(0, 6 - nearest);
        }
        if (!best || score > best.score) best = { score, matrix };
      }
    }
    return best?.matrix || legacyRotationMatrix(-0.68, 0.56);
  }

  function render(canvas, sample, topology, yaw = -0.68, options = {}) {
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, options.pixelRatio || 2);
    const targetWidth = Math.round(width * pixelRatio);
    const targetHeight = Math.round(height * pixelRatio);
    // Assigning canvas.width/height clears and reallocates the backing store.
    // Avoid doing that on every pointer frame; only resize when the CSS box or
    // the requested quality level actually changes.
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!options.overlayOnly) {
      const fill = ctx.createLinearGradient(0, 0, width, height);
      fill.addColorStop(0, "#111f30");
      fill.addColorStop(1, "#071321");
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, width, height);
    }

    const mode = options.mode || "surface";

    let geometry = geometryCache.get(sample);
    if (!geometry) {
      geometry = makeGeometry(sample, topology);
      geometryCache.set(sample, geometry);
    }
    const rotationMatrix = options.previewStyle
      ? previewRotation(geometry, width, height)
      : resolveRotationMatrix(options.rotation, yaw, 0.56);
    const rotate = (point) => rotateByMatrix(point, rotationMatrix);

    const cubeWorld = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) cubeWorld.push([x, y, z]);
    const cube = cubeWorld.map(rotate);
    // Scale the view to include the full radius of boundary-centered members
    // while keeping the unit-cell frame at ±1 as a visual reference.
    const geometryExtent = geometry.nodes.reduce(
      (maximum, node) => Math.max(maximum, Math.abs(node[0]), Math.abs(node[1]), Math.abs(node[2])),
      1,
    );
    // Use one camera extent for both the skeleton and surface modes. If the
    // surface-only branch gets extra radius padding, toggling the mesh makes
    // the same geometry visibly zoom in/out. The shared extent keeps overlays
    // and mode switches at a stable scale while still containing the surface.
    const viewResolution = options.surfaceResolution || options.implicitResolution || 48;
    // Keep a common unit-cell camera for topology comparisons. Lattice 0007
    // reaches the six face centers (±1, 0, 0), etc., but has no corner rods;
    // a radius-dependent zoom can make that valid geometry look artificially
    // shorter than corner-connected topologies.
    const viewExtent = options.previewStyle
      ? Math.max(1.06, geometryExtent + 0.05)
      : Math.max(1.4, geometryExtent + Math.max(0, sample.radius) + 2 / viewResolution);
    const viewWorld = [];
    for (const x of [-viewExtent, viewExtent]) for (const y of [-viewExtent, viewExtent]) for (const z of [-viewExtent, viewExtent]) viewWorld.push([x, y, z]);
    const viewCube = viewWorld.map(rotate);
    const maxX = Math.max(...viewCube.map((point) => Math.abs(point[0])));
    const maxY = Math.max(...viewCube.map((point) => Math.abs(point[1])));
    const framing = options.previewStyle ? 0.88 : 0.77;
    const scale = Math.min((width * framing) / (2 * maxX), (height * framing) / (2 * maxY));
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

    const showTopology = options.showTopology !== false;
    // Topology-browser variants are compact records and inherit their source
    // from the parent topology rather than duplicating it per variant.
    const color = palette[sample.source] || palette[topology.source] || palette.panetta;
    if (mode === "surface" || mode === "implicit") {
      const baseResolution = mode === "implicit"
        ? (options.implicitResolution || 72)
        : (options.surfaceResolution || 48);
      // Keep at least three samples across the diameter of the thinnest rod.
      // Otherwise a small-radius member can disappear between grid points and
      // look disconnected even though the underlying capsule union is joined.
      const radiusResolution = options.adaptiveResolution === false
        ? baseResolution
        : (sample.radius > 0
        ? Math.ceil(3 / sample.radius)
        : baseResolution);
      const maxResolution = options.maxSurfaceResolution || 64;
      const resolution = Math.min(maxResolution, Math.max(baseResolution, radiusResolution));
      const mesh = extractSurface(geometry, sample.radius, resolution, options.paddingVoxels ?? 1);
      if (mode === "implicit") renderImplicitSurface(ctx, mesh, project, rotate, color, width, height, scale);
      else renderSurface(ctx, mesh, project, rotate, options.surfaceColor || color, width, height, scale, options);
      if (showTopology && options.overlaySkeleton) {
        renderSkeletonOverlay(ctx, geometry, project, options.overlaySkeletonColor || "#4cc7ff", options);
      }
      if (showTopology && options.showNodes) {
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
      if (showTopology && options.highlightEntries && options.showDisplacementGuides !== false) {
        ctx.font = "bold 10px ui-monospace, Consolas, monospace";
        for (const [index, dx, dy, dz] of options.highlightEntries) {
          const base = project(topology.nodes[index]);
          const moved = project([topology.nodes[index][0] + dx, topology.nodes[index][1] + dy, topology.nodes[index][2] + dz]);
          if (!options.baselineOnly) {
            ctx.beginPath(); ctx.setLineDash([4, 3]); ctx.moveTo(base[0], base[1]); ctx.lineTo(moved[0], moved[1]);
            ctx.lineWidth = 2; ctx.strokeStyle = "#ffb36d"; ctx.stroke(); ctx.setLineDash([]);
          }
          const highlightRadius = options.highlightNodeRadius || 4;
          ctx.beginPath(); ctx.arc(base[0], base[1], highlightRadius, 0, Math.PI * 2); ctx.fillStyle = "#70d5ff"; ctx.fill();
          if (!options.baselineOnly) {
            ctx.beginPath();
            ctx.arc(moved[0], moved[1], highlightRadius, 0, Math.PI * 2);
            ctx.fillStyle = options.nodeColor || "#70d5ff";
            ctx.fill();
          }
          ctx.fillStyle = "#f1f6ff"; ctx.fillText(`N${index}`, (options.baselineOnly ? base : moved)[0] + 8, (options.baselineOnly ? base : moved)[1] - 8);
        }
      }
      return mesh.triangles.length;
    }
    if (!showTopology) return 0;
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
      if (options.previewStyle) {
        const depth = (a[2] + b[2]) / (4 * viewExtent) + 0.5;
        ctx.globalAlpha = 0.35 + 0.6 * Math.max(0, Math.min(1, depth));
      }
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      ctx.lineWidth = thickness + (options.previewStyle ? 0.8 : (mode === "skeleton" ? 2.2 : 2));
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
      const nodeRadius = options.previewStyle
        ? Math.max(1.7, Math.min(3, 5.6 / Math.sqrt(geometry.nodes.length / 12)))
        : (options.nodeRadius || Math.max(2.6, thickness * 0.74));
      const nodes = options.previewStyle ? projected.slice().sort((a, b) => a[2] - b[2]) : projected;
      for (const node of nodes) {
        if (options.previewStyle) {
          const depth = node[2] / (2 * viewExtent) + 0.5;
          ctx.globalAlpha = 0.48 + 0.52 * Math.max(0, Math.min(1, depth));
        }
        ctx.beginPath();
        ctx.arc(node[0], node[1], nodeRadius + (options.previewStyle ? 0.55 : 1.2), 0, Math.PI * 2);
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
      ctx.globalAlpha = 1;
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

  const webglStates = new WeakMap();

  function compileWebGLShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function createWebGLState(canvas) {
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: true,
      depth: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) return null;
    const vertexShader = compileWebGLShader(gl, gl.VERTEX_SHADER, `
      attribute vec3 aPosition;
      attribute vec3 aNormal;
      uniform mat3 uRotation;
      uniform float uScaleX;
      uniform float uScaleY;
      uniform float uDepthScale;
      varying vec3 vNormal;
      void main() {
        vec3 rotated = uRotation * aPosition;
        vNormal = normalize(uRotation * aNormal);
        gl_Position = vec4(rotated.x * uScaleX, rotated.y * uScaleY, clamp(-rotated.z * uDepthScale, -1.0, 1.0), 1.0);
      }
    `);
    const fragmentShader = compileWebGLShader(gl, gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform vec3 uBaseColor;
      varying vec3 vNormal;
      void main() {
        vec3 lightDirection = normalize(vec3(-0.42, 0.62, 0.82));
        float diffuse = 0.36 + 0.64 * max(dot(normalize(vNormal), lightDirection), 0.0);
        gl_FragColor = vec4(uBaseColor * diffuse, 1.0);
      }
    `);
    if (!vertexShader || !fragmentShader) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    const state = {
      gl,
      program,
      buffer: gl.createBuffer(),
      attributes: {
        position: gl.getAttribLocation(program, "aPosition"),
        normal: gl.getAttribLocation(program, "aNormal"),
      },
      uniforms: {
        rotation: gl.getUniformLocation(program, "uRotation"),
        scaleX: gl.getUniformLocation(program, "uScaleX"),
        scaleY: gl.getUniformLocation(program, "uScaleY"),
        depthScale: gl.getUniformLocation(program, "uDepthScale"),
        baseColor: gl.getUniformLocation(program, "uBaseColor"),
      },
      mesh: null,
      count: 0,
    };
    webglStates.set(canvas, state);
    return state;
  }

  function hexColorFloat(hex) {
    return hexToRgb(hex).map((value) => value / 255);
  }

  function renderWebGL(canvas, sample, topology, yaw = -0.68, options = {}) {
    if (!canvas || !sample || !topology) return false;
    let state = webglStates.get(canvas);
    if (!state) state = createWebGLState(canvas);
    if (!state) return false;
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, options.pixelRatio || 2);
    const targetWidth = Math.round(width * pixelRatio);
    const targetHeight = Math.round(height * pixelRatio);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    const geometry = geometryCache.get(sample) || makeGeometry(sample, topology);
    geometryCache.set(sample, geometry);
    const viewResolution = options.surfaceResolution || 48;
    const geometryExtent = geometry.nodes.reduce(
      (maximum, node) => Math.max(maximum, Math.abs(node[0]), Math.abs(node[1]), Math.abs(node[2])),
      1,
    );
    const viewExtent = Math.max(1.4, geometryExtent + Math.max(0, sample.radius) + 2 / viewResolution);
    const rotationMatrix = resolveRotationMatrix(options.rotation, yaw, 0.56);
    const viewWorld = [];
    for (const x of [-viewExtent, viewExtent]) for (const y of [-viewExtent, viewExtent]) for (const z of [-viewExtent, viewExtent]) {
      viewWorld.push(rotateByMatrix([x, y, z], rotationMatrix));
    }
    const maxX = Math.max(...viewWorld.map((point) => Math.abs(point[0])));
    const maxY = Math.max(...viewWorld.map((point) => Math.abs(point[1])));
    const scale = Math.min((width * 0.77) / (2 * maxX), (height * 0.77) / (2 * maxY));
    const baseResolution = options.surfaceResolution || 48;
    const radiusResolution = options.adaptiveResolution === false
      ? baseResolution
      : (sample.radius > 0 ? Math.ceil(3 / sample.radius) : baseResolution);
    const resolution = Math.min(options.maxSurfaceResolution || 64, Math.max(baseResolution, radiusResolution));
    const mesh = extractSurface(geometry, sample.radius, resolution, options.paddingVoxels ?? 1);
    if (state.mesh !== mesh) {
      const vertices = new Float32Array(mesh.triangles.length * 18);
      let offset = 0;
      for (const triangle of mesh.triangles) {
        for (const point of triangle.points) {
          vertices[offset++] = point[0]; vertices[offset++] = point[1]; vertices[offset++] = point[2];
          vertices[offset++] = triangle.normal[0]; vertices[offset++] = triangle.normal[1]; vertices[offset++] = triangle.normal[2];
        }
      }
      state.gl.bindBuffer(state.gl.ARRAY_BUFFER, state.buffer);
      state.gl.bufferData(state.gl.ARRAY_BUFFER, vertices, state.gl.STATIC_DRAW);
      state.mesh = mesh;
      state.count = vertices.length / 6;
    }
    const gl = state.gl;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.027, 0.075, 0.13, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(state.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
    gl.enableVertexAttribArray(state.attributes.position);
    gl.enableVertexAttribArray(state.attributes.normal);
    gl.vertexAttribPointer(state.attributes.position, 3, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(state.attributes.normal, 3, gl.FLOAT, false, 24, 12);
    gl.uniformMatrix3fv(state.uniforms.rotation, false, new Float32Array(rotationMatrix));
    gl.uniform1f(state.uniforms.scaleX, scale / (width / 2));
    gl.uniform1f(state.uniforms.scaleY, scale / (height / 2));
    gl.uniform1f(state.uniforms.depthScale, 1 / (2 * viewExtent));
    gl.uniform3fv(state.uniforms.baseColor, hexColorFloat(options.surfaceColor?.body || "#f08a24"));
    gl.drawArrays(gl.TRIANGLES, 0, state.count);
    return true;
  }

  window.TrussGeometry = { render, renderWebGL, makeGeometry };
})();
