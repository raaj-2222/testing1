# CabShare — Analysis of Algorithms project report

## 1. Problem statement

Given `n` students and their planned journeys, automatically group compatible students for a taxi of **at most four** riders. Compatible students must have:

1. The **same trip date**.
2. The **same travel direction**.
3. Departure times in the same **20-minute overall window**.

After the fourth rider, the fifth should start a new cab group.

For example, if five students all depart Dadar at 09:00, 09:05, 09:07, 09:10, 09:12, the groups will be **[09:00, 09:05, 09:07, 09:10]** and **[09:12]** (even though all five times are close). This is a *greedy, capacity-constrained grouping heuristic*, not a globally optimal minimum-wait-cost partition.

## 2. Input and output

Each input record has `{ id, date, direction, minutes }`. E.g. `minutes = 9*60+10 = 550` for 9:10 AM. Direction is either `to_vjti` or `to_dadar`.

Output is a list of `{ date, direction, anchor, members: [student IDs] }` group objects.

### Example

```text
Input (shuffled):
Student    Date         Direction    Time
A          2026-11-01   to_vjti      09:07
B          2026-11-01   to_vjti      09:00
C          2026-11-01   to_vjti      09:12
D          2026-11-01   to_vjti      09:10
E          2026-11-01   to_vjti      09:05
F          2026-11-01   to_dadar     09:05

Sorted to_vjti input: B, E, A, D, C.
Output:
Group 1: [B, E, A, D] (4 seats, full)
Group 2: [C]          (new cab because group 1 is full)
Group 3: [F]          (separate direction)
```

## 3. Brute force

File: **`server/matching.js` → `bruteForceMatch`**

We deliberately use a repeated linear scan (selection sort) rather than a built-in sorting function:

```text
remaining = all trips
ordered = []
while remaining not empty:
    find minimum trip by (date, direction, time, student ID)
    remove it from remaining
    append it to ordered
for trip in ordered:
    if it fits the last group and last group has fewer than 4 members:
        append trip to that group
    else:
        create a new group
return groups
```

The repeated minimum search takes `(n-1) + (n-2) + ... + 1 = n(n-1)/2` comparisons = **O(n²)**. Even sorted input needs all comparisons. The subsequent grouping pass is **O(n)**.

Time complexity: **O(n²)** best, average, worst. Extra space: **O(n)**.

## 4. Optimized sorting + greedy / sliding window

File: **`server/matching.js` → `optimizedMatch`**

```text
ordered = trips sorted by (date, direction, departure time, student ID)
groups = []
for trip in ordered:
    last = last group created
    if last exists
       and trip date and direction match last
       and group has fewer than 4 members
       and trip.time - last.anchor <= 20 minutes:
         append trip to last.members
    else:
         groups.push(new group anchored at trip.time)
return groups
```

After sorting, the current group is a **sliding time window anchored at its first member**. We visit each sorted student once; no quadratic comparison of student pairs.

- Sort: **O(n log n)** typical average/worst comparison-sort bound; JavaScript's built-in adaptive sort can approach **O(n)** on already-sorted input.
- Greedy single pass: **O(n)**.
- Combined time: **O(n log n)** average/worst; **O(n)** is possible best case for nearly sorted input on an adaptive sort implementation.
- Extra space: **O(n)** for copied input and result (built-in sorting may use additional temporary memory).

The grouping is deterministic: ties are broken by student ID.

## 5. Incremental online matching in the real app

A student's new trip should **not** reshuffle existing riders who already agreed to share a cab. Consequently, the production POST endpoint does not rerun batch matching over everyone; it uses an **incremental indexed variant**.

Files: **`server/matching.js` → `findOpenGroup`; `server/app.js` → `groupCandidates` and `POST /api/trips`**.

1. SQLite selects **open groups only**, matching `date` and `direction`, ordered by anchor departure time. There is an index on `(trip_date, direction, anchor_minutes)`.
2. Binary search finds the first group anchor no earlier than `newTime - 20`.
3. Scan only groups with anchors no later than `newTime + 20`.
4. Reject full/completed groups or those where the **minimum to maximum member departure time including the new rider exceeds 20**.
5. Pick the compatible group whose anchor time is closest; if no such group exists, insert a new cab group.
6. Add the student and update the status to `Open` or `Full` inside **one SQLite transaction**.

Given `g` already-sorted group candidates and `k` candidate anchors in the time interval, search is **O(log g + k)** and extra auxiliary space is **O(1)**. SQL retrieval, aggregation and sorting have their own database-dependent cost and are **not included** in this in-memory search bound. This keeps existing memberships stable after insertions, joins and leaves.

When a rider leaves, their trip becomes unmatched and the old group status is recalculated. When an open group is full, the next unmatched departure begins a new group. A completed group is never reopened.

## 6. Best, average, worst case

| Approach | Best time | Average time | Worst time | Extra space |
|---|---|---|---|---|
| Brute-force repeated-minimum selection | O(n²) | O(n²) | O(n²) | O(n) |
| Batch optimized: adaptive sort + greedy | O(n) possible* | O(n log n) | O(n log n) | O(n) |
| Incremental matching on pre-sorted group array | O(log g) if few candidates | O(log g + k) | O(g) when all anchors are nearby | O(1) |

\* The best-case adaptive sort performance is implementation-dependent; for a general comparison-sort analysis, **O(n log n)** is the standard upper bound. If grouping were fed already-sorted data, the greedy pass alone is O(n).

`n` = number of students; `g` = available groups on the same date/route; `k` = groups within the candidate time range.

## 7. Benchmark method

File: **`scripts/benchmark.js`**.

- Input sizes: **100, 500, 1000, 2000, 4000**.
- Deterministic pseudorandom departure minutes and two directions.
- Both algorithms receive the same input; their group outputs are checked for **exact equality**.
- Five measured runs per input size. We report the **median** to reduce one-off noise.
- Results are saved to **`docs/BENCHMARK_RESULTS.md`**. Re-run `npm run benchmark` on your own laptop for lab-report numbers.

Do not claim an algorithm is a specific number of times faster on every computer. Timings depend on input ordering, CPU, runtime warm-up and available memory.

## 8. Practical limitations and future work

- These rules optimize fast and predictable grouping, **not total waiting-time optimality or fairness**. A more advanced project could minimize total deviations from a preferred departure time using dynamic programming, weighted interval grouping, or a min-cost-flow formulation.
- A posted trip's time is fixed. Students who leave a group remain unassigned until they choose to join again; this avoids unexpectedly reassigning them.
- This is coordination software only. Fare and travel time are estimates, not live taxi data.
