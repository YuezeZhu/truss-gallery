/* Projection-only gallery renderer. Source geometry comes from data/samples.json. */
(() => {
  const palette = {
    panetta: { body: "#6bc7ea", light: "#b7eaff", shade: "#296a86" },
    eth: { body: "#dca06f", light: "#ffcf9f", shade: "#83533c" },
  };

  function makeGeometry(sample, topology) {
    const nodes = topology.nodes.map((point) => point.slice());
    for (const [index, dx, dy, dz] of sample.node_displacements) {
      nodes[index][0] += dx;
      nodes[index][1] += dy;
      nodes[index][2] += dz;
    }
    if (sample.source !== "eth") return { nodes, edges: topology.edges };

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

  function render(canvas, sample, topology, yaw = -0.68) {
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
    const projected = geometry.nodes.map(project);
    const edges = geometry.edges.map(([a, b]) => ({ a: projected[a], b: projected[b] }));
    edges.sort((left, right) => (left.a[2] + left.b[2]) - (right.a[2] + right.b[2]));
    const color = palette[sample.source];
    const thickness = Math.max(2.5, 2 * sample.radius * scale);

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const { a, b } of edges) {
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      ctx.lineWidth = thickness + 2;
      ctx.strokeStyle = color.shade;
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      ctx.lineWidth = thickness;
      ctx.strokeStyle = color.body;
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(a[0] - thickness * 0.1, a[1] - thickness * 0.16);
      ctx.lineTo(b[0] - thickness * 0.1, b[1] - thickness * 0.16);
      ctx.lineWidth = Math.max(1, thickness * 0.25);
      ctx.strokeStyle = color.light;
      ctx.globalAlpha = 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    return geometry.edges.length;
  }

  window.TrussGeometry = { render, makeGeometry };
})();
