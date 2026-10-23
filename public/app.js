// Browser-side code. The Express server is the only place that reads/writes SQLite.
// The session cookie is HttpOnly, so JavaScript cannot read or steal it.
const $ = id => document.getElementById(id);
const state = { user: null, direction: 'to_vjti', date: '', suggestedTripDate: '', time: '', data: null, config: null, busy: false, authMode: 'login' };
let toastTimer;

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
const prettyTime = time => {
  const [h, m] = time.split(':').map(Number);
  return `${String(h % 12 || 12)}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const prettyDate = date => new Date(date + 'T12:00:00Z').toLocaleDateString('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
});
const initials = name => (String(name).trim()[0] || '?').toUpperCase();
const routeName = d => d === 'to_vjti' ? 'Dadar → VJTI' : 'VJTI → Dadar';
const dateTimeNear = (time, target, windowMinutes = 20) => {
  if (!target) return true;
  const minute = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return Math.abs(minute(time) - minute(target)) <= windowMinutes;
};
function toast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 5500);
}

async function api(url, method = 'GET', body) {
  const response = await fetch(url, { method, credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  let data;
  try { data = await response.json(); } catch { throw new Error('Server returned an invalid response.'); }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function showApp(user) {
  state.user = user;
  $('authView').classList.toggle('hidden', !!user);
  $('appView').classList.toggle('hidden', !user);
  $('loggedInHeader').classList.toggle('hidden', !user);
  if (user) {
    $('profileAvatar').textContent = initials(user.name);
    $('profileName').textContent = user.name.split(' ')[0];
    loadDashboard();
  }
}
function authMode(mode) {
  state.authMode = mode;
  $('loginTab').classList.toggle('selected', mode === 'login');
  $('signupTab').classList.toggle('selected', mode === 'signup');
  $('nameField').classList.toggle('hidden', mode !== 'signup');
  $('authName').required = mode === 'signup';
  $('authPassword').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  $('authHeading').textContent = mode === 'login' ? 'Welcome back 👋' : 'Join the commute ✨';
  $('authSubtitle').textContent = mode === 'login' ? 'Log in to find your next shared ride.' : 'Use your approved VJTI email to join CabShare.';
  $('authSubmit').innerHTML = mode === 'login' ? 'Log in <span>→</span>' : 'Create account <span>→</span>';
}

async function submitAuth(event) {
  event.preventDefault();
  const payload = { email: $('authEmail').value.trim(), password: $('authPassword').value };
  if (state.authMode === 'signup') payload.name = $('authName').value.trim();
  $('authSubmit').disabled = true;
  try {
    const result = await api(`/api/auth/${state.authMode === 'signup' ? 'signup' : 'login'}`, 'POST', payload);
    if (state.authMode === 'signup') {
      toast(result.message);
      authMode('login');
    } else { showApp(result.user); toast('Welcome to CabShare!'); }
  } catch (error) { toast(error.message, true); }
  finally { $('authSubmit').disabled = false; }
}

async function loadDashboard() {
  if (!state.user || state.busy) return;
  state.busy = true;
  try {
    const result = await api(`/api/dashboard?date=${encodeURIComponent(state.date)}&direction=${state.direction}`);
    state.data = result;
    render();
  } catch (error) { toast(error.message, true); }
  finally { state.busy = false; }
}

function empty(icon, heading, message) {
  return `<div class="empty-state"><span class="empty-icon">${icon}</span><b>${heading}</b><p>${message}</p></div>`;
}
function myTripForGroup(group) {
  const mine = state.data.myTrips.filter(t => t.date === group.date && t.direction === group.direction);
  return mine.find(t => t.group_id === group.id) || null;
}
function availableTripForGroup(group) {
  // A group can only be joined with a posted, unassigned trip.
  return state.data.myTrips.find(t => t.date === group.date && t.direction === group.direction &&
    t.group_id === null && group.members.every(m => dateTimeNear(m.time, t.time, state.config.windowMinutes)));
}
function groupCard(g) {
  const mine = myTripForGroup(g);
  const canJoin = !mine && g.status === 'Open' && availableTripForGroup(g);
  const members = g.members.map(m => `<span class="member ${m.isMe ? 'my-member' : ''}" title="Departure ${prettyTime(m.time)} · exact share ₹${m.exactFare.toFixed(2)}"><span class="avatar">${escapeHtml(initials(m.name))}</span>${escapeHtml(m.isMe ? 'You' : m.name.split(' ')[0])}</span>`).join('');
  const timeWindow = `${prettyTime(g.members[0]?.time || g.time)} departure`;
  let buttons = '';
  if (canJoin) buttons = `<button class="mini-btn" data-action="join" data-group="${g.id}" data-trip="${availableTripForGroup(g).id}">Join group →</button>`;
  else if (mine && g.status !== 'Completed') buttons = `<button class="mini-btn ghost" data-action="leave" data-trip="${mine.id}">Leave group</button><button class="mini-btn" data-action="complete" data-group="${g.id}">Complete ride</button>`;
  else if (g.status === 'Open' && !mine) buttons = `<button class="mini-btn ghost" data-action="post">Post a trip to join</button>`;
  return `<article class="group-card"><div class="group-top"><div><span class="group-id">CAB GROUP #${g.id} · ${escapeHtml(timeWindow)}</span><div class="group-time">${prettyTime(g.time)} <small>${g.seats}/4 seats taken</small></div></div><span class="status ${g.status.toLowerCase()}">${g.status}</span></div>
    <div class="members">${members}</div><div class="group-bottom"><div class="fare-block"><strong>~₹${g.approxFare.toFixed(2)}</strong> per person · ₹50 total</div><div class="group-actions">${buttons}</div></div></article>`;
}
function render() {
  if (!state.data) return;
  const data = state.data;
  $('statStudents').textContent = data.stats.students;
  $('statGroups').textContent = data.stats.openGroups;
  const groups = data.groups.filter(g => !state.time || g.members.some(m => dateTimeNear(m.time, state.time)) || dateTimeNear(g.time, state.time));
  $('groupsList').innerHTML = groups.length ? groups.map(groupCard).join('') : empty('🚕', 'No cab groups yet', 'Post a trip to start the first group for this route and date.');
  const solo = data.unmatched.filter(s => dateTimeNear(s.time, state.time));
  $('soloList').innerHTML = solo.length ? solo.map(s => `<div class="solo-row"><span class="avatar">${escapeHtml(initials(s.name))}</span><span class="solo-info"><b>${escapeHtml(s.isMe ? 'You' : s.name)}</b><small>Looking for a group</small></span><span class="solo-time">${prettyTime(s.time)}</span></div>`).join('') : empty('✨', 'Everyone is matched', 'No unmatched students in this time window.');
  $('myTripsList').innerHTML = data.myTrips.length ? data.myTrips.slice(0, 8).map(trip => {
    const pending = trip.status !== 'Completed';
    return `<div class="trip-entry"><div class="trip-title"><b>${escapeHtml(routeName(trip.direction))}</b><span class="status ${trip.status === 'Unmatched' ? 'open' : trip.status.toLowerCase()}">${trip.status}</span></div><div class="trip-details"><small>${prettyDate(trip.date)} · ${prettyTime(trip.time)}</small><small>${trip.group_id ? `Cab #${trip.group_id}` : 'No cab yet'}</small></div>${pending ? `<div class="trip-actions">${trip.group_id ? `<button data-action="leave" data-trip="${trip.id}">Leave group</button>` : ''}<button class="danger" data-action="cancel" data-trip="${trip.id}">Cancel trip</button></div>` : ''}</div>`;
  }).join('') : empty('📅', 'No trips posted', 'Your upcoming rides will appear here.');
}

function openTripModal() {
  $('tripDirection').value = state.direction;
  // Default to the selected filter date, except near midnight (next valid ride is tomorrow).
  const today = state.config.serverTimeMumbai.slice(0, 10);
  $('tripDate').value = state.date === today ? state.suggestedTripDate : state.date;
  $('tripModal').classList.remove('hidden');
  $('tripTime').focus();
}
function closeModal(name) { $(name).classList.add('hidden'); }
async function handleAction(action, tripId, groupId) {
  try {
    let result;
    if (action === 'post') { openTripModal(); return; }
    if (action === 'join') result = await api(`/api/groups/${groupId}/join`, 'POST', { tripId: Number(tripId) });
    if (action === 'leave') {
      if (!confirm('Leave this cab group? Your trip will stay posted.')) return;
      result = await api(`/api/trips/${tripId}/leave`, 'POST', {});
    }
    if (action === 'cancel') {
      if (!confirm('Cancel this trip?')) return;
      result = await api(`/api/trips/${tripId}`, 'DELETE');
    }
    if (action === 'complete') {
      if (!confirm('Mark this cab ride completed for all group members?')) return;
      result = await api(`/api/groups/${groupId}/complete`, 'POST', {});
    }
    toast(result?.message || 'Updated successfully.');
    await loadDashboard();
  } catch (e) { toast(e.message, true); await loadDashboard(); }
}

async function init() {
  try {
    state.config = await api('/api/config');
    state.date = state.config.serverTimeMumbai.slice(0, 10);
    $('filterDate').value = state.date;
    $('filterDate').min = state.date;
    $('tripDate').min = state.date;
    state.suggestedTripDate = state.date;
    const nowMinute = Number(state.config.serverTimeMumbai.slice(11, 13)) * 60 + Number(state.config.serverTimeMumbai.slice(14, 16));
    // Suggest the next half-hour slot, not a time in the past.
    let nextMinute = Math.ceil((nowMinute + 5) / 30) * 30;
    // After midnight, the next available half-hour slot is on tomorrow's date.
    if (nextMinute >= 1440) {
      nextMinute -= 1440;
      const tomorrow = new Date(`${state.date}T00:00:00Z`);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      state.suggestedTripDate = tomorrow.toISOString().slice(0, 10);
    }
    $('tripTime').value = `${String(Math.floor(nextMinute / 60)).padStart(2, '0')}:${String(nextMinute % 60).padStart(2, '0')}`;
    const me = await api('/api/auth/me');
    showApp(me.user);
  } catch (error) { toast(`Cannot connect to the backend: ${error.message}`, true); }

  // The email verification URL is a bearer secret; remove it from the address
  // bar immediately after reading, before other navigation occurs.
  const url = new URL(location.href);
  const verification = url.searchParams.get('verify');
  if (verification) {
    history.replaceState(null, '', location.pathname);
    try { const data = await api('/api/auth/verify', 'POST', { token: verification }); toast(data.message); }
    catch (error) { toast(error.message, true); }
  }
  $('loginTab').addEventListener('click', () => authMode('login'));
  $('signupTab').addEventListener('click', () => authMode('signup'));
  $('authForm').addEventListener('submit', submitAuth);
  $('resendButton').addEventListener('click', async () => {
    if (!$('authEmail').value || !$('authPassword').value) return toast('Enter your email and password first.', true);
    try { const data = await api('/api/auth/resend', 'POST', { email: $('authEmail').value, password: $('authPassword').value }); toast(data.message); }
    catch (e) { toast(e.message, true); }
  });
  $('logoutButton').addEventListener('click', async () => {
    try { await api('/api/auth/logout', 'POST', {}); showApp(null); state.data = null; toast('Logged out.'); }
    catch (e) { toast(e.message, true); }
  });
  document.querySelectorAll('.route-tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.route-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active'); state.direction = tab.dataset.direction; loadDashboard();
  }));
  $('filterDate').addEventListener('change', e => { state.date = e.target.value; loadDashboard(); });
  $('filterTime').addEventListener('change', e => { state.time = e.target.value; render(); });
  $('clearTimeButton').addEventListener('click', () => { $('filterTime').value = ''; state.time = ''; render(); });
  ['newTripButton', 'sidePostButton'].forEach(id => $(id).addEventListener('click', openTripModal));
  $('closeTripButton').addEventListener('click', () => closeModal('tripModal'));
  $('aboutButton').addEventListener('click', () => $('aboutModal').classList.remove('hidden'));
  $('closeAboutButton').addEventListener('click', () => closeModal('aboutModal'));
  ['tripModal', 'aboutModal'].forEach(id => $(id).addEventListener('click', e => { if (e.target.id === id) closeModal(id); }));
  window.addEventListener('keydown', e => { if (e.key === 'Escape') ['tripModal', 'aboutModal'].forEach(closeModal); });
  $('tripForm').addEventListener('submit', async e => {
    e.preventDefault();
    const button = $('tripForm').querySelector('button[type=submit]');
    button.disabled = true;
    try {
      const data = await api('/api/trips', 'POST', { date: $('tripDate').value, time: $('tripTime').value, direction: $('tripDirection').value });
      closeModal('tripModal');
      state.date = $('tripDate').value; state.direction = $('tripDirection').value;
      $('filterDate').value = state.date;
      document.querySelectorAll('.route-tab').forEach(t => t.classList.toggle('active', t.dataset.direction === state.direction));
      await loadDashboard();
      toast(data.message);
    } catch (err) { toast(err.message, true); }
    finally { button.disabled = false; }
  });
  document.addEventListener('click', e => {
    const target = e.target.closest('[data-action]');
    if (target) handleAction(target.dataset.action, target.dataset.trip, target.dataset.group);
  });
  setInterval(() => { if (state.user && !document.hidden) loadDashboard(); }, 10000);
}
init();
