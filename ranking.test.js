/* Quick sanity tests for the ranking engine. Run: node ranking.test.js */
const { rank } = require('./ranking.js');

let failures = 0;
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  if (!okk) {
    failures++;
    console.error(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

// ---- The worked example from the chat -------------------------------------
// 5x5 grid.
//  A at (2,0) -> right ; path row2 c1..4 contains B(c1) and C(c2)
//  B at (2,1) -> up    ; path clear
//  C at (2,2) -> down  ; path col2 r3..4 contains D(r3)
//  D at (3,2) -> left  ; path clear
const grid = { rows: 5, cols: 5 };
const vehicles = [
  { id: 'A', r0: 2, c0: 0, r1: 2, c1: 0, dir: 'right' },
  { id: 'B', r0: 2, c0: 1, r1: 2, c1: 1, dir: 'up' },
  { id: 'C', r0: 2, c0: 2, r1: 2, c1: 2, dir: 'down' },
  { id: 'D', r0: 3, c0: 2, r1: 3, c1: 2, dir: 'left' },
];

const res = rank(vehicles, grid);
const by = Object.fromEntries(res.map((r) => [r.id, r]));

eq('A direct blockers', by.A.directBlockers.sort(), ['B', 'C']);
eq('A transitive score', by.A.score, 3); // B, C, D
eq('A dependsOn', by.A.dependsOn.sort(), ['B', 'C', 'D']);
eq('C score', by.C.score, 1); // D
eq('B score', by.B.score, 0);
eq('D score', by.D.score, 0);

eq('A rank', by.A.rank, 1);
eq('C rank', by.C.rank, 2);
eq('B rank', by.B.rank, 3);
eq('D rank', by.D.rank, 3);
eq('B free', by.B.free, true);
eq('A free', by.A.free, false);

// ---- Cycle / deadlock: A blocks B, B blocks A -----------------------------
// A(0,0)->right path has B(0,1); B(0,1)->left path has A(0,0). Mutual.
const g2 = { rows: 1, cols: 2 };
const v2 = [
  { id: 'A', r0: 0, c0: 0, r1: 0, c1: 0, dir: 'right' },
  { id: 'B', r0: 0, c0: 1, r1: 0, c1: 1, dir: 'left' },
];
const r2 = Object.fromEntries(rank(v2, g2).map((r) => [r.id, r]));
eq('cycle A score (B only, self excluded)', r2.A.score, 1);
eq('cycle B score', r2.B.score, 1);
eq('cycle A rank', r2.A.rank, 1);
eq('cycle B rank', r2.B.rank, 1);

// ---- Multi-cell bus path --------------------------------------------------
// Horizontal bus B0 at row0 c0..2 moving right; car X at (0,4). path c3,c4 hits X.
const g3 = { rows: 1, cols: 5 };
const v3 = [
  { id: 'BUS', r0: 0, c0: 0, r1: 0, c1: 2, dir: 'right' },
  { id: 'X', r0: 0, c0: 4, r1: 0, c1: 4, dir: 'up' },
];
const r3 = Object.fromEntries(rank(v3, g3).map((r) => [r.id, r]));
eq('bus blocked by X', r3.BUS.score, 1);
eq('X free', r3.X.free, true);

// ---- Pluggable strategies on the worked example ---------------------------
const dir = Object.fromEntries(rank(vehicles, grid, { strategy: 'direct' }).map((r) => [r.id, r]));
eq('direct strategy A score', dir.A.score, 2); // B, C only
eq('direct strategy C score', dir.C.score, 1); // D

const dep = Object.fromEntries(rank(vehicles, grid, { strategy: 'depth' }).map((r) => [r.id, r]));
eq('depth strategy A score', dep.A.score, 2); // A->C->D is 2 deep
eq('depth strategy C score', dep.C.score, 1); // C->D

// custom strategy + custom pathFn are accepted
const custom = rank(vehicles, grid, { strategy: () => ({ score: 7, dependsOn: [] }) });
eq('custom strategy score', custom[0].score, 7);

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
} else {
  console.log('\nAll tests passed');
}
