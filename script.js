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

const reminderForm = document.getElementById('reminderForm');
const reminderFlatmate = document.getElementById('reminderFlatmate');
const reminderChore = document.getElementById('reminderChore');
const reminderWeekday = document.getElementById('reminderWeekday');
const reminderTime = document.getElementById('reminderTime');
const reminderEveryOccurrence = document.getElementById('reminderEveryOccurrence');
const reminderEveryOccurrenceLabel = document.getElementById('reminderEveryOccurrenceLabel');
const generateReminderButton = document.getElementById('generateReminderButton');
const reminderPopover = document.getElementById('reminderPopover');
const reminderPopoverClose = document.getElementById('reminderPopoverClose');
const reminderPanel = document.querySelector('.reminder-panel');
const reminderResult = document.getElementById('reminderResult');
const reminderStatus = document.getElementById('reminderStatus');
const addToCalendarButton = document.getElementById('addToCalendarButton');
const downloadIcsButton = document.getElementById('downloadIcsButton');

const innerChores = ['Kitchen', 'Living Room', 'Bathroom'];
const weeklyChores = ['Dishwasher', 'Shopping', 'Bins'];
const allChores = [...innerChores, ...weeklyChores];
const orderedNames = ['Advait', 'Michael', 'Euan'];
const NZ_TIMEZONE = 'Pacific/Auckland';
const weekdayOrder = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

let scheduleRows = [];
let generatedReminder = null;

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');
      registration.update();

      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            newWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    } catch (error) {
      console.error('Service worker registration failed:', error);
    }
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

function getMinutesInNZ(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: NZ_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return (hour * 60) + minute;
}

function dateFromKey(dateKey) {
  return new Date(`${dateKey}T00:00:00Z`);
}

function addDaysToDateKey(dateKey, days) {
  const date = dateFromKey(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

function animateReminderPanel() {
  const animationTargets = Array.from(
    reminderPanel.querySelectorAll('[data-reminder-animate]'),
  );

  animationTargets.forEach((target) => {
    target.classList.remove('reveal');
    target.style.animationDelay = '0ms';
  });

  requestAnimationFrame(() => {
    animationTargets.forEach((target, index) => {
      target.style.animationDelay = `${index * 80}ms`;
      target.classList.add('reveal');
    });
  });
}

function initTabs() {
  const tabButtons = Array.from(document.querySelectorAll('[data-tab-target]'));
  const panels = Array.from(document.querySelectorAll('[data-tab-panel]'));

  function activatePanel(targetId) {
    tabButtons.forEach((button) => {
      const isActive = button.dataset.tabTarget === targetId;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', String(isActive));
    });

    panels.forEach((panel) => {
      const isActive = panel.id === targetId;
      panel.classList.toggle('is-active', isActive);
      panel.toggleAttribute('hidden', !isActive);
    });

    if (targetId !== 'panelChores') {
      closePopover();
    }

    if (targetId !== 'panelReminder') {
      closeReminderPopover();
    }

    if (targetId === 'panelReminder') {
      animateReminderPanel();
    }
  }

  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activatePanel(button.dataset.tabTarget);
    });
  });
}

