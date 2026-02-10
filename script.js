const CSV_PATH = 'chores.csv';

const weekChip = document.getElementById('weekChip');
const summaryList = document.getElementById('summaryList');
const nextSummaryList = document.getElementById('nextSummaryList');
const changeNote = document.getElementById('changeNote');
const previewButton = document.getElementById('previewButton');
const previewPopover = document.getElementById('previewPopover');
const modalClose = document.getElementById('modalClose');
const themeToggle = document.getElementById('themeToggle');
const summarySection = document.querySelector('.summary');

const innerChores = ['Kitchen', 'Living Room', 'Bathroom'];
const weeklyChores = ['Dishwasher', 'Shopping', 'Bins'];
const orderedNames = ['Advait', 'Michael', 'Euan'];
const NZ_TIMEZONE = 'Pacific/Auckland';

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.error('Service worker registration failed:', error);
    });
  });
}

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

function formatDateInNZ(date) {
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: NZ_TIMEZONE,
  });
}

function getDateKeyInNZ(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NZ_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  return `${year}-${month}-${day}`;
}

function dateFromKey(dateKey) {
  // Use midnight UTC so NZ timezone stays on the intended local date.
  return new Date(`${dateKey}T00:00:00Z`);
}

function findActiveDate(dateKeys, todayKey) {
  const sorted = [...dateKeys].sort();
  const last = sorted[sorted.length - 1];
  const first = sorted[0];

  let active = first;
  for (const key of sorted) {
    if (key <= todayKey) {
      active = key;
    }
  }

  return { active, first, last, sorted };
}

function getWeekdayIndexInNZ(date) {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: NZ_TIMEZONE,
    weekday: 'short',
  }).format(date);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[weekday];
}

function getNextWednesdayKey(fromKey) {
  const base = dateFromKey(fromKey);
  for (let i = 1; i <= 7; i += 1) {
    const candidate = new Date(base);
    candidate.setUTCDate(candidate.getUTCDate() + i);
    if (getWeekdayIndexInNZ(candidate) === 3) {
      return getDateKeyInNZ(candidate);
    }
  }
  return fromKey;
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

  const items = target.querySelectorAll('.summary-item');
  items.forEach((item, index) => {
    item.style.animationDelay = `${index * 80}ms`;
    requestAnimationFrame(() => {
      item.classList.add('reveal');
    });
  });
}

function setWeekChip() {
  weekChip.textContent = formatDateInNZ(new Date());
}

function positionPopover() {
  const buttonRect = previewButton.getBoundingClientRect();
  const summaryRect = summarySection.getBoundingClientRect();
  const popoverRect = previewPopover.getBoundingClientRect();
  const popoverWidth = popoverRect.width || previewPopover.offsetWidth;
  const popoverHeight = popoverRect.height || previewPopover.offsetHeight;

  const top = buttonRect.top - summaryRect.top - popoverHeight - 12;
  const preferredLeft = buttonRect.left - summaryRect.left;
  const maxLeft = summaryRect.width - popoverWidth - 16;
  const left = Math.min(Math.max(preferredLeft, 16), Math.max(maxLeft, 16));

  previewPopover.style.top = `${top}px`;
  previewPopover.style.left = `${left}px`;
}

function openPopover() {
  previewPopover.classList.remove('hidden');
  positionPopover();
  requestAnimationFrame(positionPopover);
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

    const dateKeys = [...new Set(rows.map((row) => row.date))];
    const todayKey = getDateKeyInNZ(new Date());

    const { active, first, last } = findActiveDate(dateKeys, todayKey);
    const activeRow = rows.find((row) => row.date === active);

    if (!activeRow) throw new Error('No assignments for the current week.');

    setWeekChip();
    renderSummary(summaryList, formatAssignments(activeRow));

    const nextWednesdayKey = getNextWednesdayKey(active);
    changeNote.textContent = `Chores change on ${formatDateInNZ(dateFromKey(nextWednesdayKey))}`;

    const nextRow = rows.find((row) => row.date === nextWednesdayKey);

    if (nextRow) {
      renderSummary(nextSummaryList, formatAssignments(nextRow));
    } else {
      renderSummary(nextSummaryList, ['No assignments available for next week.']);
    }

    setupThemeToggle();
    setupModal();

    if (todayKey < first) {
      changeNote.textContent = `Chores change on ${formatDateInNZ(dateFromKey(getNextWednesdayKey(first)))}`;
    } else if (todayKey > last) {
      changeNote.textContent = `Chores change on ${formatDateInNZ(dateFromKey(getNextWednesdayKey(last)))}`;
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
registerServiceWorker();
