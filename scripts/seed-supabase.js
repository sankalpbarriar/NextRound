const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');

function loadDotEnv(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;

      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      process.env[match[1]] = value;
    }
  } catch (error) {
    // Ignore if .env is not present; the process may already have env vars set.
  }
}

loadDotEnv(path.join(rootDir, '.env'));

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing environment variables. Copy .env.example to .env and fill in your Supabase values.');
  process.exit(1);
}

const baseUrl = supabaseUrl.replace(/\/+$/, '');

function normalizeDate(value) {
  if (!value || value === 'null') return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return value;

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(value))) {
    const [month, day, year] = String(value).split('/');
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  if (/^\d{2}\.\d{2}\.\d{4}$/.test(String(value))) {
    const [day, month, year] = String(value).split('.');
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  return null;
}

function loadLegacyRecords() {
  const filePath = path.join(rootDir, 'historical-data.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return context.window.nextRoundLegacy || [];
}

function loadFinanceRecords() {
  const filePath = path.join(rootDir, 'finance-data.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return context.window.defaultFinances || [];
}

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"' && quoted) {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(value.trim());
      value = '';
    } else {
      value += character;
    }
  }
  values.push(value.trim());
  return values;
}

function loadInterviewRecords() {
  const filePath = path.join(rootDir, 'assets', 'interview-records.csv');
  const lines = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).slice(1);
  return lines.map(line => {
    const [id, candidateName, phone, interviewDate, interviewerDetails] = parseCsvLine(line);
    return {
      candidate_name: candidateName,
      interviewer_details: interviewerDetails,
      candidate_email: '',
      candidate_phone: phone,
      interview_date: normalizeDate(interviewDate),
      interview_time: '',
      google_meet_link: '',
      scheduled_by: 'Imported from interview records sheet',
      status: 'Done',
      details: 'Imported historical interview record'
    };
  }).filter(row => row.candidate_name && row.interview_date);
}

async function supabaseRequest(table, method = 'GET', payload) {
  const url = `${baseUrl}/rest/v1/${table}`;
  const response = await fetch(url, {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: payload ? JSON.stringify(payload) : undefined
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${table} request failed (${response.status}): ${text}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function hasRows(table) {
  const rows = await supabaseRequest(`${table}?select=id&limit=1`, 'GET');
  return Array.isArray(rows) && rows.length > 0;
}

function buildApplications(rows) {
  return rows.map((row) => ({
    name: String(row.name || '').trim(),
    email: row.email || null,
    whatsapp: row.whatsapp || null,
    college: row.college || null,
    semester: row.semester || null,
    branch: row.branch || null,
    technology: row.technology || null,
    languages: row.languages || null,
    preferred_date: normalizeDate(row.preferredDate || row.preferred_date || null),
    interview_format: row.format || row.interview_format || null,
    notes: row.notes || null,
    payment_proof_url: row.paymentProof || row.payment_proof_url || null
  })).filter((row) => row.name);
}

function buildFinance(rows) {
  return rows.map((row) => ({
    interview_date: normalizeDate(row.date || row.interview_date || null),
    candidate: String(row.candidate || '').trim(),
    taken_by: row.takenBy || row.taken_by || 'Unknown',
    amount: Number(row.amount ?? 79),
    status: row.status || row.interviewStatus || 'Pending'
  })).filter((row) => row.candidate);
}

async function main() {
  const legacyRows = loadLegacyRecords();
  const financeRows = loadFinanceRecords();
  const interviewRows = loadInterviewRecords();

  const appSeed = buildApplications(legacyRows);
  const financeSeed = buildFinance(financeRows);

  if (!appSeed.length && !financeSeed.length && !interviewRows.length) {
    console.log('No seed data found.');
    return;
  }

  const applicationsExists = await hasRows('applications');
  if (applicationsExists) {
    console.log('applications already has rows; skipping seed for that table.');
  } else if (appSeed.length) {
    await supabaseRequest('applications', 'POST', appSeed);
    console.log(`Seeded ${appSeed.length} application rows into applications.`);
  }

  const financeExists = await hasRows('finance_records');
  if (financeExists) {
    console.log('finance_records already has rows; skipping seed for that table.');
  } else if (financeSeed.length) {
    await supabaseRequest('finance_records', 'POST', financeSeed);
    console.log(`Seeded ${financeSeed.length} rows into finance_records.`);
  }

  const interviewsExist = await hasRows('scheduled_interviews');
  if (interviewsExist) {
    console.log('scheduled_interviews already has rows; skipping seed for that table.');
  } else if (interviewRows.length) {
    await supabaseRequest('scheduled_interviews', 'POST', interviewRows);
    console.log(`Seeded ${interviewRows.length} historical rows into scheduled_interviews.`);
  }

  console.log('Supabase seeding completed.');
}

main().catch((error) => {
  console.error('Seeding failed:');
  console.error(error);
  process.exit(1);
});