function validateReminderForm(values) {
  const errors = [];

  if (!orderedNames.includes(values.flatmate)) {
    errors.push('Select a valid flatmate.');
  }

  if (!allChores.includes(values.chore)) {
    errors.push('Select a valid chore.');
  }

  if (!weekdayOrder.includes(values.weekday)) {
    errors.push('Select a valid weekday.');
  }

  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(values.time)) {
    errors.push('Select a valid reminder time.');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

function updateEveryOccurrenceLabel() {
  reminderEveryOccurrenceLabel.textContent = 'Remind on each occurence';
}

function updateGenerateReminderButtonState() {
  generateReminderButton.disabled = !orderedNames.includes(reminderFlatmate.value);
}

function computeReminderDatesFromSchedule(rows, values) {
  const weekdayIndex = weekdayOrder.indexOf(values.weekday);
  const timeMinutes = Number(values.time.slice(0, 2)) * 60 + Number(values.time.slice(3, 5));
  const now = new Date();
  const nowDateKey = getDateKeyInNZ(now);
  const nowMinutes = getMinutesInNZ(now);
  const occurrences = [];

  for (const row of rows) {
    if (row[values.chore] !== values.flatmate) continue;

    const weekStart = dateFromKey(row.date);
    const weekStartWeekday = weekStart.getUTCDay();
    const dayOffset = (weekdayIndex - weekStartWeekday + 7) % 7;
    const reminderDateKey = addDaysToDateKey(row.date, dayOffset);

    const isFutureDate = reminderDateKey > nowDateKey;
    const isCurrentDateFutureTime = reminderDateKey === nowDateKey && timeMinutes >= nowMinutes;

    if (isFutureDate || isCurrentDateFutureTime) {
      occurrences.push({
        dateKey: reminderDateKey,
        time: values.time,
        flatmate: values.flatmate,
        chore: values.chore,
        rubbishType: row['Rubbish Type'] || '',
      });
    }

    if (!values.everyOccurrence && occurrences.length > 0) {
      break;
    }
  }

  return occurrences;
}

function escapeIcsText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function toIcsDateTime(dateKey, time) {
  const compactDate = dateKey.replace(/-/g, '');
  const compactTime = `${time.replace(':', '')}00`;
  return `${compactDate}T${compactTime}`;
}

function toIcsStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function foldIcsLine(line) {
  const maxLength = 74;
  if (line.length <= maxLength) {
    return [line];
  }

  const folded = [];
  let remaining = line;
  folded.push(remaining.slice(0, maxLength));
  remaining = remaining.slice(maxLength);

  while (remaining.length > maxLength - 1) {
    folded.push(` ${remaining.slice(0, maxLength - 1)}`);
    remaining = remaining.slice(maxLength - 1);
  }

  if (remaining.length) {
    folded.push(` ${remaining}`);
  }

  return folded;
}

function serializeIcsLines(lines) {
  return lines.flatMap((line) => foldIcsLine(line)).join('\r\n');
}

function buildSeriesEventLines({
  uid,
  summary,
  description,
  dateItems,
  time,
}) {
  const sortedDates = [...dateItems].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const firstDateKey = sortedDates[0].dateKey;
  const lastDateKey = sortedDates[sortedDates.length - 1].dateKey;

  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toIcsStamp()}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `DTSTART;TZID=${NZ_TIMEZONE}:${toIcsDateTime(firstDateKey, time)}`,
  ];

  if (sortedDates.length > 1) {
    const desiredDateKeys = new Set(sortedDates.map((dateItem) => dateItem.dateKey));
    const excludedDateTimes = [];
    let weeklySlotCount = 1;
    let cursorDateKey = firstDateKey;

    while (cursorDateKey < lastDateKey) {
      cursorDateKey = addDaysToDateKey(cursorDateKey, 7);
      weeklySlotCount += 1;

      if (!desiredDateKeys.has(cursorDateKey)) {
        excludedDateTimes.push(toIcsDateTime(cursorDateKey, time));
      }
    }

    lines.push(`RRULE:FREQ=WEEKLY;COUNT=${weeklySlotCount}`);
    excludedDateTimes.forEach((excludedDateTime) => {
      lines.push(`EXDATE;TZID=${NZ_TIMEZONE}:${excludedDateTime}`);
    });
  }

  lines.push(
    'BEGIN:VALARM',
    'TRIGGER:PT0M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcsText(summary)}`,
    'END:VALARM',
    'END:VEVENT',
  );

  return lines;
}

function buildReminderIcs(values, reminderDates) {
  if (!reminderDates.length) {
    throw new Error('No reminder dates to include in ICS file.');
  }

  const normalizedDates = [...reminderDates].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const firstOccurrence = normalizedDates[0];
  const isRecurringSeries = values.everyOccurrence && normalizedDates.length > 1;
  const isBinsSeries = values.chore === 'Bins';
  const uidBase = `chore-roster-${values.flatmate.toLowerCase()}-${values.chore.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}@local`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Chore Roster//Reminder//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  if (isBinsSeries && isRecurringSeries) {
    const binsByType = new Map();
    normalizedDates.forEach((dateItem) => {
      const type = dateItem.rubbishType || 'Unknown';
      if (!binsByType.has(type)) {
        binsByType.set(type, []);
      }
      binsByType.get(type).push(dateItem);
    });

    binsByType.forEach((dateItems, type) => {
      const seriesUid = `${uidBase}-${type.toLowerCase().replace(/\s+/g, '-')}`;
      const summary = `Chore reminder: ${values.flatmate} on Bins (${type})`;
      const description = `Reminder generated by Chore Roster for ${values.flatmate}. Chore: Bins (${type}).`;

      lines.push(
        ...buildSeriesEventLines({
          uid: seriesUid,
          summary,
          description,
          dateItems,
          time: values.time,
        }),
      );
    });
  } else {
    const choreLabel = isBinsSeries
      ? `Bins (${firstOccurrence.rubbishType || 'Unknown'})`
      : values.chore;
    const summary = `Chore reminder: ${values.flatmate} on ${choreLabel}`;
    const description = `Reminder generated by Chore Roster for ${values.flatmate}. Chore: ${choreLabel}.`;

    lines.push(
      ...buildSeriesEventLines({
        uid: uidBase,
        summary,
        description,
        dateItems: normalizedDates,
        time: values.time,
      }),
    );
  }

  lines.push('END:VCALENDAR', '');

  return `${serializeIcsLines(lines)}\r\n`;
}

