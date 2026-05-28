// ── Constants ────────────────────────────────────────────
const SCHEDULE_COLORS = [
  '#4A90D9', '#E8892B', '#27AE60', '#9B59B6',
  '#16A085', '#D35400', '#2980B9', '#C0392B',
  '#8E44AD', '#1ABC9C',
];

const VALID_DAYS  = ['M', 'T', 'W', 'Th', 'F'];
const ALL_DAYS    = [...VALID_DAYS];

// ── Application state ────────────────────────────────────
const state = {
  // Filters (mirrors sidebar UI)
  major:  'Computer Science',
  level:  'grad',
  mode:   'all',
  days:   [...ALL_DAYS],  // all 5 active = no filter sent to API
  units:  null,           // null = no filter sent to API
  // App data
  courses:      [],
  schedule:     [],
  courseColors: {},
  colorIdx:     0,
};

// Tracks whether the very first fetch has completed
let hasLoaded = false;

// Debounce handle for filter-triggered fetches
let debounceTimer = null;

// ── Debounced fetch trigger ──────────────────────────────
function scheduleApiFetch() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fetchCourses, 300);
}

// ── Theme ────────────────────────────────────────────────
function toggleTheme() {
  document.body.classList.toggle('dark');
}

// ── Filter handlers ──────────────────────────────────────
function onMajorChange(value) {
  state.major = value;
  document.getElementById('badge-major').textContent = value;
  scheduleApiFetch();
}

function onLevelChange(btn) {
  document.querySelectorAll('#level-group .pill')
    .forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  state.level = btn.dataset.value;
  document.getElementById('badge-level').textContent =
    state.level === 'grad' ? 'Graduate' : 'Undergrad';
  scheduleApiFetch();
}

function togglePill(btn) {
  const group   = btn.closest('.pill-group');
  const groupId = group.id;

  if (groupId === 'units-group') {
    // Radio: click active → deactivate (no filter); click inactive → activate only this one
    if (btn.classList.contains('active')) {
      btn.classList.remove('active');
      state.units = null;
    } else {
      group.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      state.units = parseFloat(btn.dataset.value);
    }
  } else {
    // Multi-select toggle for mode and days groups
    btn.classList.toggle('active');
  }

  if (groupId === 'mode-group') {
    const active = [...group.querySelectorAll('.pill.active')].map(p => p.dataset.value);
    // Both active, neither active → all; exactly one → that mode
    state.mode = active.length === 1 ? active[0] : 'all';
  } else if (groupId === 'days-group') {
    state.days = [...group.querySelectorAll('.pill.active')].map(p => p.dataset.value);
  }

  scheduleApiFetch();
}

// ── Build query string from current state ─────────────────
function buildParams() {
  const p = new URLSearchParams({ major: state.major, level: state.level });
  if (state.mode !== 'all') {
    p.set('mode', state.mode);
  }
  // Only send days if a subset is selected (0 or 5 = no filter)
  if (state.days.length > 0 && state.days.length < 5) {
    p.set('days', state.days.join(','));
  }
  if (state.units !== null) {
    p.set('units', String(state.units));
  }
  return p;
}

// ── URL sync ─────────────────────────────────────────────
function syncURL() {
  history.replaceState(null, '', '?' + buildParams().toString());
}

// ── Restore filters from URL on page load ────────────────
function restoreFromURL() {
  const p = new URLSearchParams(window.location.search);
  if (!p.toString()) return; // nothing to restore

  if (p.has('major')) {
    const val    = p.get('major');
    const select = document.getElementById('major-select');
    if ([...select.options].some(o => o.value === val)) {
      state.major  = val;
      select.value = val;
      document.getElementById('badge-major').textContent = val;
    }
  }

  if (p.has('level')) {
    const val = p.get('level');
    if (['grad', 'undergrad'].includes(val)) {
      state.level = val;
      document.querySelectorAll('#level-group .pill').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.value === val);
      });
      document.getElementById('badge-level').textContent =
        val === 'grad' ? 'Graduate' : 'Undergrad';
    }
  }

  if (p.has('mode')) {
    const val = p.get('mode');
    if (['all', 'inperson', 'online'].includes(val)) {
      state.mode = val;
      document.querySelectorAll('#mode-group .pill').forEach(btn => {
        btn.classList.toggle('active',
          val === 'all' || btn.dataset.value === val);
      });
    }
  }

  if (p.has('days')) {
    const days = p.get('days').split(',').filter(d => VALID_DAYS.includes(d));
    if (days.length > 0) {
      state.days = days;
      document.querySelectorAll('#days-group .pill').forEach(btn => {
        btn.classList.toggle('active', days.includes(btn.dataset.value));
      });
    }
  }

  if (p.has('units')) {
    const val = parseFloat(p.get('units'));
    if (!isNaN(val)) {
      state.units = val;
      document.querySelectorAll('#units-group .pill').forEach(btn => {
        btn.classList.toggle('active', parseFloat(btn.dataset.value) === val);
      });
    }
  }
}

