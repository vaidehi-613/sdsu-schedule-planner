// ── Constants ────────────────────────────────────────────
// Colors assigned to added courses in the sidebar panel (cycles if > 5)
const SCHEDULE_COLORS = ['#A6192E', '#C69214', '#1D9E75', '#378ADD', '#7F77DD'];

const VALID_DAYS = ['M', 'T', 'W', 'Th', 'F'];
const ALL_DAYS   = [...VALID_DAYS];

// CSV meeting-pattern letter → normalized day label
// 'R' is Thursday in the SDSU CSV encoding; we normalize to 'Th' for comparison
const DAY_MAP = { M: 'M', T: 'T', W: 'W', R: 'Th', F: 'F' };

// ── Application state ────────────────────────────────────
const state = {
  // Filters
  major:  'Computer Science',
  level:  'grad',
  mode:   'all',
  days:   [...ALL_DAYS],
  units:  null,
  // Data
  courses:      [],
  mySchedule:   [],       // courses the student has added
  courseColors: {},       // classNbr → hex color string
  colorIdx:     0,
};

let hasLoaded    = false;
let debounceTimer = null;

// ── Debounced fetch ───────────────────────────────────────
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
    if (btn.classList.contains('active')) {
      btn.classList.remove('active');
      state.units = null;
    } else {
      group.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      state.units = parseFloat(btn.dataset.value);
    }
  } else {
    btn.classList.toggle('active');
  }

  if (groupId === 'mode-group') {
    const active = [...group.querySelectorAll('.pill.active')].map(p => p.dataset.value);
    state.mode = active.length === 1 ? active[0] : 'all';
  } else if (groupId === 'days-group') {
    state.days = [...group.querySelectorAll('.pill.active')].map(p => p.dataset.value);
  }

  scheduleApiFetch();
}

// ── Build query string ────────────────────────────────────
function buildParams() {
  const p = new URLSearchParams({ major: state.major, level: state.level });
  if (state.mode !== 'all')
    p.set('mode', state.mode);
  if (state.days.length > 0 && state.days.length < 5)
    p.set('days', state.days.join(','));
  if (state.units !== null)
    p.set('units', String(state.units));
  return p;
}

// ── URL sync ─────────────────────────────────────────────
function syncURL() {
  history.replaceState(null, '', '?' + buildParams().toString());
}

