const CSV_PATH = 'chores.csv';

const weekChip = document.getElementById('weekChip');
const summaryList = document.getElementById('summaryList');
const nextSummaryList = document.getElementById('nextSummaryList');
const changeNote = document.getElementById('changeNote');
const previewButton = document.getElementById('previewButton');
const previewPopover = document.getElementById('previewPopover');
const modalClose = document.getElementById('modalClose');
const themeToggle = document.getElementById('themeToggle');

const innerChores = ['Kitchen', 'Living Room', 'Bathroom'];
const weeklyChores = ['Dishwasher', 'Shopping', 'Bins'];
const orderedNames = ['Advait', 'Michael', 'Euan'];

function parseCsv(text) {
  const lines = text.trim().split('\n');
  const headers = lines.shift().split(',');

  return lines.map((line) => {
    const values = line.split(',');
    const row = {};
    headers.forEach((header, index) => {
      row[header.trim()] = values[index]?.trim();
    });
    return row;
  });
}

function toLocalDate(dateString) {
  return new Date(`${dateString}T00:00:00`);
}

function formatDate(date) {
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function toLocalISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function findActiveDate(dates, today) {
  const sorted = [...dates].sort((a, b) => a - b);
  const last = sorted[sorted.length - 1];
  const first = sorted[0];

  let active = first;
  for (const date of sorted) {
    if (date <= today) {
      active = date;
    }
  }

  return { active, first, last, sorted };
}

function getNextWednesday(date) {
  const next = new Date(date);
  const day = next.getDay();
  const daysUntilWednesday = (3 - day + 7) % 7 || 7;
  next.setDate(next.getDate() + daysUntilWednesday);
  next.setHours(0, 0, 0, 0);
  return next;
}

function formatAssignments(row) {
  return orderedNames.map((name) => {
    const biWeekly = innerChores.find((chore) => row[chore] === name) || 'Unknown';
    const weekly = weeklyChores.find((chore) => row[chore] === name) || 'Unknown';
    const rubbishType = row['Rubbish Type'] || 'Unknown';
    return { name, weekly, biWeekly, rubbishType };
  });
}

function renderSummary(target, lines) {
  target.innerHTML = '';
  lines.forEach((line) => {
    const item = document.createElement('div');
    item.className = 'summary-item';
    if (typeof line === 'string') {
      item.textContent = line;
    } else {
      const nameEl = document.createElement('span');
      nameEl.className = 'summary-name';
      nameEl.textContent = line.name;

      const verbEl = document.createElement('span');
      verbEl.className = 'summary-verb';
      verbEl.textContent = ' is on ';

      const weeklyEl = document.createElement('span');
      weeklyEl.className = 'summary-chore';
      if (line.weekly === 'Bins') {
        weeklyEl.textContent = `Bins (${line.rubbishType})`;
      } else {
        weeklyEl.textContent = line.weekly;
      }

      const andEl = document.createElement('span');
      andEl.className = 'summary-verb';
      andEl.textContent = ' and ';

      const biWeeklyEl = document.createElement('span');
      biWeeklyEl.className = 'summary-chore highlight';
      biWeeklyEl.textContent = line.biWeekly;

      item.append(nameEl, verbEl, weeklyEl, andEl, biWeeklyEl);
    }
    target.appendChild(item);
  });
}

function setWeekChip() {
  weekChip.textContent = formatDate(new Date());
}

function positionPopover() {
  const buttonRect = previewButton.getBoundingClientRect();
  const pageTop = window.scrollY;
  const pageLeft = window.scrollX;

  const top = buttonRect.bottom + 12 + pageTop;
  const left = Math.min(
    pageLeft + buttonRect.left,
    pageLeft + window.innerWidth - previewPopover.offsetWidth - 16
  );

  previewPopover.style.top = `${top}px`;
  previewPopover.style.left = `${left}px`;
}

function openPopover() {
  previewPopover.classList.remove('hidden');
  positionPopover();
}

function closePopover() {
  previewPopover.classList.add('hidden');
}

function setupModal() {
  previewButton.addEventListener('click', () => {
    if (previewPopover.classList.contains('hidden')) {
      openPopover();
    } else {
      closePopover();
    }
  });

  modalClose.addEventListener('click', closePopover);

  document.addEventListener('click', (event) => {
    if (
      !previewPopover.contains(event.target) &&
      event.target !== previewButton
    ) {
      closePopover();
    }
  });

  window.addEventListener('resize', () => {
    if (!previewPopover.classList.contains('hidden')) {
      positionPopover();
    }
  });
}

function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    themeToggle.checked = true;
  } else {
    document.documentElement.removeAttribute('data-theme');
    themeToggle.checked = false;
  }
}

function setupThemeToggle() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initial = saved || (prefersDark ? 'dark' : 'light');
  applyTheme(initial);

  themeToggle.addEventListener('change', () => {
    const next = themeToggle.checked ? 'dark' : 'light';
    applyTheme(next);
    localStorage.setItem('theme', next);
  });
}

async function init() {
  try {
    const response = await fetch(CSV_PATH);
    if (!response.ok) throw new Error('CSV not found.');

    const text = await response.text();
    const rows = parseCsv(text);

    const dates = [...new Set(rows.map((row) => row.date))].map(toLocalDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { active, first, last, sorted } = findActiveDate(dates, today);
    const activeKey = toLocalISODate(active);
    const activeRow = rows.find((row) => row.date === activeKey);

    if (!activeRow) throw new Error('No assignments for the current week.');

    setWeekChip();
    renderSummary(summaryList, formatAssignments(activeRow));

    const nextWednesday = getNextWednesday(active);
    changeNote.textContent = `Chores change on ${formatDate(nextWednesday)}`;

    const nextKey = toLocalISODate(nextWednesday);
    const nextRow = rows.find((row) => row.date === nextKey);

    if (nextRow) {
      renderSummary(nextSummaryList, formatAssignments(nextRow));
    } else {
      renderSummary(nextSummaryList, ['No assignments available for next week.']);
    }

    setupThemeToggle();
    setupModal();

    if (today < first) {
      changeNote.textContent = `Chores change on ${formatDate(getNextWednesday(first))}`;
    } else if (today > last) {
      changeNote.textContent = `Chores change on ${formatDate(getNextWednesday(last))}`;
    }
  } catch (error) {
    weekChip.textContent = 'Unable to load chores.';
    if (window.location.protocol === 'file:') {
      changeNote.textContent = 'Open this page through a local server (not file://) so fetch can read chores.csv.';
    } else {
      changeNote.textContent = 'Check that chores.csv is present in the same folder.';
    }
    console.error(error);
  }
}

init();
