(() => {
  // Lightweight public PPL preview. The generated surface OBJ files are large
  // and remain local; this module rebuilds the signed field from the exported
  // skeleton and plate parameters, then extracts its zero isosurface.
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const length = (a) => Math.hypot(a[0], a[1], a[2]);
  const normalize = (a) => {
    const size = length(a) || 1;
    return a.map((value) => value / size);
  };
  const rotate = (vector, angle, axis) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const a = cross(axis, vector);
    const d = dot(axis, vector) * (1 - cos);
    return normalize(vector.map((value, index) =>
      value * cos + a[index] * sin + axis[index] * d));
  };
  const localAxes = (normal) => {
    const nx = [1, 0, 0];
    const ny = [0, 1, 0];
    const nz = [0, 0, 1];
    if (length(cross(normal, nx)) < 1e-3) return [nz, ny];
    if (length(cross(normal, ny)) < 1e-3) return [nx, nz];
    if (length(cross(normal, nz)) < 1e-3) return [ny, nx];
    const px = normalize(cross(normal, nx));
    return [px, cross(px, normal)];
  };

  function plateField(point, plates, symmetry) {
    let x = Math.abs(point[0]);
    let y = Math.abs(point[1]);
    let z = point[2];
    if (symmetry === "one_in_48") {
      z = Math.abs(z);
      const sorted = [x, y, z].sort((a, b) => b - a);
      x = sorted[0];
      y = sorted[1];
      z = sorted[2];
    }
    let response = 0;
    for (const plate of plates) {
      const A = plate.n[0];
      const B = plate.n[1];
      const C = plate.n[2];
      const D = -(A * plate.center[0] + B * plate.center[1] + C * plate.center[2]);
      const distance = Math.abs(x * A + y * B + z * C + D)
        / (Math.hypot(A, B, C) || 1);
      response += Math.exp(-10 * (distance - plate.thickness));
    }
    return -0.1 * Math.log(response || Number.MIN_VALUE);
  }

  function plateFromEdge(nodes, edge, parameters) {
    if (!Array.isArray(nodes?.[edge?.[0]]) || !Array.isArray(nodes?.[edge?.[1]])) {
      throw new Error(`PPL edge ${edge} refers to a missing topology node`);
    }
    const a = nodes[edge[0]];
    const b = nodes[edge[1]];
    let normal = normalize(b.map((value, index) => value - a[index]));
    const [xAxis, yAxis] = localAxes(normal);
    normal = rotate(normal, parameters.alpha, yAxis);
    normal = rotate(normal, parameters.beta, xAxis);
    const start = parameters.start;
    let center;
    if (start === "row_0") center = a;
    else if (start === "row_1") center = b;
    else if (start === "one_third") {
      center = a.map((value, index) => value + (b[index] - value) / 3);
    } else center = a.map((value, index) => (value + b[index]) / 2);
    const translation = Number(parameters.normal_translation || 0);
    center = center.map((value, index) => value + translation * normal[index]);
    return {
      n: normal,
      center,
      thickness: Number(parameters.thickness || 0),
    };
  }

  function marchingCubes(field, resolution) {
    // Each grid cube is divided into six tetrahedra. Every tetrahedron has only
    // two possible cases, which avoids the ambiguous cases in the 256-entry MC
    // lookup tables while producing the same zero isosurface.
    const tetrahedra = [
      [0,5,1,6], [0,1,2,6], [0,2,3,6],
      [0,3,7,6], [0,7,4,6], [0,4,5,6],
    ];
    const corners = [
      [0,0,0],[1,0,0],[1,1,0],[0,1,0],
      [0,0,1],[1,0,1],[1,1,1],[0,1,1],
    ];
    const positions = [];
    const normals = [];
    const cache = new Map();
    const valueAt = (x, y, z) => field[x + resolution * (y + resolution * z)];
    for (let z = 0; z < resolution - 1; z++) {
      for (let y = 0; y < resolution - 1; y++) {
        for (let x = 0; x < resolution - 1; x++) {
          const values = corners.map(([dx,dy,dz]) => valueAt(x+dx, y+dy, z+dz));
          for (const tetrahedron of tetrahedra) {
            const inside = tetrahedron.filter((index) => values[index] < 0);
            const outside = tetrahedron.filter((index) => values[index] >= 0);
            if (!inside.length || !outside.length) continue;
            const edgePoint = (cornerA, cornerB) => {
              const pointA = corners[cornerA];
              const pointB = corners[cornerB];
              const xa = x + pointA[0], ya = y + pointA[1], za = z + pointA[2];
              const xb = x + pointB[0], yb = y + pointB[1], zb = z + pointB[2];
              const key = `${xa},${ya},${za}|${xb},${yb},${zb}`;
              const cached = cache.get(key);
              if (cached) return cached;
              const valueA = values[cornerA];
              const valueB = values[cornerB];
              const t = clamp(valueA / (valueA - valueB), 0, 1);
              const point = [xa + t * (xb - xa), ya + t * (yb - ya), za + t * (zb - za)];
              cache.set(key, point);
              return point;
            };
            const triangles = inside.length === 1
              ? [[edgePoint(inside[0], outside[0]), edgePoint(inside[0], outside[1]), edgePoint(inside[0], outside[2])]]
              : inside.length === 3
                ? [[edgePoint(outside[0], inside[0]), edgePoint(outside[0], inside[1]), edgePoint(outside[0], inside[2])]]
                : [
                  [edgePoint(inside[0], outside[0]), edgePoint(inside[0], outside[1]), edgePoint(inside[1], outside[1])],
                  [edgePoint(inside[0], outside[0]), edgePoint(inside[1], outside[1]), edgePoint(inside[1], outside[0])],
                ];
            for (const triangle of triangles) {
              const [a,b,c] = triangle;
            const u = b.map((value, index) => value - a[index]);
            const v = c.map((value, index) => value - a[index]);
            const normal = normalize(cross(u, v));
            for (const point of triangle) {
              positions.push((point[0] / (resolution - 1)) * 2 - 1,
                (point[1] / (resolution - 1)) * 2 - 1,
                (point[2] / (resolution - 1)) * 2 - 1);
              normals.push(...normal);
            }
          }
          }
        }
      }
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), count: positions.length / 3 };
  }

  function plateParameters(variant, edgeCount) {
    const template = Array.isArray(variant.plate_template)
      ? variant.plate_template
      : [
        variant.orientation?.start || "midpoint",
        Number(variant.thickness || 0),
        Number(variant.orientation?.alpha ?? Math.PI / 2),
        Number(variant.orientation?.beta || 0),
        0,
      ];
    const values = Array.from({ length: edgeCount }, () => template.slice());
    for (const override of variant.plate_overrides || []) {
      if (Number(override.edge) < values.length && Array.isArray(override.values)) {
        values[Number(override.edge)] = override.values.slice();
      }
    }
    return values.map(([start, thickness, alpha, beta, normal_translation]) => ({
      start, thickness, alpha, beta, normal_translation,
    }));
  }

  function buildPreview(topology, variant, resolution = 32) {
    // Shell.cpp first rebuilds each topology's 1/48 fundamental domain from
    // panetta_1_in_48_edges using its canonical 15-node lattice, then scales
    // those coordinates by celllength / 2. topology.points contains the fully
    // expanded cell and is intentionally not used for this field.
    const edges = variant.plate_edges || [];
    if (!edges.length) throw new Error("Topology has no skeleton edges");
    const baseNodes = [
      [0,0,0],[1,0,0],[1,1,0],[1,1,1],[0.5,0,0],
      [0.5,0.5,0],[0.5,0.5,0.5],[1,0.5,0],[1,0.5,0.5],[1,1,0.5],
      [2/3,1/3,0],[2/3,1/3,1/3],[1,2/3,1/3],[2/3,2/3,1/3],[0.75,0.5,0.25],
    ];
    // PPL stores plate thickness and normal translation in its 20-unit cell.
    // Keep those values in the same units while sampling the signed field.
    const nodes = baseNodes.map((point) => point.map((value) => value * 10));
    const parameters = plateParameters(variant, edges.length);
    const plates = edges.map((edge, index) => plateFromEdge(nodes, edge, parameters[index]));
    const minimum = -10.1;
    const maximum = 10.1;
    const step = (maximum - minimum) / (resolution - 1);
    const field = new Float32Array(resolution ** 3);
    const symmetry = variant.symmetry || (variant.source === "panetta" ? "one_in_48" : "octet");
    let offset = 0;
    for (let z = 0; z < resolution; z++) {
      for (let y = 0; y < resolution; y++) {
        for (let x = 0; x < resolution; x++) {
          const point = [minimum + x * step, minimum + y * step, minimum + z * step];
          field[offset++] = Math.abs(point[0]) > 10 || Math.abs(point[1]) > 10 || Math.abs(point[2]) > 10
            ? 100
            : plateField(point, plates, symmetry);
        }
      }
    }
    const mesh = marchingCubes(field, resolution);
    return mesh;
  }

  window.PPLPreview = { buildPreview };
})();
