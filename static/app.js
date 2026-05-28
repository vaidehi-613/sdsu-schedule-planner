// ── Constants ────────────────────────────────────────────
const SCHEDULE_COLORS = [
  '#4A90D9', '#E8892B', '#27AE60', '#9B59B6',
  '#16A085', '#D35400', '#2980B9', '#C0392B',
  '#8E44AD', '#1ABC9C',
];

// ── Application state ────────────────────────────────────
const state = {
  courses: [],       // all courses returned by the API
  schedule: [],      // courses the user has added
  courseColors: {},  // classNbr → hex color
  colorIdx: 0,
};

// ── Theme ────────────────────────────────────────────────
function toggleTheme() {
  document.body.classList.toggle('dark');
}

// ── Filter UI  (visual only — API call wired in next phase) ──
function onMajorChange(value) {
  document.getElementById('badge-major').textContent = value;
}

function onLevelChange(btn) {
  document.querySelectorAll('#level-group .pill')
    .forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('badge-level').textContent =
    btn.dataset.value === 'grad' ? 'Graduate' : 'Undergrad';
}

function togglePill(btn) {
  btn.classList.toggle('active');
}

// ── Tab switching ────────────────────────────────────────
function switchTab(btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  btn.classList.add('active');
  document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
}

// ── API ──────────────────────────────────────────────────
async function fetchCourses() {
  const spinner  = document.getElementById('spinner');
  const listEl   = document.getElementById('course-list');
  const noMsg    = document.getElementById('no-courses');

  spinner.classList.remove('hidden');
  listEl.innerHTML = '';
  noMsg.classList.add('hidden');

  try {
    const res = await fetch('/api/courses?major=Computer+Science&level=grad');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.courses = await res.json();
  } catch (err) {
    console.error('fetchCourses:', err);
    state.courses = [];
  }

  spinner.classList.add('hidden');
  renderCourseList();
}

// ── Time / conflict helpers ──────────────────────────────
function parseTime(s) {
  if (!s) return null;
  const m = s.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!m) return null;
  let h = +m[1];
  const min = +m[2];
  const pm = m[3].toUpperCase() === 'PM';
  if (pm && h !== 12) h += 12;
  if (!pm && h === 12) h = 0;
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

  const isOnline = ['ON', 'OE'].includes(course.mode) || course.room === 'ONLINE';
  const roomIcon = isOnline ? 'ti-wifi' : 'ti-building';
  const roomText = isOnline ? 'Online' : (course.room || 'TBA');
  const dayPrefix = course.days && course.days !== 'ARR' ? course.days + ' · ' : '';
  const instructor = course.instructor || 'TBA';

  const [avCls, avTxt] = availBadge(course.seats_available);

  let btn = '';
  let extra = '';

  if (isAdded) {
    btn = `<button class="add-btn added" onclick="removeCourse(${course.class_nbr})">Added ✓</button>`;
  } else if (conflict) {
    extra = `<span class="conflict-chip">⚠ Conflicts with ${conflict.subject} ${conflict.catalog_nbr}</span>`;
    btn = `<button class="add-btn" disabled>Conflict</button>`;
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
document.addEventListener('DOMContentLoaded', fetchCourses);
