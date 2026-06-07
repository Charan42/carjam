# 🚗 CarJam — Blocked Vehicle Ranker

A browser app that takes a **parking-jam** image (vehicles packed in a grid,
each with an arrow showing the one direction it can move) and **ranks the
vehicles by how blocked they are**.

- **Rank 1 = the most blocked** vehicle, and so on.
- Vehicles with the **same score share a rank** (dense ranking: 1, 1, 2, 3, 3…).
- A vehicle is **unblocked** when the straight path from its leading edge to the
  edge of the grid, in its arrow direction, is empty.
- A vehicle's **score = how many distinct vehicles it depends on** to escape:
  its direct blockers *plus everything that blocks them*, recursively
  (transitive count). Mutual deadlocks (cycles) are handled — each vehicle is
  counted once.

## Run it

No build step. Just serve the folder and open it:

```bash
cd carjam
python3 -m http.server 8000
# then open http://localhost:8000
```

(Opening `index.html` directly mostly works too, but a local server avoids
browser image/canvas restrictions.)

## How to use

1. **Upload** the puzzle image.
2. Set **Rows** and **Cols** to match the grid, click **📐 Set grid area**, and
   drag a box over the parking grid so the cells line up with the image.
3. Click **✨ Auto-detect** for a rough fill (color-based, *approximate*) — or
   **➕ Add vehicle** and drag across the cells a vehicle occupies.
4. Use **✋ Select / edit** to click a vehicle and set its **arrow direction**
   (buttons or keyboard arrow keys), recolor it, or delete it.
5. Click **🏁 Rank vehicles**. Rank badges appear on the board (red = rank 1)
   and a sorted list shows scores, direct-blocker counts, and free vehicles.

> ⚠️ Auto-detect is a best-effort starting point. It guesses vehicle boxes from
> cell colors and **cannot read arrow directions** — always review the boxes and
> set each direction before ranking.

## Project layout

| File              | Purpose                                                  |
| ----------------- | -------------------------------------------------------- |
| `index.html`      | App shell and controls                                   |
| `styles.css`      | Styling                                                  |
| `app.js`          | UI: image tracing, grid editor, auto-detect, rendering   |
| `ranking.js`      | **Pure ranking engine** (no DOM) — the core logic        |
| `ranking.test.js` | Node tests for the engine (`node ranking.test.js`)       |

## Extending it (kept flexible for future use cases)

The engine in `ranking.js` is deliberately decoupled from the UI and is
**config-driven**, so new puzzles/rules plug in without rewrites:

```js
// Different scoring rules:
CarJamRanking.rank(vehicles, grid, { strategy: 'transitive' }); // default
CarJamRanking.rank(vehicles, grid, { strategy: 'direct' });     // only direct blockers
CarJamRanking.rank(vehicles, grid, { strategy: 'depth' });      // longest move-chain depth

// Custom scorer (gets the blocker graph + direct-blocker map):
CarJamRanking.rank(vehicles, grid, {
  strategy: (id, ctx) => ({ score: ctx.adj.get(id).size, dependsOn: [] }),
});

// Custom "blocking" model — e.g. exit gates, weighted lanes, 2-D sliding —
// by supplying a different path generator:
CarJamRanking.rank(vehicles, grid, {
  pathFn: (vehicle, grid) => [/* [r,c] cells this vehicle must clear */],
});
```

Because vehicles are modeled as arbitrary cell rectangles with a direction,
multi-cell buses, mixed sizes, and any grid dimensions already work.
