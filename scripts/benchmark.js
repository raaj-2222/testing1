// Run: npm run benchmark  (or directly: node scripts/benchmark.js)
// Uses deterministic sample inputs and a median of five timing runs.
// Measures actual runtime on THIS machine, not invented estimates.
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import { optimizedMatch, bruteForceMatch } from '../server/matching.js';

let seed=1337;
function rand() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2**32; }
function makeTrips(n) {
  seed=1337;
  const a=[];
  for(let i=0;i<n;i++) a.push({id:i+1, date:'2026-11-01',
    direction: i%3===0?'to_dadar':'to_vjti', minutes: Math.floor(420+rand()*660)});
  // Reverse to avoid handing both algorithms presorted input.
  return a.reverse();
}
function medianDuration(fn, trips) {
  const times=[];
  for(let trial=0;trial<5;trial++) {
    const start=performance.now(); fn(trips); times.push(performance.now()-start);
  }
  return times.sort((a,b)=>a-b)[2];
}
const results=[];
console.log('CabShare algorithm benchmark (median of 5 runs):');
console.log('Students  Optimized (ms)  Brute force (ms)  Speedup');
for(const n of [100,500,1000,2000,4000]) {
  const trips=makeTrips(n);
  const a=optimizedMatch(trips);
  const b=bruteForceMatch(trips);
  if(JSON.stringify(a)!==JSON.stringify(b)) throw new Error(`Mismatch at n=${n}`);
  const o=medianDuration(optimizedMatch,trips), brute=medianDuration(bruteForceMatch,trips);
  results.push({n,optimizedMs:o,bruteMs:brute,speedup:brute/o});
  console.log(`${String(n).padEnd(9)} ${o.toFixed(3).padEnd(15)} ${brute.toFixed(3).padEnd(17)} ${((brute/o).toFixed(1))}×`);
}
const title = `# CabShare — measured algorithm timings\n\nThese timings were produced by running \`node scripts/benchmark.js\` with Node.js \`${process.version}\` on ${new Date().toISOString()}. They are **example timings from this environment**, not universal speed guarantees. Five runs per size, reporting median. Both algorithms returned exactly the same grouping.\n\n| Students (n) | Optimized (ms) | Brute force (ms) | Brute / optimized |\n|---:|---:|---:|---:|\n`;
const rows=results.map(r=>`| ${r.n} | ${r.optimizedMs.toFixed(3)} | ${r.bruteMs.toFixed(3)} | ${r.speedup.toFixed(1)}× |`).join('\n');
const note=`\n\nSorted greedy grouping is \`O(n log n)\` average/worst (and may approach \`O(n)\` best on presorted input with an adaptive sort). The intentionally brute-force selection sort is \`O(n²)\` in all cases. Stopwatch numbers depend on CPU and runtime; rerun the command for your own timings.\n`;
fs.mkdirSync('docs',{recursive:true});
fs.writeFileSync('docs/BENCHMARK_RESULTS.md',title+rows+note);