// ── Tab switching ────────────────────────────────────────
function switchTab(btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  btn.classList.add('active');
  document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
}

// ── Error banner (created lazily, lives above the list) ───
function showError(msg) {
  let banner = document.getElementById('error-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id        = 'error-banner';
    banner.className = 'error-banner hidden';
    const spinner = document.getElementById('spinner');
    spinner.parentNode.insertBefore(banner, spinner);
  }
  banner.textContent = msg;
  banner.classList.remove('hidden');
}

function hideError() {
  const banner = document.getElementById('error-banner');
  if (banner) banner.classList.add('hidden');
}

// ── API fetch ────────────────────────────────────────────
async function fetchCourses() {
  const spinner = document.getElementById('spinner');
  const listEl  = document.getElementById('course-list');
  const noMsg   = document.getElementById('no-courses');

  hideError();

  if (!hasLoaded) {
    // Initial load: show full-panel spinner, clear any stale markup
    spinner.classList.remove('hidden');
    listEl.innerHTML = '';
    noMsg.classList.add('hidden');
  } else {
    // Subsequent fetches: dim the existing list — subtle, non-disruptive
    listEl.classList.add('loading');
  }

  try {
    const res = await fetch('/api/courses?' + buildParams());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.courses = await res.json();
  } catch (err) {
    console.error('fetchCourses:', err);
    state.courses = [];
    showError('Failed to load courses. Please try again.');
  }

  if (!hasLoaded) {
    spinner.classList.add('hidden');
    hasLoaded = true;
  } else {
    listEl.classList.remove('loading');
  }

  renderCourseList();
  syncURL();
}

// ── Time / conflict helpers ──────────────────────────────
function parseTime(s) {
  if (!s) return null;
  const m = s.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!m) return null;
  let h = +m[1];
  const min = +m[2];
  const pm  = m[3].toUpperCase() === 'PM';
  if (pm  && h !== 12) h += 12;
  if (!pm && h === 12) h  = 0;
  return h * 60 + min;
}

function daysOverlap(a, b) {
  if (!a || !b || a === 'ARR' || b === 'ARR') return false;
  for (const ch of ['M', 'T', 'W', 'R', 'F']) {
    if (a.includes(ch) && b.includes(ch)) return true;
  }
  return false;
}

function getConflict(course) {
  const s1 = parseTime(course.start_time);
  const e1 = parseTime(course.end_time);
  for (const added of state.schedule) {
    if (added.class_nbr === course.class_nbr) continue;
    if (!daysOverlap(course.days, added.days)) continue;
    const s2 = parseTime(added.start_time);
    const e2 = parseTime(added.end_time);
    if (s1 !== null && e1 !== null && s2 !== null && e2 !== null) {
      if (s1 < e2 && s2 < e1) return added;
    }
  }
  return null;
}

// ── Card helpers ─────────────────────────────────────────
function fmtTime(course) {
  if (course.start_time && course.end_time)
    return `${course.start_time} – ${course.end_time}`;
  return 'Async';
}

function availBadge(seats) {
  if (seats <= 0)  return ['red',   '0 seats — Full'];
  if (seats <= 10) return ['gold',  `${seats} seat${seats === 1 ? '' : 's'} left`];
  return                  ['green', `${seats} seats open`];
}