async function openOrDownloadIcs(icsContent, fileName, mode = 'open') {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);

  if (mode === 'url') {
    return objectUrl;
  }

  if (mode === 'download') {
    const downloadLink = document.createElement('a');
    downloadLink.href = objectUrl;
    downloadLink.download = fileName;
    downloadLink.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return objectUrl;
  }

  const openLink = document.createElement('a');
  openLink.href = objectUrl;
  openLink.rel = 'noreferrer';
  openLink.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);

  return objectUrl;
}

function formatReminderDisplay(dateItem) {
  const dateLabel = formatDateInNZ(dateFromKey(dateItem.dateKey));
  const [hourText, minuteText] = dateItem.time.split(':');
  const meridian = Number(hourText) >= 12 ? 'PM' : 'AM';
  const hour12 = Number(hourText) % 12 || 12;
  const minute = minuteText.padStart(2, '0');
  return `${dateLabel} ${hour12}:${minute} ${meridian}`;
}

function positionReminderPopover() {
  const buttonRect = generateReminderButton.getBoundingClientRect();
  const panelRect = reminderPanel.getBoundingClientRect();
  const popoverRect = reminderPopover.getBoundingClientRect();
  const popoverWidth = popoverRect.width || reminderPopover.offsetWidth;
  const popoverHeight = popoverRect.height || reminderPopover.offsetHeight;

  const preferredTop = buttonRect.bottom - panelRect.top + 10;
  const maxTop = panelRect.height - popoverHeight - 12;
  const top = Math.max(12, Math.min(preferredTop, maxTop));

  const preferredLeft = buttonRect.left - panelRect.left;
  const maxLeft = panelRect.width - popoverWidth - 12;
  const left = Math.min(Math.max(preferredLeft, 12), Math.max(maxLeft, 12));

  reminderPopover.style.top = `${top}px`;
  reminderPopover.style.left = `${left}px`;
}

function openReminderPopover() {
  reminderPopover.classList.remove('hidden');
  positionReminderPopover();
  requestAnimationFrame(positionReminderPopover);
}

function closeReminderPopover() {
  reminderPopover.classList.add('hidden');
}

function setupReminderPopover() {
  reminderPopoverClose.addEventListener('click', closeReminderPopover);

  document.addEventListener('click', (event) => {
    if (reminderPopover.classList.contains('hidden')) return;

    const clickedInsidePopover = reminderPopover.contains(event.target);
    const clickedTrigger = event.target === generateReminderButton;
    if (!clickedInsidePopover && !clickedTrigger) {
      closeReminderPopover();
    }
  });

  window.addEventListener('resize', () => {
    if (!reminderPopover.classList.contains('hidden')) {
      positionReminderPopover();
    }
  });
}

function clearGeneratedReminder() {
  generatedReminder = null;
  closeReminderPopover();
}

function setReminderStatus(message) {
  reminderStatus.textContent = message;
}

