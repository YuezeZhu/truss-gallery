(() => {
  const number = new Intl.NumberFormat("zh-CN");
  const els = {
    state: document.querySelector("#live-state"),
    count: document.querySelector("#live-count"),
    percent: document.querySelector("#live-percent"),
    eta: document.querySelector("#live-eta"),
    progress: document.querySelector("#live-progress"),
    foot: document.querySelector("#live-foot"),
    bins: document.querySelector("#live-bins"),
    results: document.querySelector("#live-results"),
    refreshed: document.querySelector("#live-refreshed"),
  };
  let shownNewest = null;

  function formatMetric(value) {
    if (!Number.isFinite(value)) return "—";
    if (value !== 0 && Math.abs(value) < 0.001) return value.toExponential(2);
    return value.toFixed(4);
  }

  function formatEta(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "估算中";
    const hours = Math.ceil(seconds / 3600);
    if (hours >= 48) return `约 ${(hours / 24).toFixed(1)} 天`;
    if (hours >= 1) return `约 ${hours} 小时`;
    return `约 ${Math.max(1, Math.ceil(seconds / 60))} 分钟`;
  }

  function fullMatrix(upper, size) {
    const matrix = Array.from({ length: size }, () => Array(size).fill(0));
    let cursor = 0;
    for (let row = 0; row < size; row++) for (let col = row; col < size; col++) {
      matrix[row][col] = matrix[col][row] = upper[cursor++];
    }
    return matrix.map((row) => row.map((value) => value.toExponential(3).padStart(11)).join(" ")).join("\n");
  }

  function metric(parent, label, value) {
    const cell = document.createElement("div");
    const name = document.createElement("span");
    name.textContent = label;
    const amount = document.createElement("strong");
    amount.textContent = value;
    cell.append(name, amount);
    parent.append(cell);
  }

  function latestCard(entry) {
    const { sample, topology } = entry;
    const article = document.createElement("article");
    article.className = "live-card";
    const heading = document.createElement("div");
    heading.className = "live-card-head";
    const id = document.createElement("strong");
    id.textContent = sample.id;
    const source = document.createElement("span");
    source.textContent = sample.source === "eth" ? "ETH" : "Panetta";
    heading.append(id, source);
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${sample.id} 的三维点阵骨架`);
    const facts = document.createElement("div");
    facts.className = "live-card-data";
    metric(facts, "体积分数", `${(sample.quality.relative_density * 100).toFixed(2)}%`);
    metric(facts, "C₁₁", formatMetric(sample.C_H_upper[0]));
    metric(facts, "C₄₄", formatMetric(sample.C_H_upper[15]));
    metric(facts, "Kₓₓ", formatMetric(sample.K_H_upper[0]));
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "完整 Cₕ / Kₕ 张量与参数";
    const table = document.createElement("pre");
    table.textContent = `C_H [xx, yy, zz, xy, yz, zx]\n${fullMatrix(sample.C_H_upper, 6)}\n\nK_H [x, y, z]\n${fullMatrix(sample.K_H_upper, 3)}\n\n半径 ${sample.radius.toFixed(6)} · 移动节点 ${sample.node_displacements.length} · 周期面对齐`;
    details.append(summary, table);
    article.append(heading, canvas, facts, details);
    let yaw = -0.68;
    let lastX = null;
    canvas.addEventListener("pointerdown", (event) => {
      lastX = event.clientX;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (lastX === null) return;
      yaw += (event.clientX - lastX) * 0.012;
      lastX = event.clientX;
      window.TrussGeometry.render(canvas, sample, topology, yaw);
    });
    canvas.addEventListener("pointerup", () => { lastX = null; });
    canvas.addEventListener("pointercancel", () => { lastX = null; });
    return { article, canvas, sample, topology, yaw };
  }

  function show(payload) {
    const goal = payload.goal || 100000;
    const accepted = payload.accepted || 0;
    const percent = accepted / goal * 100;
    const updated = payload.updated_at ? new Date(payload.updated_at) : null;
    const stale = updated && Date.now() - updated.getTime() > 120000;
    const labels = { running: "正在生成", paused: "已暂停，可续跑", complete: "全部完成", error: "生成遇到问题", preparing: "正在准备" };
    const status = stale && payload.status === "running" ? "stale" : payload.status;
    els.state.dataset.status = status;
    els.state.textContent = status === "stale" ? "进度暂未更新" : labels[status] || "等待连接";
    els.count.textContent = number.format(accepted);
    els.percent.textContent = `${percent.toFixed(2)}%`;
    els.eta.textContent = payload.status === "complete" ? "已完成" : formatEta(payload.eta_seconds);
    els.progress.max = goal;
    els.progress.value = accepted;
    const speed = payload.samples_per_second ? `${(payload.samples_per_second * 60).toFixed(1)} 条/分钟` : "速度估算中";
    els.foot.textContent = `已尝试 ${number.format(payload.attempts || 0)} 条 · 退回 ${number.format(payload.rejected || 0)} 条 · ${speed} · 仅验收实际体积分数合格、几何不重复且性质求解通过的样本`;
    els.refreshed.textContent = updated ? `更新于 ${updated.toLocaleTimeString("zh-CN", { hour12: false })} · 每 8 秒刷新` : "每 8 秒自动更新";
    els.bins.replaceChildren();
    for (const bin of payload.density_bins || []) {
      const item = document.createElement("div");
      item.className = "generation-bin";
      const range = document.createElement("span");
      range.textContent = `${Math.round(bin.min * 100)}–${Math.round(bin.max * 100)}%`;
      const count = document.createElement("strong");
      count.textContent = number.format(bin.count);
      const bar = document.createElement("i");
      bar.style.setProperty("--filled", `${Math.min(100, bin.count / bin.goal * 100)}%`);
      item.append(range, count, bar);
      els.bins.append(item);
    }
    const newest = payload.latest?.[0]?.sample?.id || null;
    if (newest === shownNewest) return;
    shownNewest = newest;
    els.results.replaceChildren();
    if (!payload.latest?.length) {
      const waiting = document.createElement("p");
      waiting.className = "generation-empty";
      waiting.textContent = "正在等待首批通过校验的样本…";
      els.results.append(waiting);
      return;
    }
    const cards = payload.latest.slice(0, 6).map(latestCard);
    els.results.append(...cards.map((card) => card.article));
    requestAnimationFrame(() => {
      for (const card of cards) window.TrussGeometry.render(card.canvas, card.sample, card.topology, card.yaw);
    });
  }

  async function refresh() {
    try {
      const response = await fetch(`/api/live?at=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      show(await response.json());
    } catch (_) {
      els.state.dataset.status = "error";
      els.state.textContent = "实时进度暂不可用";
      els.foot.textContent = "生成记录仍保存在计算主机；恢复连接后会继续显示。";
    }
  }

  refresh();
  window.setInterval(refresh, 8000);
})();
