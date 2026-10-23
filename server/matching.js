// CabShare's matching rule: same date + direction; departure times within
// WINDOW_MINUTES of the FIRST student in each newly formed greedy group.
// Four students fill one cab, and the fifth starts the next group.
export const WINDOW_MINUTES = 20;
export const MAX_PASSENGERS = 4;
export const FARE_PAISE = 5000; // ₹50, represented as paise to avoid float errors.

const key = t => `${t.date}|${t.direction}`;
const compare = (a, b) =>
  key(a).localeCompare(key(b)) || a.minutes - b.minutes || a.id - b.id;

// OPTIMIZED: sort by date, route, and departure time. Visit students exactly
// once after sorting. Average/worst time O(n log n); an adaptive sort can
// approach O(n) best case on already sorted input. Extra space O(n).
export function optimizedMatch(trips, window = WINDOW_MINUTES) {
  const ordered = [...trips].sort(compare);
  const groups = [];
  for (const trip of ordered) {
    const last = groups[groups.length - 1];
    if (last && last.date === trip.date && last.direction === trip.direction &&
        last.members.length < MAX_PASSENGERS &&
        trip.minutes - last.anchor <= window) {
      last.members.push(trip.id);
    } else {
      groups.push({ date: trip.date, direction: trip.direction,
        anchor: trip.minutes, members: [trip.id] });
    }
  }
  return groups;
}

// BRUTE FORCE: selection-sort the input without using .sort(). On pass i,
// scan the remaining unsorted trips to find the earliest. This performs
// O(n²) comparisons, even on already-sorted data. Grouping afterward is O(n).
// Time O(n²) best/average/worst; extra space O(n).
export function bruteForceMatch(trips, window = WINDOW_MINUTES) {
  const remaining = [...trips];
  const ordered = [];
  while (remaining.length) {
    let earliest = 0;
    for (let j = 1; j < remaining.length; j++) {
      if (compare(remaining[j], remaining[earliest]) < 0) earliest = j;
    }
    ordered.push(remaining[earliest]);
    remaining.splice(earliest, 1);
  }
  const groups = [];
  for (const trip of ordered) {
    const last = groups[groups.length - 1];
    if (last && last.date === trip.date && last.direction === trip.direction &&
        last.members.length < MAX_PASSENGERS &&
        trip.minutes - last.anchor <= window) last.members.push(trip.id);
    else groups.push({ date: trip.date, direction: trip.direction,
      anchor: trip.minutes, members: [trip.id] });
  }
  return groups;
}

// For live incremental joins, groups are already ordered by anchor_minutes
// (SQL ORDER BY + index). Binary-search to the beginning of the candidate
// time window, then scan only candidates inside it. O(log g + k) time,
// O(1) auxiliary space, given g sorted groups and k nearby candidates.
// Range check covers the earliest and latest member, not only the anchor.
export function findOpenGroup(groups, minutes, window = WINDOW_MINUTES) {
  let low = 0, high = groups.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (groups[mid].anchor_minutes < minutes - window) low = mid + 1;
    else high = mid;
  }
  let best = null;
  for (let i = low; i < groups.length; i++) {
    const g = groups[i];
    if (g.anchor_minutes > minutes + window) break;
    if (g.status !== 'Open' || g.member_count >= MAX_PASSENGERS) continue;
    if (Math.max(minutes, g.max_minutes) - Math.min(minutes, g.min_minutes) > window) continue;
    // Closest anchor (then earliest ID) wins. This is deterministic.
    if (!best || Math.abs(g.anchor_minutes - minutes) < Math.abs(best.anchor_minutes - minutes)) best = g;
  }
  return best;
}

export function splitFare(memberIds) {
  if (!memberIds.length) return [];
  const base = Math.floor(FARE_PAISE / memberIds.length);
  const remainder = FARE_PAISE % memberIds.length;
  return memberIds.map((id, i) => ({ id, paise: base + (i < remainder ? 1 : 0) }));
}