function initReminderFeature(rows) {
  reminderFlatmate.innerHTML = '';
  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = 'flatmate';
  placeholderOption.disabled = true;
  placeholderOption.selected = true;
  reminderFlatmate.appendChild(placeholderOption);

  orderedNames.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    reminderFlatmate.appendChild(option);
  });

  reminderChore.innerHTML = '';
  allChores.forEach((chore) => {
    const option = document.createElement('option');
    option.value = chore;
    option.textContent = chore;
    reminderChore.appendChild(option);
  });

  reminderFlatmate.value = '';
  reminderChore.value = 'Bins';
  reminderWeekday.value = 'Tuesday';
  reminderTime.value = '20:00';
  updateEveryOccurrenceLabel();
  updateGenerateReminderButtonState();

  reminderFlatmate.addEventListener('change', () => {
    updateEveryOccurrenceLabel();
    updateGenerateReminderButtonState();
  });

  reminderForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const values = {
      flatmate: reminderFlatmate.value,
      chore: reminderChore.value,
      weekday: reminderWeekday.value,
      time: reminderTime.value,
      everyOccurrence: reminderEveryOccurrence.checked,
    };

    const validation = validateReminderForm(values);
    if (!validation.isValid) {
      clearGeneratedReminder();
      setReminderStatus(validation.errors.join(' '));
      return;
    }

    const reminderDates = computeReminderDatesFromSchedule(rows, values);
    if (!reminderDates.length) {
      clearGeneratedReminder();
      setReminderStatus('No future reminder dates found in the current schedule.');
      return;
    }

    const icsContent = buildReminderIcs(values, reminderDates);
    const sanitizedFlatmate = values.flatmate.toLowerCase().replace(/\s+/g, '-');
    const sanitizedChore = values.chore.toLowerCase().replace(/\s+/g, '-');
    const fileName = `${sanitizedFlatmate}-${sanitizedChore}-reminder.ics`;

    clearGeneratedReminder();
    generatedReminder = {
      icsContent,
      fileName,
      reminderDates,
      flatmate: values.flatmate,
      everyOccurrence: values.everyOccurrence,
      chore: values.chore,
    };

    const firstOccurrence = formatReminderDisplay(reminderDates[0]);
    const firstChoreLabel = values.chore === 'Bins'
      ? `Bins (${reminderDates[0].rubbishType || 'Unknown'})`
      : values.chore;
    const occurrenceLabel = values.everyOccurrence
      ? `${reminderDates.length} reminders ready for ${values.flatmate} on ${values.chore}. First reminder: ${values.flatmate} on ${firstChoreLabel} at ${firstOccurrence}.`
      : `1 reminder ready for ${values.flatmate} on ${firstChoreLabel} at ${firstOccurrence}.`;

    reminderResult.textContent = occurrenceLabel;
    openReminderPopover();
    setReminderStatus('');
  });

  addToCalendarButton.addEventListener('click', async () => {
    if (!generatedReminder) {
      setReminderStatus('Generate a reminder first.');
      return;
    }

    try {
      await openOrDownloadIcs(generatedReminder.icsContent, generatedReminder.fileName, 'open');
      setReminderStatus('Calendar import opened. Use the download button if your browser blocks the import.');
    } catch (error) {
      setReminderStatus('Could not open calendar import. Use the download button instead.');
      console.error(error);
    }
  });

  downloadIcsButton.addEventListener('click', async () => {
    if (!generatedReminder) {
      setReminderStatus('Generate a reminder first.');
      return;
    }

    try {
      await openOrDownloadIcs(generatedReminder.icsContent, generatedReminder.fileName, 'download');
      setReminderStatus('Invite downloaded.');
    } catch (error) {
      setReminderStatus('Download failed. Try Generate reminder again.');
      console.error(error);
    }
  });

  window.addEventListener('beforeunload', () => {
    generatedReminder = null;
  });
}

async function init() {
  try {
    const response = await fetch(CSV_PATH);
    if (!response.ok) throw new Error('CSV not found.');

    const text = await response.text();
    scheduleRows = parseCsv(text);

    const dateKeys = [...new Set(scheduleRows.map((row) => row.date))];
    const todayKey = getDateKeyInNZ(new Date());

    const { active, first, last } = findActiveDate(dateKeys, todayKey);
    const activeRow = scheduleRows.find((row) => row.date === active);

    if (!activeRow) throw new Error('No assignments for the current week.');

    setWeekChip();
    renderSummary(summaryList, formatAssignments(activeRow));

    const nextWednesdayKey = getNextWednesdayKey(active);
    changeNote.textContent = `Chores change on ${formatDateInNZ(dateFromKey(nextWednesdayKey))}`;

    const nextRow = scheduleRows.find((row) => row.date === nextWednesdayKey);

    if (nextRow) {
      renderSummary(nextSummaryList, formatAssignments(nextRow));
    } else {
      renderSummary(nextSummaryList, ['No assignments available for next week.']);
    }

    if (todayKey < first) {
      changeNote.textContent = `Chores change on ${formatDateInNZ(dateFromKey(getNextWednesdayKey(first)))}`;
    } else if (todayKey > last) {
      changeNote.textContent = `Chores change on ${formatDateInNZ(dateFromKey(getNextWednesdayKey(last)))}`;
    }

    setupThemeToggle();
    setupModal();
    setupReminderPopover();
    initTabs();
    initReminderFeature(scheduleRows);
  } catch (error) {
    weekChip.textContent = 'Unable to load chores.';
    if (window.location.protocol === 'file:') {
      changeNote.textContent = 'Open this page through a local server (not file://) so fetch can read chores.csv.';
    } else {
      changeNote.textContent = 'Check that chores.csv is present in the same folder.';
    }
    setReminderStatus('Reminder setup failed because chores.csv could not be loaded.');
    console.error(error);
  }
}

init();
registerServiceWorker();