function makeCard(course) {
  const isAdded  = state.schedule.some(c => c.class_nbr === course.class_nbr);
  const conflict = !isAdded ? getConflict(course) : null;

  const isOnline  = ['ON', 'OE'].includes(course.mode) || course.room === 'ONLINE';
  const roomIcon  = isOnline ? 'ti-wifi' : 'ti-building';
  const roomText  = isOnline ? 'Online' : (course.room || 'TBA');
  const dayPrefix = course.days && course.days !== 'ARR' ? course.days + ' · ' : '';
  const instructor = course.instructor || 'TBA';

  const [avCls, avTxt] = availBadge(course.seats_available);

  let btn = '';
  let extra = '';

  if (isAdded) {
    btn = `<button class="add-btn added" onclick="removeCourse(${course.class_nbr})">Added ✓</button>`;
  } else if (conflict) {
    extra = `<span class="conflict-chip">⚠ Conflicts with ${conflict.subject} ${conflict.catalog_nbr}</span>`;
    btn   = `<button class="add-btn" disabled>Conflict</button>`;
  } else {
    btn = `<button class="add-btn" onclick="addCourse(${course.class_nbr})">Add</button>`;
  }

  const cardCls = ['course-card', isAdded && 'added', conflict && 'conflict']
    .filter(Boolean).join(' ');

  return `
    <div class="${cardCls}" id="card-${course.class_nbr}">
      <div class="card-main">
        <div class="card-header">
          <span class="course-badge">${course.subject} ${course.catalog_nbr}</span>
          <span class="course-title" title="${course.title}">${course.title}</span>
        </div>
        <div class="card-meta">
          <span class="meta-chip"><i class="ti ti-clock"></i>${dayPrefix}${fmtTime(course)}</span>
          <span class="meta-chip"><i class="ti ti-user"></i>${instructor}</span>
          <span class="meta-chip"><i class="ti ${roomIcon}"></i>${roomText}</span>
        </div>
        <div class="card-footer">
          <span class="avail-badge ${avCls}">${avTxt}</span>
          ${extra}
        </div>
      </div>
      <div class="card-action">${btn}</div>
    </div>`;
}

function renderCourseList() {
  const listEl = document.getElementById('course-list');
  const noMsg  = document.getElementById('no-courses');

  if (!state.courses.length) {
    listEl.innerHTML = '';
    noMsg.classList.remove('hidden');
    return;
  }

  noMsg.classList.add('hidden');
  listEl.innerHTML = state.courses.map(makeCard).join('');
}

// ── Schedule management ──────────────────────────────────
function addCourse(classNbr) {
  if (state.schedule.some(c => c.class_nbr === classNbr)) return;
  const course = state.courses.find(c => c.class_nbr === classNbr);
  if (!course) return;

  if (!state.courseColors[classNbr]) {
    state.courseColors[classNbr] = SCHEDULE_COLORS[state.colorIdx++ % SCHEDULE_COLORS.length];
  }

  state.schedule.push(course);
  renderCourseList();
  renderSchedulePanel();
}

function removeCourse(classNbr) {
  state.schedule = state.schedule.filter(c => c.class_nbr !== classNbr);
  renderCourseList();
  renderSchedulePanel();
}

function clearSchedule() {
  state.schedule = [];
  renderCourseList();
  renderSchedulePanel();
}

function renderSchedulePanel() {
  const el = document.getElementById('schedule-list');

  if (!state.schedule.length) {
    el.innerHTML = '<p class="empty-msg">No courses added yet</p>';
    return;
  }

  el.innerHTML = state.schedule.map(course => {
    const color    = state.courseColors[course.class_nbr] || '#888';
    const dayPfx   = course.days && course.days !== 'ARR' ? course.days + ' · ' : '';
    const timeText = fmtTime(course);
    return `
      <div class="schedule-item">
        <span class="schedule-dot" style="background:${color}"></span>
        <div class="schedule-info">
          <div class="schedule-code">${course.subject} ${course.catalog_nbr} — ${course.title}</div>
          <div class="schedule-time">${dayPfx}${timeText}</div>
        </div>
      </div>`;
  }).join('');
}

// ── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  restoreFromURL();
  fetchCourses();
});