function restoreFromURL() {
  const p = new URLSearchParams(window.location.search);
  if (!p.toString()) return;

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
        btn.classList.toggle('active', val === 'all' || btn.dataset.value === val);
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

// ── Tabs ─────────────────────────────────────────────────
function switchTab(btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  btn.classList.add('active');
  document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
}

// ── Error banner ──────────────────────────────────────────
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

// ── API fetch ─────────────────────────────────────────────
async function fetchCourses() {
  const spinner = document.getElementById('spinner');
  const listEl  = document.getElementById('course-list');
  const noMsg   = document.getElementById('no-courses');

  hideError();

  if (!hasLoaded) {
    spinner.classList.remove('hidden');
    listEl.innerHTML = '';
    noMsg.classList.add('hidden');
  } else {
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

// ── Day parsing ───────────────────────────────────────────
// Parses a CSV meeting pattern string into an array of normalized day labels.
// 'R' in the CSV means Thursday; we normalize it to 'Th' so overlaps are
// correctly detected and so 'ARR' (arranged) never accidentally matches Thursday.
function parseDays(pattern) {
  if (!pattern || pattern === 'ARR') return [];
  const days = [];
  for (const ch of pattern) {
    if (ch in DAY_MAP) days.push(DAY_MAP[ch]);
  }
  return days;
}

// ── Conflict detection ────────────────────────────────────
function daysOverlap(patA, patB) {
  const a = parseDays(patA);
  const b = parseDays(patB);
  if (!a.length || !b.length) return false;
  return a.some(d => b.includes(d));
}

// Returns the first course in mySchedule that conflicts with `course`,
// or null if none. A conflict requires overlapping days AND overlapping times.
// Courses with no meeting time (async) can never conflict.
function getConflict(course) {
  const s1 = parseTime(course.start_time);
  const e1 = parseTime(course.end_time);
  if (s1 === null || e1 === null) return null; // async — no conflict possible

  for (const added of state.mySchedule) {
    if (added.class_nbr === course.class_nbr) continue;
    if (!daysOverlap(course.days, added.days)) continue;
    const s2 = parseTime(added.start_time);
    const e2 = parseTime(added.end_time);
    if (s2 === null || e2 === null) continue; // added course is async
    if (s1 < e2 && s2 < e1) return added;
  }
  return null;
}

// ── Time helpers ──────────────────────────────────────────
function parseTime(s) {
  if (!s) return null;
  const m = s.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!m) return null;
  let h     = +m[1];
  const min = +m[2];
  const pm  = m[3].toUpperCase() === 'PM';
  if (pm  && h !== 12) h += 12;
  if (!pm && h === 12) h  = 0;
  return h * 60 + min;
}

function fmtTime(course) {
  if (course.start_time && course.end_time)
    return `${course.start_time} – ${course.end_time}`;
  return 'Async';
}

// ── Card helpers ──────────────────────────────────────────
function availBadge(seats) {
  if (seats <= 0)  return ['red',   '0 seats — Full'];
  if (seats <= 10) return ['gold',  `${seats} seat${seats === 1 ? '' : 's'} left`];
  return                  ['green', `${seats} seats open`];
}

function makeCard(course) {
  const isAdded  = state.mySchedule.some(c => c.class_nbr === course.class_nbr);
  const conflict = !isAdded ? getConflict(course) : null;

  const isOnline   = ['ON', 'OE'].includes(course.mode) || course.room === 'ONLINE';
  const roomIcon   = isOnline ? 'ti-wifi' : 'ti-building';
  const roomText   = isOnline ? 'Online' : (course.room || 'TBA');
  const dayPrefix  = course.days && course.days !== 'ARR' ? course.days + ' · ' : '';
  const instructor = course.instructor || 'TBA';

  const [avCls, avTxt] = availBadge(course.seats_available);

  let btn   = '';
  let extra = '';

  if (isAdded) {
    btn = `<button class="add-btn added" onclick="removeCourse(${course.class_nbr})">✓ Added</button>`;
  } else if (conflict) {
    extra = `<span class="conflict-chip">⚠ Conflicts with ${conflict.title}</span>`;
    btn   = `<button class="add-btn" disabled>Conflict</button>`;
  } else {
    btn = `<button class="add-btn" onclick="addCourse(${course.class_nbr})">+ Add</button>`;
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

// ── Schedule management ───────────────────────────────────
function addCourse(classNbr) {
  if (state.mySchedule.some(c => c.class_nbr === classNbr)) return;
  const course = state.courses.find(c => c.class_nbr === classNbr);
  if (!course) return;

  // Assign a persistent color the first time this course is added
  if (!state.courseColors[classNbr]) {
    state.courseColors[classNbr] = SCHEDULE_COLORS[state.colorIdx++ % SCHEDULE_COLORS.length];
  }

  state.mySchedule.push(course);
  renderCourseList();      // re-renders all cards, re-runs conflict detection
  renderSchedulePanel();
}

function removeCourse(classNbr) {
  state.mySchedule = state.mySchedule.filter(c => c.class_nbr !== classNbr);
  renderCourseList();
  renderSchedulePanel();
}

function clearSchedule() {
  state.mySchedule = [];
  renderCourseList();
  renderSchedulePanel();
}

// ── My Schedule sidebar panel ─────────────────────────────
function renderSchedulePanel() {
  const el = document.getElementById('schedule-list');

  if (!state.mySchedule.length) {
    el.innerHTML = '<p class="empty-msg">No courses added yet</p>';
    return;
  }

  el.innerHTML = state.mySchedule.map(course => {
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
