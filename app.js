/* CarJam web app — image tracing + auto-detect + ranking visualization.
 * Pure ranking logic lives in ranking.js (window.CarJamRanking). This file is
 * UI only, so the engine can grow new use cases independently. */
(function () {
  'use strict';

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const statusEl = document.getElementById('status');

  const DIR_VEC = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
  const DIR_GLYPH = { up: '↑', down: '↓', left: '←', right: '→' };

  /* ----------------------------- App state ------------------------------ */
  const state = {
    img: null, // HTMLImageElement
    grid: { rows: 10, cols: 12 },
    area: null, // {x,y,w,h} in canvas px — the parking grid bounding box
    vehicles: [], // {id,r0,c0,r1,c1,dir,color}
    mode: 'select',
    selectedId: null,
    results: null, // last ranking results
    nextId: 1,
    drag: null,
    showGrid: true,
  };

  /* --------------------------- Geometry helpers ------------------------- */
  function cellSize() {
    if (!state.area) return null;
    return { w: state.area.w / state.grid.cols, h: state.area.h / state.grid.rows };
  }
  function cellAt(px, py) {
    if (!state.area) return null;
    const cs = cellSize();
    const c = Math.floor((px - state.area.x) / cs.w);
    const r = Math.floor((py - state.area.y) / cs.h);
    if (r < 0 || c < 0 || r >= state.grid.rows || c >= state.grid.cols) return null;
    return { r, c };
  }
  function cellRect(r, c) {
    const cs = cellSize();
    return { x: state.area.x + c * cs.w, y: state.area.y + r * cs.h, w: cs.w, h: cs.h };
  }
  function canvasPos(evt) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const p = evt.touches ? evt.touches[0] : evt;
    return { x: (p.clientX - rect.left) * sx, y: (p.clientY - rect.top) * sy };
  }
  function vehicleAt(px, py) {
    const cell = cellAt(px, py);
    if (!cell) return null;
    // last drawn wins (topmost)
    for (let i = state.vehicles.length - 1; i >= 0; i--) {
      const v = state.vehicles[i];
      if (cell.r >= v.r0 && cell.r <= v.r1 && cell.c >= v.c0 && cell.c <= v.c1) return v;
    }
    return null;
  }
  function getSelected() {
    return state.vehicles.find((v) => v.id === state.selectedId) || null;
  }

  /* ------------------------------ Rendering ----------------------------- */
  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (state.img) {
      ctx.globalAlpha = 1;
      ctx.drawImage(state.img, 0, 0, canvas.width, canvas.height);
    }

    if (state.area) {
      // dim outside area slightly
      ctx.save();
      ctx.strokeStyle = '#ffffffcc';
      ctx.lineWidth = 2;
      ctx.strokeRect(state.area.x, state.area.y, state.area.w, state.area.h);

      if (state.showGrid) {
        const cs = cellSize();
        ctx.strokeStyle = '#ffffff33';
        ctx.lineWidth = 1;
        for (let c = 1; c < state.grid.cols; c++) {
          const x = state.area.x + c * cs.w;
          ctx.beginPath(); ctx.moveTo(x, state.area.y); ctx.lineTo(x, state.area.y + state.area.h); ctx.stroke();
        }
        for (let r = 1; r < state.grid.rows; r++) {
          const y = state.area.y + r * cs.h;
          ctx.beginPath(); ctx.moveTo(state.area.x, y); ctx.lineTo(state.area.x + state.area.w, y); ctx.stroke();
        }
      }
      ctx.restore();
    }

    // vehicles
    for (const v of state.vehicles) drawVehicle(v);

    // active drag preview (area or add)
    if (state.drag && state.drag.preview) {
      const d = state.drag;
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = state.mode === 'area' ? '#ffd166' : '#46d18b';
      ctx.lineWidth = 2;
      ctx.strokeRect(d.preview.x, d.preview.y, d.preview.w, d.preview.h);
      ctx.restore();
    }
  }

  function drawVehicle(v) {
    if (!state.area) return;
    const a = cellRect(v.r0, v.c0);
    const b = cellRect(v.r1, v.c1);
    const x = a.x, y = a.y, w = b.x + b.w - a.x, h = b.y + b.h - a.y;
    const pad = Math.min(w, h) * 0.12;

    ctx.save();
    ctx.fillStyle = (v.color || '#3aa0ff') + 'cc';
    ctx.strokeStyle = v.id === state.selectedId ? '#ffffff' : '#00000066';
    ctx.lineWidth = v.id === state.selectedId ? 3 : 1.5;
    roundRect(x + pad, y + pad, w - 2 * pad, h - 2 * pad, Math.min(w, h) * 0.18);
    ctx.fill();
    ctx.stroke();

    // direction arrow
    const cx = x + w / 2, cy = y + h / 2;
    const arrowLen = Math.min(w, h) * 0.55;
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.08);
    drawArrow(cx, cy, v.dir, arrowLen);

    // rank badge if available
    if (state.results) {
      const res = state.results.find((r) => r.id === v.id);
      if (res) {
        const bx = x + w - pad - 2, by = y + pad + 2;
        const rad = Math.min(w, h) * 0.2 + 6;
        ctx.beginPath();
        ctx.arc(bx, by, rad, 0, Math.PI * 2);
        ctx.fillStyle = res.rank === 1 ? '#ff5b6e' : '#0f1226dd';
        ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff'; ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.round(rad)}px system-ui`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(res.rank), bx, by + 1);
      }
    }
    ctx.restore();
  }

  function drawArrow(cx, cy, dir, len) {
    const [dr, dc] = DIR_VEC[dir];
    const ex = cx + dc * len / 2, ey = cy + dr * len / 2;
    const sx = cx - dc * len / 2, sy = cy - dr * len / 2;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    const head = len * 0.3;
    // perpendicular
    const px = -dr, py = dc;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - dc * head + px * head * 0.6, ey - dr * head + py * head * 0.6);
    ctx.lineTo(ex - dc * head - px * head * 0.6, ey - dr * head - py * head * 0.6);
    ctx.closePath();
    ctx.fill();
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ------------------------------ Pointer ------------------------------- */
  function onDown(evt) {
    evt.preventDefault();
    const p = canvasPos(evt);

    if (state.mode === 'area') {
      state.drag = { type: 'area', start: p, preview: { x: p.x, y: p.y, w: 0, h: 0 } };
    } else if (state.mode === 'add') {
      if (!state.area) { setStatus('Set the grid area first.'); return; }
      const cell = cellAt(p.x, p.y);
      if (!cell) return;
      state.drag = { type: 'add', startCell: cell, preview: cellRect(cell.r, cell.c) };
    } else {
      // select
      const v = vehicleAt(p.x, p.y);
      state.selectedId = v ? v.id : null;
      syncSelectedBar();
      render();
    }
  }

  function onMove(evt) {
    if (!state.drag) return;
    evt.preventDefault();
    const p = canvasPos(evt);
    const d = state.drag;
    if (d.type === 'area') {
      d.preview = normRect(d.start, p);
    } else if (d.type === 'add') {
      const cell = cellAt(p.x, p.y) || d.startCell;
      const r0 = Math.min(d.startCell.r, cell.r), r1 = Math.max(d.startCell.r, cell.r);
      const c0 = Math.min(d.startCell.c, cell.c), c1 = Math.max(d.startCell.c, cell.c);
      const a = cellRect(r0, c0), b = cellRect(r1, c1);
      d.cells = { r0, c0, r1, c1 };
      d.preview = { x: a.x, y: a.y, w: b.x + b.w - a.x, h: b.y + b.h - a.y };
    }
    render();
  }

  function onUp(evt) {
    if (!state.drag) return;
    const d = state.drag;
    if (d.type === 'area') {
      const r = d.preview;
      if (r.w > 10 && r.h > 10) { state.area = r; setStatus('Grid area set. Add vehicles or auto-detect.'); }
    } else if (d.type === 'add' && d.cells) {
      const { r0, c0, r1, c1 } = d.cells;
      const dir = r1 - r0 >= c1 - c0 ? 'up' : 'left'; // default along long axis
      const color = state.img ? sampleColor(r0, c0, r1, c1) : randomColor();
      const v = { id: state.nextId++, r0, c0, r1, c1, dir, color };
      state.vehicles.push(v);
      state.selectedId = v.id;
      state.results = null;
      syncSelectedBar();
      setStatus(`Added vehicle #${v.id}. Set its arrow direction.`);
    }
    state.drag = null;
    render();
  }

  function normRect(a, b) {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
  }

  /* --------------------------- Color sampling --------------------------- */
  function sampleColor(r0, c0, r1, c1) {
    try {
      const rect = (() => { const a = cellRect(r0, c0), b = cellRect(r1, c1); return { x: a.x, y: a.y, w: b.x + b.w - a.x, h: b.y + b.h - a.y }; })();
      const cx = Math.round(rect.x + rect.w / 2), cy = Math.round(rect.y + rect.h / 2);
      const data = ctx.getImageData(cx, cy, 1, 1).data;
      return rgbToHex(data[0], data[1], data[2]);
    } catch (e) {
      return randomColor();
    }
  }
  function cellColor(r, c) {
    const rect = cellRect(r, c);
    const cx = Math.round(rect.x + rect.w / 2), cy = Math.round(rect.y + rect.h / 2);
    const d = ctx.getImageData(cx, cy, 1, 1).data;
    return [d[0], d[1], d[2]];
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  function randomColor() {
    const h = Math.floor(Math.random() * 360);
    return `hsl(${h},70%,55%)`;
  }
  function colorDist(a, b) {
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  }

  /* ----------------------- Auto-detect (best effort) -------------------- */
  // Pixel helpers operating on an ImageData of the grid area.
  function px(d, x, y) {
    x = x < 0 ? 0 : x >= d.width ? d.width - 1 : x | 0;
    y = y < 0 ? 0 : y >= d.height ? d.height - 1 : y | 0;
    const i = (y * d.width + x) * 4;
    return [d.data[i], d.data[i + 1], d.data[i + 2]];
  }
  function avgColor(d, x0, y0, x1, y1) {
    x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0);
    x1 = Math.min(d.width, x1 | 0); y1 = Math.min(d.height, y1 | 0);
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) { const i = (y * d.width + x) * 4; r += d.data[i]; g += d.data[i + 1]; b += d.data[i + 2]; n++; }
    return n ? [r / n | 0, g / n | 0, b / n | 0] : [0, 0, 0];
  }
  // Most common coarse-quantized color in a region — robust "body" color.
  function dominantColor(d, x0, y0, x1, y1) {
    x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0);
    x1 = Math.min(d.width, x1 | 0); y1 = Math.min(d.height, y1 | 0);
    const hist = new Map();
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * d.width + x) * 4;
        const k = (d.data[i] >> 4) + ',' + (d.data[i + 1] >> 4) + ',' + (d.data[i + 2] >> 4);
        const e = hist.get(k);
        if (e) { e.n++; e.r += d.data[i]; e.g += d.data[i + 1]; e.b += d.data[i + 2]; }
        else hist.set(k, { n: 1, r: d.data[i], g: d.data[i + 1], b: d.data[i + 2] });
      }
    let best = null;
    for (const e of hist.values()) if (!best || e.n > best.n) best = e;
    return best ? [best.r / best.n | 0, best.g / best.n | 0, best.b / best.n | 0] : [0, 0, 0];
  }

  // Infer the arrow direction for one vehicle by analysing the contrasting
  // "marker" pixels (the printed arrow) inside its box: the tip is the narrow
  // end of the marker along the vehicle's long axis. Falls back to the side
  // with the most open space when no clear marker is found.
  function detectArrowDir(d, v, cw, ch, isBg) {
    const x0 = v.c0 * cw, y0 = v.r0 * ch, x1 = (v.c1 + 1) * cw, y1 = (v.r1 + 1) * ch;
    const W = Math.max(1, Math.round(x1 - x0)), H = Math.max(1, Math.round(y1 - y0));
    const body = dominantColor(d, x0, y0, x1, y1);
    const MT = 95; // contrast needed to count as arrow marker

    const colCnt = new Array(W).fill(0), rowCnt = new Array(H).fill(0);
    let total = 0, xmin = W, xmax = -1, ymin = H, ymax = -1;
    for (let yy = 0; yy < H; yy++) {
      for (let xx = 0; xx < W; xx++) {
        const p = px(d, (x0 | 0) + xx, (y0 | 0) + yy);
        if (colorDist(p, body) > MT) {
          colCnt[xx]++; rowCnt[yy]++; total++;
          if (xx < xmin) xmin = xx; if (xx > xmax) xmax = xx;
          if (yy < ymin) ymin = yy; if (yy > ymax) ymax = yy;
        }
      }
    }

    const wCells = v.c1 - v.c0, hCells = v.r1 - v.r0;
    let horizontal;
    if (wCells !== hCells) horizontal = wCells > hCells;       // long axis of the body
    else horizontal = (xmax - xmin) >= (ymax - ymin);          // square: marker spread

    // Average marker thickness near each end of the long axis; tip = thinner end.
    const endAvg = (arr, lo, hi) => {
      let s = 0, n = 0;
      for (let i = Math.max(0, lo | 0); i < Math.min(arr.length, hi | 0); i++) { s += arr[i]; n++; }
      return n ? s / n : 0;
    };
    const enough = total >= Math.max(20, (W * H) * 0.02);
    if (enough) {
      if (horizontal) {
        const span = Math.max(1, xmax - xmin), q = Math.max(2, span * 0.3);
        const left = endAvg(colCnt, xmin, xmin + q), right = endAvg(colCnt, xmax - q, xmax + 1);
        if (Math.abs(left - right) > 0.15 * Math.max(left, right)) return right < left ? 'right' : 'left';
      } else {
        const span = Math.max(1, ymax - ymin), q = Math.max(2, span * 0.3);
        const top = endAvg(rowCnt, ymin, ymin + q), bot = endAvg(rowCnt, ymax - q, ymax + 1);
        if (Math.abs(top - bot) > 0.15 * Math.max(top, bot)) return bot < top ? 'down' : 'up';
      }
    }

    // Fallback: point toward the longer run of open cells along the long axis.
    const openRun = (dr, dc) => {
      let n = 0, r = (dr < 0 ? v.r0 : v.r1) + dr, c = (dc < 0 ? v.c0 : v.c1) + dc;
      while (r >= 0 && c >= 0 && r < state.grid.rows && c < state.grid.cols && isBg(r, c)) { n++; r += dr; c += dc; }
      return n;
    };
    if (horizontal) return openRun(0, 1) >= openRun(0, -1) ? 'right' : 'left';
    return openRun(1, 0) >= openRun(-1, 0) ? 'down' : 'up';
  }

  // Groups orthogonally-adjacent cells of similar colour into vehicles, then
  // infers each vehicle's arrow direction. Still best-effort — review & fix.
  function autoDetect() {
    if (!state.img) { setStatus('Upload an image first.'); return; }
    if (!state.area) { setStatus('Set the grid area first.'); return; }

    const { rows, cols } = state.grid;
    // Render fresh image, then read the whole grid area once.
    ctx.drawImage(state.img, 0, 0, canvas.width, canvas.height);
    const a = state.area;
    const d = ctx.getImageData(Math.round(a.x), Math.round(a.y), Math.round(a.w), Math.round(a.h));
    const cw = d.width / cols, ch = d.height / rows;

    // Robust per-cell colour: average of the central 40% of each cell.
    const colors = [];
    for (let r = 0; r < rows; r++) {
      colors[r] = [];
      for (let c = 0; c < cols; c++)
        colors[r][c] = avgColor(d, c * cw + cw * 0.3, r * ch + ch * 0.3, c * cw + cw * 0.7, r * ch + ch * 0.7);
    }

    // Background = most common quantized colour among the border cells (the
    // road/empty space usually frames the grid), falling back to the global mode.
    const tally = (cells) => {
      const bins = new Map();
      for (const [r, c] of cells) {
        const k = colors[r][c].map((x) => x >> 5).join(',');
        bins.set(k, (bins.get(k) || 0) + 1);
      }
      let key = null, max = -1;
      for (const [k, n] of bins) if (n > max) { max = n; key = k; }
      return key;
    };
    const border = [];
    for (let c = 0; c < cols; c++) { border.push([0, c]); border.push([rows - 1, c]); }
    for (let r = 0; r < rows; r++) { border.push([r, 0]); border.push([r, cols - 1]); }
    const all = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) all.push([r, c]);
    const bgKey = tally(border) || tally(all);
    const isBg = (r, c) => colors[r][c].map((x) => x >> 5).join(',') === bgKey;

    const THRESH = 60; // colour distance for "same vehicle"
    const seen = Array.from({ length: rows }, () => new Array(cols).fill(false));
    const found = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (seen[r][c] || isBg(r, c)) continue;
        const base = colors[r][c];
        const q = [[r, c]], group = [];
        seen[r][c] = true;
        while (q.length) {
          const [cr, cc] = q.pop();
          group.push([cr, cc]);
          for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nr = cr + dr, nc = cc + dc;
            if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
            if (seen[nr][nc] || isBg(nr, nc)) continue;
            if (colorDist(base, colors[nr][nc]) <= THRESH) { seen[nr][nc] = true; q.push([nr, nc]); }
          }
        }
        let r0 = rows, c0 = cols, r1 = 0, c1 = 0;
        for (const [gr, gc] of group) { r0 = Math.min(r0, gr); c0 = Math.min(c0, gc); r1 = Math.max(r1, gr); c1 = Math.max(c1, gc); }
        found.push({ r0, c0, r1, c1, color: rgbToHex(base[0], base[1], base[2]), size: group.length });
      }
    }

    state.vehicles = found
      .filter((g) => g.size >= 1)
      .map((g) => {
        const v = { id: state.nextId++, r0: g.r0, c0: g.c0, r1: g.r1, c1: g.c1, color: g.color, dir: 'up' };
        v.dir = detectArrowDir(d, v, cw, ch, isBg);
        return v;
      });
    state.results = null;
    state.selectedId = null;
    syncSelectedBar();
    render();
    setStatus(`Auto-detected ${state.vehicles.length} vehicle(s) with guessed directions. ⚠️ Verify the arrows, then Rank.`);
  }

  /* ------------------------------ Ranking ------------------------------- */
  function runRank() {
    if (!state.vehicles.length) { setStatus('No vehicles to rank.'); return; }
    state.results = window.CarJamRanking.rank(state.vehicles, state.grid);
    renderResults();
    render();
    setStatus('Ranked! Rank 1 (red badge) is the most blocked.');
  }

  // Export the photo with every vehicle's rank drawn on it, as a new PNG.
  function downloadRankedImage() {
    if (!state.vehicles.length) { setStatus('Add vehicles first.'); return; }
    if (!state.results) runRank(); // ensure all vehicles are ranked before export
    if (!state.results) return;

    // Render a clean frame: no grid lines, no selection highlight, no drag preview.
    const savedSel = state.selectedId, savedGrid = state.showGrid, savedDrag = state.drag;
    state.selectedId = null; state.showGrid = false; state.drag = null;
    render();
    let url;
    try {
      url = canvas.toDataURL('image/png');
    } catch (e) {
      setStatus('Could not export (image security restriction). Serve the page over http and retry.');
    }
    state.selectedId = savedSel; state.showGrid = savedGrid; state.drag = savedDrag;
    render();
    if (!url) return;

    const a = document.createElement('a');
    a.href = url;
    a.download = 'carjam-ranked.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setStatus(`Saved ranked image for ${state.results.length} vehicle(s) as carjam-ranked.png`);
  }

  function renderResults() {
    const list = document.getElementById('resultsList');
    const hint = document.getElementById('resultsHint');
    list.innerHTML = '';
    if (!state.results) { hint.hidden = false; return; }
    hint.hidden = true;
    const sorted = [...state.results].sort((a, b) => a.rank - b.rank || a.id - b.id);
    for (const res of sorted) {
      const li = document.createElement('li');
      li.className = 'result-item' + (res.rank === 1 ? ' rank-1' : '');
      li.innerHTML = `
        <span class="rank-badge">${res.rank}</span>
        <span class="swatch" style="background:${res.color || '#888'}"></span>
        <span>
          <strong>Vehicle #${res.id}</strong> ${DIR_GLYPH[res.dir] || ''}
          <div class="result-meta">
            depends on <strong>${res.score}</strong> vehicle(s)
            · direct blockers: <strong>${res.directBlockers.length}</strong>
            ${res.free ? '· <span style="color:#46d18b">free to move</span>' : ''}
          </div>
        </span>`;
      li.addEventListener('click', () => { state.selectedId = res.id; syncSelectedBar(); render(); });
      list.appendChild(li);
    }
  }

  /* ------------------------------ UI wiring ----------------------------- */
  function setStatus(msg) { statusEl.textContent = msg; }

  function setMode(m) {
    state.mode = m;
    document.querySelectorAll('.mode').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
    canvas.style.cursor = m === 'select' ? 'pointer' : 'crosshair';
  }

  function syncSelectedBar() {
    const bar = document.getElementById('selectedBar');
    const v = getSelected();
    bar.hidden = !v;
    if (v) {
      document.getElementById('vColor').value = toHexColor(v.color);
      document.querySelectorAll('.dir').forEach((b) => b.classList.toggle('active', b.dataset.dir === v.dir));
    }
  }
  function toHexColor(c) {
    if (!c) return '#3aa0ff';
    if (c[0] === '#' && c.length === 7) return c;
    // resolve hsl/named via canvas
    const t = document.createElement('canvas').getContext('2d');
    t.fillStyle = c; t.fillRect(0, 0, 1, 1);
    const d = t.getImageData(0, 0, 1, 1).data;
    return rgbToHex(d[0], d[1], d[2]);
  }

  function loadImage(file) {
    const img = new Image();
    img.onload = () => {
      // fit into a max canvas while preserving aspect
      const maxW = 1000, maxH = 760;
      let { width, height } = img;
      const scale = Math.min(maxW / width, maxH / height, 1);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      state.img = img;
      state.area = null;
      state.vehicles = [];
      state.results = null;
      renderResults();
      render();
      setStatus('Image loaded. Set rows/cols, then "Set grid area" and drag a box over the grid.');
    };
    img.src = URL.createObjectURL(file);
  }

  /* ------------------------------ Events -------------------------------- */
  document.getElementById('fileInput').addEventListener('change', (e) => {
    if (e.target.files[0]) loadImage(e.target.files[0]);
  });
  document.getElementById('rows').addEventListener('change', (e) => { state.grid.rows = Math.max(1, +e.target.value | 0); state.results = null; render(); });
  document.getElementById('cols').addEventListener('change', (e) => { state.grid.cols = Math.max(1, +e.target.value | 0); state.results = null; render(); });
  document.getElementById('showGrid').addEventListener('change', (e) => { state.showGrid = e.target.checked; render(); });

  document.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.getElementById('autoDetect').addEventListener('click', autoDetect);
  document.getElementById('rankBtn').addEventListener('click', runRank);
  document.getElementById('downloadBtn').addEventListener('click', downloadRankedImage);
  document.getElementById('clearBtn').addEventListener('click', () => {
    state.vehicles = []; state.results = null; state.selectedId = null;
    syncSelectedBar(); renderResults(); render(); setStatus('Cleared all vehicles.');
  });

  document.querySelectorAll('.dir').forEach((b) => b.addEventListener('click', () => setDir(b.dataset.dir)));
  document.getElementById('vColor').addEventListener('input', (e) => { const v = getSelected(); if (v) { v.color = e.target.value; render(); } });
  document.getElementById('deleteVehicle').addEventListener('click', () => {
    const v = getSelected(); if (!v) return;
    state.vehicles = state.vehicles.filter((x) => x.id !== v.id);
    state.selectedId = null; state.results = null;
    syncSelectedBar(); renderResults(); render();
  });

  function setDir(dir) {
    const v = getSelected(); if (!v) return;
    v.dir = dir; state.results = null;
    document.querySelectorAll('.dir').forEach((b) => b.classList.toggle('active', b.dataset.dir === dir));
    render();
  }
  window.addEventListener('keydown', (e) => {
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (map[e.key] && getSelected()) { e.preventDefault(); setDir(map[e.key]); }
  });

  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('touchstart', onDown, { passive: false });
  canvas.addEventListener('touchmove', onMove, { passive: false });
  canvas.addEventListener('touchend', onUp);

  setMode('select');
  render();
})();
