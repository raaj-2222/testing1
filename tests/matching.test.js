import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizedMatch, bruteForceMatch, findOpenGroup, splitFare, MAX_PASSENGERS } from '../server/matching.js';

const T = (id, minutes, date='2026-11-01', direction='to_vjti') => ({ id, minutes, date, direction });

test('Both algorithms match the same riders', () => {
  const trips = [T(4,565),T(2,545),T(1,540),T(5,567),T(3,550),T(7,700),T(6,569)];
  assert.deepEqual(optimizedMatch(trips), bruteForceMatch(trips));
});
test('Groups contain no more than four students; fifth creates a new group', () => {
  const g = optimizedMatch([1,2,3,4,5].map(i=>T(i,540+i)));
  assert.equal(g.length, 2);
  assert.deepEqual(g.map(g=>g.members.length), [4,1]);
});
test('A departure >20 minutes after first member starts new group', () => {
  const g=optimizedMatch([T(1,540),T(2,560),T(3,561)]);
  assert.deepEqual(g.map(g=>g.members),[[1,2],[3]]);
});
test('Different dates or directions never get grouped together', () => {
  const g=optimizedMatch([T(1,540),T(2,540,'2026-11-02'),T(3,540,'2026-11-01','to_dadar')]);
  assert.equal(g.length, 3);
});
test('Sorting is deterministic, including ties', () => {
  const g=optimizedMatch([T(3,540),T(1,540),T(2,540)]);
  assert.deepEqual(g[0].members,[1,2,3]);
});
test('Empty data makes no groups', () => assert.deepEqual(optimizedMatch([]),[]));
test('An open group within the full span limit is found', () => {
  const groups=[{id:1,anchor_minutes:540,min_minutes:540,max_minutes:555,member_count:2,status:'Open'}];
  assert.equal(findOpenGroup(groups,559)?.id,1);
  assert.equal(findOpenGroup(groups,561),null);
});
test('Full group is skipped and next available cab is chosen', () => {
  const groups=[
    {id:1,anchor_minutes:540,min_minutes:540,max_minutes:540,member_count:4,status:'Full'},
    {id:2,anchor_minutes:544,min_minutes:544,max_minutes:544,member_count:1,status:'Open'}
  ];
  assert.equal(findOpenGroup(groups,545)?.id,2);
});
test('Closest compatible anchor wins', () => {
  const groups=[
    {id:1,anchor_minutes:540,min_minutes:540,max_minutes:540,member_count:1,status:'Open'},
    {id:2,anchor_minutes:548,min_minutes:548,max_minutes:548,member_count:1,status:'Open'}
  ];
  assert.equal(findOpenGroup(groups,550)?.id,2);
});
test('Each fare totals exactly 5000 paise for 1–4 members', () => {
  for (let n=1;n<=MAX_PASSENGERS;n++) {
    const a=splitFare(Array.from({length:n},(_,i)=>i+1));
    assert.equal(a.reduce((total,p)=>total+p.paise,0),5000);
    assert.ok(Math.max(...a.map(p=>p.paise))-Math.min(...a.map(p=>p.paise))<=1);
  }
});
test('Three-rider fare assigns 1667, 1667, 1666 paise', () => {
  assert.deepEqual(splitFare([1,2,3]).map(x=>x.paise),[1667,1667,1666]);
});
