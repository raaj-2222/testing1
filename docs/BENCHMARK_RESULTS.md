# CabShare — measured algorithm timings

These timings were produced by running `node scripts/benchmark.js` with Node.js `v22.16.0` on 2026-10-23T16:20:20.783Z. They are **example timings from this environment**, not universal speed guarantees. Five runs per size, reporting median. Both algorithms returned exactly the same grouping.

| Students (n) | Optimized (ms) | Brute force (ms) | Brute / optimized |
|---:|---:|---:|---:|
| 100 | 0.056 | 0.601 | 10.7× |
| 500 | 0.438 | 10.001 | 22.8× |
| 1000 | 0.915 | 37.473 | 41.0× |
| 2000 | 2.232 | 144.359 | 64.7× |
| 4000 | 4.779 | 660.119 | 138.1× |

Sorted greedy grouping is `O(n log n)` average/worst (and may approach `O(n)` best on presorted input with an adaptive sort). The intentionally brute-force selection sort is `O(n²)` in all cases. Stopwatch numbers depend on CPU and runtime; rerun the command for your own timings.
