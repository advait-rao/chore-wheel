#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const CSV_PATH = path.resolve(__dirname, '..', 'chores.csv');
const EXPECTED_LAST_DATE = '2026-12-30';

const innerCycle = [
  ['Advait', 'Euan', 'Michael'],
  ['Michael', 'Advait', 'Euan'],
  ['Euan', 'Michael', 'Advait'],
];

const weeklyCycle = [
  ['Michael', 'Advait', 'Euan'],
  ['Euan', 'Michael', 'Advait'],
  ['Advait', 'Euan', 'Michael'],
];

function parseCsv(text) {
  const lines = text.trim().split('\n');
  const headers = lines.shift().split(',').map((h) => h.trim());
  return lines.map((line) => {
    const values = line.split(',').map((v) => v.trim());
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    return row;
  });
}

function dateToUtc(dateText) {
  return new Date(`${dateText}T00:00:00Z`);
}

function fail(message, failures) {
  failures.push(message);
}

function validate() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`Missing file: ${CSV_PATH}`);
    process.exit(1);
  }

  const csv = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCsv(csv);
  const failures = [];

  if (!rows.length) {
    fail('No rows found in chores.csv.', failures);
  }

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const date = dateToUtc(row.date);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
      fail(`Row ${i + 2}: invalid date format "${row.date}".`, failures);
      continue;
    }

    if (Number.isNaN(date.getTime())) {
      fail(`Row ${i + 2}: invalid date "${row.date}".`, failures);
      continue;
    }

    if (date.getUTCDay() !== 3) {
      fail(`Row ${i + 2}: ${row.date} is not a Wednesday.`, failures);
    }

    if (i > 0) {
      const prev = dateToUtc(rows[i - 1].date);
      const days = (date - prev) / (24 * 60 * 60 * 1000);
      if (days !== 7) {
        fail(
          `Row ${i + 2}: expected 7-day cadence from ${rows[i - 1].date} to ${row.date}, got ${days} days.`,
          failures,
        );
      }
    }

    const [expectedKitchen, expectedLivingRoom, expectedBathroom] =
      innerCycle[Math.floor(i / 2) % innerCycle.length];
    const [expectedDishwasher, expectedShopping, expectedBins] =
      weeklyCycle[i % weeklyCycle.length];
    const expectedRubbish = i % 2 === 0 ? 'Glass' : 'Recycling';

    if (
      row.Kitchen !== expectedKitchen ||
      row['Living Room'] !== expectedLivingRoom ||
      row.Bathroom !== expectedBathroom
    ) {
      fail(
        `Row ${i + 2}: inner chores rotation mismatch on ${row.date}.`,
        failures,
      );
    }

    if (
      row.Dishwasher !== expectedDishwasher ||
      row.Shopping !== expectedShopping ||
      row.Bins !== expectedBins
    ) {
      fail(
        `Row ${i + 2}: weekly chores rotation mismatch on ${row.date}.`,
        failures,
      );
    }

    if (row['Rubbish Type'] !== expectedRubbish) {
      fail(
        `Row ${i + 2}: rubbish type mismatch on ${row.date}, expected ${expectedRubbish}.`,
        failures,
      );
    }
  }

  const lastDate = rows[rows.length - 1]?.date;
  if (lastDate !== EXPECTED_LAST_DATE) {
    fail(
      `Expected schedule to extend through ${EXPECTED_LAST_DATE}, found ${lastDate || 'no last row'}.`,
      failures,
    );
  }

  if (failures.length) {
    console.error('Schedule validation failed:');
    failures.forEach((message) => console.error(`- ${message}`));
    process.exit(1);
  }

  console.log(
    `Schedule validation passed: ${rows.length} weekly rows from ${rows[0].date} to ${rows[rows.length - 1].date}.`,
  );
}

validate();
