/*
 * CarJam ranking engine (pure logic, no DOM).
 *
 * Designed to be EXTENSIBLE — new scoring rules and new "blocking" models can
 * be added without touching the UI:
 *   - SCORERS:   pluggable strategies that turn the blocker graph into a score.
 *   - pathFn:    pluggable definition of which cells a vehicle must clear,
 *                so future use cases (exit gates, multi-step moves, 2-D sliding,
 *                weighted lanes, etc.) just supply a different path generator.
 *
 * Model
 * -----
 * grid:     { rows, cols }
 * vehicle:  { id, r0, c0, r1, c1, dir, color? }   // inclusive cell rectangle
 * dir:      'up' | 'down' | 'left' | 'right'
 *
 * Default rule: a vehicle is "unblocked" when the straight path from its
 * leading edge to the grid edge (in its arrow direction) is empty. Any vehicle
 * in that path is a *direct blocker*.
 *
 * Default scoring ('transitive'): score = number of DISTINCT vehicles in the
 * full dependency closure (direct blockers + theirs, recursively), self
 * excluded. Cycles are handled (each vehicle counted once).
 *
 * Rank: highest score = rank 1. Equal scores share a rank (dense ranking).
 */
(function (global) {
  'use strict';

  /* ----------------------------- Geometry ------------------------------- */
  function cellsOf(v) {
    const cells = [];
    for (let r = v.r0; r <= v.r1; r++)
      for (let c = v.c0; c <= v.c1; c++) cells.push([r, c]);
    return cells;
  }

  // Default path model: straight line in the arrow direction to the grid edge.
  function directionalPath(v, grid) {
    const path = [];
    switch (v.dir) {
      case 'right':
        for (let r = v.r0; r <= v.r1; r++)
          for (let c = v.c1 + 1; c < grid.cols; c++) path.push([r, c]);
        break;
      case 'left':
        for (let r = v.r0; r <= v.r1; r++)
          for (let c = v.c0 - 1; c >= 0; c--) path.push([r, c]);
        break;
      case 'down':
        for (let c = v.c0; c <= v.c1; c++)
          for (let r = v.r1 + 1; r < grid.rows; r++) path.push([r, c]);
        break;
      case 'up':
        for (let c = v.c0; c <= v.c1; c++)
          for (let r = v.r0 - 1; r >= 0; r--) path.push([r, c]);
        break;
    }
    return path;
  }

  function buildOccupancy(vehicles) {
    const occ = new Map(); // "r,c" -> id
    for (const v of vehicles)
      for (const [r, c] of cellsOf(v)) occ.set(r + ',' + c, v.id);
    return occ;
  }

  function directBlockers(v, grid, occ, pathFn) {
    const out = new Set();
    for (const [r, c] of pathFn(v, grid)) {
      const id = occ.get(r + ',' + c);
      if (id !== undefined && id !== v.id) out.add(id);
    }
    return out;
  }

  /* ----------------------------- Graph utils ---------------------------- */
  function reachable(startId, adj) {
    const seen = new Set();
    const stack = [...(adj.get(startId) || [])];
    while (stack.length) {
      const id = stack.pop();
      if (id === startId || seen.has(id)) continue;
      seen.add(id);
      for (const next of adj.get(id) || [])
        if (next !== startId && !seen.has(next)) stack.push(next);
    }
    return seen;
  }

  // Longest simple-chain depth from a node, cycle-safe. On a cycle, falls back
  // to the reachable-set size so deadlocked vehicles still score high.
  function longestDepth(startId, adj) {
    const memo = new Map();
    const onStack = new Set();
    let cyclic = false;
    function dfs(id) {
      if (memo.has(id)) return memo.get(id);
      if (onStack.has(id)) { cyclic = true; return 0; }
      onStack.add(id);
      let best = 0;
      for (const n of adj.get(id) || []) best = Math.max(best, 1 + dfs(n));
      onStack.delete(id);
      memo.set(id, best);
      return best;
    }
    const d = dfs(startId);
    return cyclic ? reachable(startId, adj).size : d;
  }

  /* ------------------------------ Scorers ------------------------------- */
  // Each scorer: (vehicleId, ctx) -> { score, dependsOn:[ids] }
  // ctx = { adj, direct }
  const SCORERS = {
    transitive(id, ctx) {
      const deps = reachable(id, ctx.adj);
      return { score: deps.size, dependsOn: [...deps] };
    },
    direct(id, ctx) {
      const db = ctx.direct.get(id);
      return { score: db.size, dependsOn: [...db] };
    },
    depth(id, ctx) {
      return { score: longestDepth(id, ctx.adj), dependsOn: [...reachable(id, ctx.adj)] };
    },
  };

  /* ------------------------------- Rank --------------------------------- */
  /**
   * @param {Array} vehicles
   * @param {{rows:number,cols:number}} grid
   * @param {object} [options]
   *   options.strategy : 'transitive' (default) | 'direct' | 'depth' | custom fn
   *   options.pathFn   : (vehicle, grid) => [[r,c],...]   (default directional)
   * @returns results array aligned with input order.
   */
  function rank(vehicles, grid, options = {}) {
    const pathFn = options.pathFn || directionalPath;
    const scorer = typeof options.strategy === 'function'
      ? options.strategy
      : SCORERS[options.strategy] || SCORERS.transitive;

    const occ = buildOccupancy(vehicles);

    const direct = new Map();
    const adj = new Map();
    for (const v of vehicles) {
      const db = directBlockers(v, grid, occ, pathFn);
      direct.set(v.id, db);
      adj.set(v.id, db);
    }
    const ctx = { adj, direct, grid, vehicles };

    const results = vehicles.map((v) => {
      const { score, dependsOn } = scorer(v.id, ctx);
      return {
        id: v.id,
        color: v.color,
        dir: v.dir,
        directBlockers: [...direct.get(v.id)],
        dependsOn,
        score,
        free: direct.get(v.id).size === 0,
        rank: 0,
      };
    });

    // Dense ranking by score descending.
    let rankNo = 0, prev = null;
    for (const res of [...results].sort((a, b) => b.score - a.score)) {
      if (prev === null || res.score !== prev) { rankNo += 1; prev = res.score; }
      res.rank = rankNo;
    }
    return results;
  }

  const api = {
    rank, SCORERS, directionalPath, directBlockers,
    cellsOf, buildOccupancy, reachable, longestDepth,
    // alias kept for back-compat with earlier callers
    pathCells: directionalPath,
  };

  global.CarJamRanking = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
