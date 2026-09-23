const $ = (s) => document.querySelector(s);

function readStoredArray(key) {
  const stored = localStorage.getItem(key);

  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    localStorage.removeItem(key);
    console.warn(`Cleared invalid local storage value for ${key}.`, error);
    return [];
  }
}

const applications = readStoredArray('nextroundApplications');
let remoteApplications = [];
let remoteFinances = null;
let remoteSchedules = [];
let remoteAnnouncements = null;
let applicationPage = 1;
const applicationsPerPage = 10;
const save = () => localStorage.setItem('nextroundApplications', JSON.stringify(applications));

const supabaseConfig = window.SUPABASE_CONFIG || {};
const supabaseClient = window.SUPABASE_CLIENT || null;
const supabaseEnabled = Boolean(supabaseConfig.url && supabaseConfig.anonKey);
const adminEmails = Array.isArray(supabaseConfig.adminEmails)
  ? supabaseConfig.adminEmails.map(email => String(email).trim().toLowerCase()).filter(Boolean)
  : [String(supabaseConfig.adminEmail || '').trim().toLowerCase()].filter(Boolean);
const financeAdminEmail = String(supabaseConfig.financeAdminEmail || supabaseConfig.adminEmail || '').trim().toLowerCase();
let adminAuthorized = false;
let financeManagerAuthorized = false;
let announcementPanelOpen = false;
const ANNOUNCEMENT_STORAGE_KEY = 'nextroundAnnouncements';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getAnnouncements() {
  if (remoteAnnouncements) return remoteAnnouncements;
  const stored = localStorage.getItem(ANNOUNCEMENT_STORAGE_KEY);
  if (!stored) return [];

  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    localStorage.removeItem(ANNOUNCEMENT_STORAGE_KEY);
    return [];
  }
}

function saveAnnouncements(list) {
  remoteAnnouncements = list;
  localStorage.setItem(ANNOUNCEMENT_STORAGE_KEY, JSON.stringify(list));
}

function isAnnouncementActive(item) {
  if (item?.eventEnd) return new Date(item.eventEnd).getTime() > Date.now();
  if (!item?.eventDate) return true;
  const eventEnd = new Date(`${item.eventDate}T23:59:59`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return eventEnd >= today;
}

function renderAnnouncements() {
  const container = $('#liveAnnouncements');
  const notification = $('#announcementNotification');
  if (!container) return;

  const announcements = getAnnouncements()
    .filter(isAnnouncementActive)
    .sort((a, b) => new Date(a.eventDate || 0) - new Date(b.eventDate || 0));

  if (!announcements.length) {
    container.innerHTML = '';
    container.hidden = true;
    container.style.display = 'none';
    if (notification) notification.hidden = true;
    return;
  }

  if (notification) {
    notification.hidden = false;
    notification.setAttribute('aria-expanded', String(announcementPanelOpen));
  }
  container.hidden = !announcementPanelOpen;
  container.style.display = announcementPanelOpen ? 'grid' : 'none';
  container.innerHTML = `<div class="announcement-popup-header">
    <span class="announcement-popup-title">Live announcements</span>
    <button type="button" id="closeAnnouncementsBtn" class="announcement-popup-close" aria-label="Close announcements" onclick="closeAnnouncements()">×</button>
  </div>${announcements.map(item => {
    const meetText = item.meetLink ? `<a class="announcement-link" href="${escapeHtml(item.meetLink)}" target="_blank" rel="noopener noreferrer">Join Google Meet</a>` : '';
    const dateLabel = item.eventDate ? new Date(`${item.eventDate}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date TBD';
    const timeLabel = item.eventTime ? item.eventTime : 'Time TBD';

    return `
      <article class="live-announcement-card">
        <div class="announcement-topline">
          <span class="announcement-badge">Upcoming session</span>
          <span class="announcement-meta">${escapeHtml(item.guestName || 'Guest')}</span>
        </div>
        <h3>${escapeHtml(item.title || 'Event announcement')}</h3>
        <p>${escapeHtml(item.description || 'A new session is now open for registration.')}</p>
        <div class="announcement-meta">
          <span>📅 ${dateLabel}</span>
          <span>🕒 ${escapeHtml(timeLabel)}</span>
          <span>👤 ${escapeHtml(item.guestName || 'Guest')}</span>
        </div>
        ${meetText}
      </article>
    `;
  }).join('')}`;
}

window.closeAnnouncements = function () {
  announcementPanelOpen = false;
  const panel = $('#liveAnnouncements');
  const notification = $('#announcementNotification');
  if (panel) {
    panel.hidden = true;
    panel.style.display = 'none';
  }
  notification?.setAttribute('aria-expanded', 'false');
};

function renderAnnouncementAdminList() {
  const list = $('#announcementAdminList');
  if (!list) return;

  const announcements = getAnnouncements().sort((a, b) => {
    const dateA = a.eventDate ? new Date(`${a.eventDate}T00:00:00`).getTime() : 0;
    const dateB = b.eventDate ? new Date(`${b.eventDate}T00:00:00`).getTime() : 0;
    return dateB - dateA;
  });

  if (!announcements.length) {
    list.innerHTML = '<p class="empty-state">No announcements yet. Use “Add Announcement” to publish a live session.</p>';
    return;
  }

  list.innerHTML = announcements.map(item => {
    const active = isAnnouncementActive(item);
    const dateLabel = item.eventDate ? new Date(`${item.eventDate}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No date';
    return `
      <div class="announcement-admin-item ${active ? '' : 'expired'}">
        <div>
          <strong>${escapeHtml(item.title || 'Announcement')}</strong>
          <p>${escapeHtml(item.guestName || 'Guest')}</p>
          <small>${dateLabel}${item.eventTime ? ' • ' + escapeHtml(item.eventTime) : ''}</small>
        </div>
        <div class="announcement-admin-actions">
          <button type="button" onclick="editAnnouncement(${escapeHtml(String(item.id || ''))})">Edit</button>
          <button type="button" class="delete-btn" onclick="deleteAnnouncement(${escapeHtml(String(item.id || ''))})">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

function createAnnouncementItem(payload) {
  return {
    id: payload.id || Date.now(),
    title: payload.title || 'New announcement',
    guestName: payload.guestName || '',
    description: payload.description || '',
    eventDate: payload.eventDate || '',
    eventTime: payload.eventTime || '',
    eventEnd: payload.eventEnd || '',
    meetLink: payload.meetLink || ''
  };
}

function mapAnnouncement(row) {
  return createAnnouncementItem({
    id: row.id,
    title: row.title,
    guestName: row.guest_name,
    description: row.description,
    eventDate: row.event_date,
    eventTime: row.event_time,
    eventEnd: row.event_end,
    meetLink: row.meet_link
  });
}

async function loadAnnouncements(includeHistory = false) {
  if (!supabaseEnabled) return;

  try {
    const filter = includeHistory ? '' : `&event_end=gt.${encodeURIComponent(new Date().toISOString())}`;
    const rows = await supabaseRequest(`announcements?select=*&order=event_end.asc${filter}`);
    remoteAnnouncements = (rows || []).map(mapAnnouncement);
    renderAnnouncements();
    if (includeHistory) renderAnnouncementAdminList();
  } catch (error) {
    console.error(error);
    showToast('Announcements could not be loaded from Supabase.', 'error');
  }
}

window.editAnnouncement = function (id) {
  if (!financeManagerAuthorized) {
    showToast('Only the finance admin can edit announcements.', 'warning');
    return;
  }
  const item = getAnnouncements().find(entry => String(entry.id) === String(id));
  if (!item) return;
  $('#announcementId').value = item.id;
  $('#announcementTitle').value = item.title || '';
  $('#announcementGuest').value = item.guestName || '';
  $('#announcementDescription').value = item.description || '';
  $('#announcementDate').value = item.eventDate || '';
  $('#announcementTime').value = item.eventTime || '';
  $('#announcementEnd').value = item.eventEnd ? item.eventEnd.slice(0, 16) : '';
  $('#announcementMeetLink').value = item.meetLink || '';
  open('announcementModal');
};

window.deleteAnnouncement = async function (id) {
  if (!financeManagerAuthorized) {
    showToast('Only the finance admin can delete announcements.', 'warning');
    return;
  }
  if (!confirm('Delete this announcement?')) return;
  try {
    if (supabaseEnabled) {
      await supabaseRequest(`announcements?id=eq.${id}`, { method: 'DELETE' });
      await loadSupabaseData();
    } else {
      const list = getAnnouncements().filter(entry => String(entry.id) !== String(id));
      saveAnnouncements(list);
      renderAnnouncements();
      renderAnnouncementAdminList();
    }
    showToast('Announcement removed.', 'success');
  } catch (error) {
    console.error(error);
    showToast(`Unable to delete announcement: ${error.message || 'Check your Supabase policies.'}`, 'error');
  }
};

function resetAnnouncementForm() {
  $('#announcementForm')?.reset();
  $('#announcementId').value = '';
}

function ensureToastContainer() {
  let container = document.getElementById('toastContainer');
  if (container) return container;

  container = document.createElement('div');
  container.id = 'toastContainer';
  container.className = 'toast-container';
  document.body.appendChild(container);
  return container;
}

function showToast(message, type = 'info', duration = 3000) {
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.innerHTML = `<span>${String(message || 'Action completed')}</span>`;

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 220);
  }, duration);
}

function captureClientError(operation, error, metadata = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    operation,
    code: error?.code || (error?.status ? `HTTP_${error.status}` : 'CLIENT_ERROR'),
    status: error?.status || null,
    message: error?.message || String(error),
    details: error?.details || null,
    ...metadata
  };

  console.error('[NextRound error]', entry);

  try {
    const existing = readStoredArray('nextroundErrorLogs');
    existing.push(entry);
    localStorage.setItem('nextroundErrorLogs', JSON.stringify(existing.slice(-20)));
  } catch (storageError) {
    console.warn('Could not persist the client error log.', storageError);
  }
}

async function supabaseRequest(path, options = {}) {
  if (!supabaseEnabled) return null;

  let authToken = null;
  if (supabaseClient) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    authToken = session?.access_token || null;
  }

  const response = await fetch(`${supabaseConfig.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: supabaseConfig.anonKey,
      Authorization: `Bearer ${authToken || supabaseConfig.anonKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const responseText = await response.text();
    let details = responseText;
    try {
      details = responseText ? JSON.parse(responseText) : null;
    } catch (parseError) {
      details = responseText;
    }

    const error = new Error(`Supabase request failed (${response.status})`);
    error.status = response.status;
    error.details = details;
    error.operation = path;
    throw error;
  }
  const responseText = await response.text();
  if (!responseText.trim()) return null;
  return JSON.parse(responseText);
}

function mapApplication(row) {
  return {
    ...row,
    name: row.name || row.full_name || row.candidate_name || '',
    email: row.email || row.candidate_email || '',
    whatsapp: row.whatsapp || row.phone || row.phone_number || '',
    college: row.college || row.college_name || '',
    semester: row.semester || row.current_semester || '',
    branch: row.branch || '',
    technology: row.technology || row.technologies || row.technologies_known || '',
    languages: row.languages || row.languages_known || '',
    preferredDate: row.preferred_date,
    format: row.interview_format,
    notes: row.notes || row.additional_notes || '',
    paymentProof: row.payment_proof_url,
    source: row.source || 'Google Form'
  };
}

function mapFinance(row) {
  return {
    id: row.id,
    date: row.interview_date || '',
    candidate: row.candidate,
    takenBy: row.taken_by,
    amount: row.amount,
    status: row.status
  };
}

function mapSchedule(row) {
  return {
    id: row.id,
    candidateName: row.candidate_name,
    interviewerDetails: row.interviewer_details,
    candidateEmail: row.candidate_email,
    candidatePhone: row.candidate_phone,
    interviewDate: row.interview_date,
    interviewTime: row.interview_time,
    googleMeetLink: row.google_meet_link,
    scheduledBy: row.scheduled_by,
    status: row.status || 'Scheduled',
    details: row.details || ''
  };
}

function toDatabaseDate(value) {
  const match = String(value || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : (value || null);
}

function ensureAuthorizedAdmin() {
  return adminEmails.length > 0;
}

async function getSignedInUserEmail() {
  if (!supabaseClient) return '';
  const { data: { user }, error } = await supabaseClient.auth.getUser();
  if (error || !user?.email) return '';
  return user.email.trim().toLowerCase();
}

async function isCurrentUserAuthorized() {
  if (!ensureAuthorizedAdmin()) return false;
  const currentUserEmail = await getSignedInUserEmail();
  return adminEmails.includes(currentUserEmail);
}

async function loadSupabaseData() {
  if (!supabaseEnabled) return;

  const signedInEmail = await getSignedInUserEmail();
  if (!signedInEmail) return;

  try {
    const [applicationRows, financeRows, scheduleRows, announcementRows] = await Promise.all([
      supabaseRequest('applications?select=*&order=created_at.desc'),
      supabaseRequest('finance_records?select=*&order=created_at.desc'),
      supabaseRequest('scheduled_interviews?select=*&order=interview_date.desc,created_at.desc'),
      supabaseRequest('announcements?select=*&order=event_end.asc')
    ]);
    remoteApplications = (applicationRows || []).map(mapApplication);
    remoteFinances = (financeRows || []).map(mapFinance);
    remoteSchedules = (scheduleRows || []).map(mapSchedule);
    remoteAnnouncements = (announcementRows || []).map(mapAnnouncement);
    render();
  } catch (error) {
    console.error(error);
    showToast('Supabase could not be loaded. Check supabase-config.js and your RLS policies.', 'error');
  }
}

const FINANCE_KEY = 'nextroundFinances';

function getFinances() {
  const stored = localStorage.getItem(FINANCE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (e) {}
  }
  const init = window.defaultFinances ? JSON.parse(JSON.stringify(window.defaultFinances)) : [];
  localStorage.setItem(FINANCE_KEY, JSON.stringify(init));
  return init;
}

function saveFinances(list) {
  localStorage.setItem(FINANCE_KEY, JSON.stringify(list));
}

const open = (id) => {
  const el = $('#' + id);
  if (el) el.classList.add('show');
  document.body.style.overflow = 'hidden';
};

const close = (id) => {
  const el = $('#' + id);
  if (el) el.classList.remove('show');
  document.body.style.overflow = '';
};

// ==========================================================
// Financials & Settlements Dashboard Logic
// ==========================================================
let activeFinanceFilter = 'All';
let financeSearchQuery = '';
let pastSchedulePage = 1;
const PAST_SCHEDULE_PAGE_SIZE = 10;

function updateFinanceAdminControls() {
  const addFinanceButton = $('#openAddFinanceBtn');
  const addAnnouncementButton = $('#openAnnouncementModalBtn');

  if (addFinanceButton) {
    addFinanceButton.hidden = !financeManagerAuthorized;
    addFinanceButton.style.display = financeManagerAuthorized ? '' : 'none';
  }

  if (addAnnouncementButton) {
    addAnnouncementButton.hidden = !financeManagerAuthorized;
    addAnnouncementButton.style.display = financeManagerAuthorized ? '' : 'none';
  }
}

function renderFinances() {
  const allFinances = remoteFinances || getFinances();
  const tableBody = $('#financeTableBody');
  const canManageFinance = financeManagerAuthorized;
  updateFinanceAdminControls();

  const totalRevenue = allFinances.reduce((acc, item) => acc + (Number(item.amount) || 0), 0);
  const settledRevenue = allFinances
    .filter(item => item.status === 'Settled')
    .reduce((acc, item) => acc + (Number(item.amount) || 0), 0);
  const pendingRevenue = allFinances
    .filter(item => item.status !== 'Settled')
    .reduce((acc, item) => acc + (Number(item.amount) || 0), 0);
  const pendingCount = allFinances.filter(item => item.status !== 'Settled').length;
  const settledCount = allFinances.filter(item => item.status === 'Settled').length;

  // Update KPI Metric Cards
  if ($('#statTotalRevenue')) $('#statTotalRevenue').textContent = '₹' + totalRevenue.toLocaleString('en-IN');
  if ($('#statSettledAmount')) $('#statSettledAmount').textContent = '₹' + settledRevenue.toLocaleString('en-IN');
  if ($('#statPendingAmount')) $('#statPendingAmount').textContent = '₹' + pendingRevenue.toLocaleString('en-IN');
  if ($('#statPendingCount')) $('#statPendingCount').textContent = `${pendingCount} Pending ${pendingCount === 1 ? 'Settlement' : 'Settlements'}`;
  if ($('#statTotalSessions')) $('#statTotalSessions').textContent = allFinances.length;

  // Update badge and pill counters
  if ($('#financeCountBadge')) $('#financeCountBadge').textContent = allFinances.length;
  if ($('#pillAllCount')) $('#pillAllCount').textContent = allFinances.length;
  if ($('#pillPendingCount')) $('#pillPendingCount').textContent = pendingCount;
  if ($('#pillSettledCount')) $('#pillSettledCount').textContent = settledCount;

  if (!tableBody) return;

  // Filter records
  let filtered = allFinances.slice().reverse(); // Show latest first

  if (activeFinanceFilter === 'Pending') {
    filtered = filtered.filter(item => item.status !== 'Settled');
  } else if (activeFinanceFilter === 'Settled') {
    filtered = filtered.filter(item => item.status === 'Settled');
  }

  if (financeSearchQuery) {
    const q = financeSearchQuery.toLowerCase();
    filtered = filtered.filter(item =>
      (item.candidate || '').toLowerCase().includes(q) ||
      (item.takenBy || '').toLowerCase().includes(q) ||
      (item.date || '').toLowerCase().includes(q)
    );
  }

  if (filtered.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 32px; color: var(--muted); font-size: 13px;">
          No financial records match your criteria.
        </td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = filtered.map(item => {
    const isSettled = item.status === 'Settled';
    const statusClass = isSettled ? 'settled' : 'pending';
    const toggleLabel = isSettled ? 'Mark Pending' : 'Mark Settled ✓';

    return `
      <tr data-id="${item.id}">
        <td><strong>${item.date || '—'}</strong></td>
        <td class="candidate-name-cell">${item.candidate || 'Unnamed'}</td>
        <td class="taken-by-cell">${item.takenBy || 'Not assigned'}</td>
        <td class="amount-cell">₹${item.amount || 0}</td>
        <td>
          <span class="status-badge ${statusClass}">
            <span>${isSettled ? '●' : '◐'}</span> ${item.status || 'Pending'}
          </span>
        </td>
        <td style="text-align: right; white-space: nowrap;">
          ${canManageFinance ? `
            <button class="status-toggle-btn" onclick="toggleSettlementStatus(${item.id})">${toggleLabel}</button>
            <button class="status-toggle-btn" onclick="editFinanceRecord(${item.id})">Edit</button>
            <button class="delete-row-btn" onclick="deleteFinanceRecord(${item.id})">Delete</button>
          ` : '<span style="color: var(--muted); font-size: 12px;">Read-only</span>'}
        </td>
      </tr>
    `;
  }).join('');
}

function formatScheduleDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value || 'Date not provided';
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    .toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderSchedules() {
  const tableBody = $('#scheduleTableBody');
  const pastTableBody = $('#pastScheduleTableBody');
  if (!tableBody || !pastTableBody) return;

  const scheduled = remoteSchedules.filter(item => item.status !== 'Done');
  const past = remoteSchedules.filter(item => item.status === 'Done');
  const totalPastPages = Math.max(1, Math.ceil(past.length / PAST_SCHEDULE_PAGE_SIZE));
  pastSchedulePage = Math.min(pastSchedulePage, totalPastPages);
  const pastPageRows = past.slice(
    (pastSchedulePage - 1) * PAST_SCHEDULE_PAGE_SIZE,
    pastSchedulePage * PAST_SCHEDULE_PAGE_SIZE
  );

  if ($('#scheduleCountBadge')) $('#scheduleCountBadge').textContent = remoteSchedules.length;
  if ($('#scheduleSubNote')) {
    $('#scheduleSubNote').textContent = `${scheduled.length} upcoming interview${scheduled.length === 1 ? '' : 's'}`;
  }
  if ($('#pastScheduleSubNote')) $('#pastScheduleSubNote').textContent = `${past.length} completed interview${past.length === 1 ? '' : 's'}`;

  const emptyRow = message => `
    <tr><td colspan="6" style="text-align: center; padding: 32px; color: var(--muted); font-size: 13px;">${message}</td></tr>
  `;
  const row = (item, isPast) => `
    <tr>
      <td><strong>${formatScheduleDate(item.interviewDate)}</strong><br><small>${item.interviewTime || 'Time not provided'}</small></td>
      <td class="candidate-name-cell">${item.candidateName || 'Unnamed'}<br><small>${item.candidateEmail || item.candidatePhone || 'Contact not provided'}</small></td>
      <td>${item.interviewerDetails || 'Not provided'}${item.details ? `<br><small>${item.details}</small>` : ''}</td>
      <td>${item.googleMeetLink ? `<a href="${item.googleMeetLink}" target="_blank" rel="noopener noreferrer">Open Meet ↗</a>` : 'Not provided'}</td>
      <td>${item.scheduledBy || 'Unknown admin'}</td>
      <td style="text-align: right; white-space: nowrap;">
        <button class="status-toggle-btn" onclick="prepareScheduleEmail(${item.id})">Email draft</button>
        ${isPast ? '' : `<button class="status-toggle-btn" onclick="editSchedule(${item.id})">Edit</button><button class="status-toggle-btn" onclick="markScheduleDone(${item.id})">Mark Done</button><button class="delete-row-btn" onclick="deleteSchedule(${item.id})">Delete</button>`}
      </td>
    </tr>
  `;

  tableBody.innerHTML = scheduled.length ? scheduled.map(item => row(item, false)).join('') : emptyRow('No upcoming interviews are scheduled.');
  pastTableBody.innerHTML = past.length ? pastPageRows.map(item => row(item, true)).join('') : emptyRow('No past interviews have been recorded.');
  const pagination = $('#pastSchedulePagination');
  if (pagination) {
    pagination.hidden = past.length <= PAST_SCHEDULE_PAGE_SIZE;
    $('#pastSchedulePageInfo').textContent = `Page ${pastSchedulePage} of ${totalPastPages}`;
    $('#pastSchedulePrevious').disabled = pastSchedulePage === 1;
    $('#pastScheduleNext').disabled = pastSchedulePage === totalPastPages;
  }
}

function createScheduleEmail(item) {
  const date = formatScheduleDate(item.interviewDate);
  const body = `Dear ${item.candidateName},

Greetings from NextRound!

We are pleased to inform you that your mock interview has been scheduled as per the details below:

📅 Date: ${date}
🕢 Time: ${item.interviewTime}

👨‍💼 Interviewers:
${item.interviewerDetails}

🔗 Google Meet Link:
${item.googleMeetLink}

Please ensure that you:
Join the meeting 5–10 minutes before the scheduled time.

Keep your resume readily available.
Have a stable internet connection and a quiet environment for the interview.
The interview will closely simulate a real placement interview and will be followed by detailed feedback to help you identify your strengths and areas for improvement.`;

  return {
    subject: `Your NextRound mock interview is scheduled for ${date}`,
    body
  };
}

window.prepareScheduleEmail = function (id) {
  const item = remoteSchedules.find(schedule => schedule.id == id);
  if (!item) return;
  const email = createScheduleEmail(item);
  $('#emailDraftTo').value = item.candidateEmail || '';
  $('#emailDraftSubject').value = email.subject;
  $('#emailDraftBody').value = email.body;
  open('emailDraftModal');
};

function openScheduleEditor(item) {
  $('#scheduleRecordId').value = item?.id || '';
  $('#scheduleCandidateName').value = item?.candidateName || '';
  $('#scheduleCandidateEmail').value = item?.candidateEmail || '';
  $('#scheduleCandidatePhone').value = item?.candidatePhone || '';
  $('#scheduleInterviewerDetails').value = item?.interviewerDetails || '';
  $('#scheduleInterviewDate').value = item?.interviewDate || '';
  $('#scheduleInterviewTime').value = item?.interviewTime || '';
  $('#scheduleGoogleMeetLink').value = item?.googleMeetLink || '';
  $('#scheduleDetails').value = item?.details || '';
  $('#scheduleStatus').value = item?.status || 'Scheduled';
  open('scheduleModal');
}

window.editSchedule = function (id) {
  const item = remoteSchedules.find(schedule => schedule.id == id);
  if (item && item.status !== 'Done') openScheduleEditor(item);
};

window.markScheduleDone = async function (id) {
  if (!confirm('Mark this interview as done? It will move to Past Interviews.')) return;
  try {
    await supabaseRequest(`scheduled_interviews?id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'Done' })
    });
    await loadSupabaseData();
    showToast('Interview marked as done.', 'success');
  } catch (error) {
    console.error(error);
    showToast(`Unable to update interview status: ${error.message || 'Check your Supabase policies.'}`, 'error');
  }
};

window.deleteSchedule = async function (id) {
  const item = remoteSchedules.find(schedule => schedule.id == id);
  if (!item || item.status === 'Done') return;
  if (!confirm(`Delete the scheduled interview for ${item.candidateName || 'this candidate'}?`)) return;

  try {
    await supabaseRequest(`scheduled_interviews?id=eq.${id}&status=neq.Done`, { method: 'DELETE' });
    await loadSupabaseData();
    showToast('Scheduled interview deleted.', 'success');
  } catch (error) {
    console.error(error);
    showToast(`Unable to delete scheduled interview: ${error.message || 'Check your Supabase policies.'}`, 'error');
  }
};

window.toggleSettlementStatus = function (id) {
  if (!financeManagerAuthorized) {
    showToast('This account can view financial data but cannot modify it.', 'warning');
    return;
  }

  const finances = remoteFinances || getFinances();
  const item = finances.find(f => f.id == id);
  if (item) {
    item.status = (item.status === 'Settled') ? 'Pending' : 'Settled';
    if (supabaseEnabled) {
      supabaseRequest(`finance_records?id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: item.status })
      }).then(loadSupabaseData).catch(console.error);
    }
    saveFinances(finances);
    renderFinances();
    showToast(`Settlement status updated to ${item.status}.`, 'success');
  }
};

window.deleteFinanceRecord = function (id) {
  if (!financeManagerAuthorized) {
    showToast('This account can view financial data but cannot modify it.', 'warning');
    return;
  }

  if (!confirm('Are you sure you want to delete this session record?')) return;
  let finances = remoteFinances || getFinances();
  finances = finances.filter(f => f.id != id);
  if (supabaseEnabled) {
    supabaseRequest(`finance_records?id=eq.${id}`, { method: 'DELETE' }).then(loadSupabaseData).catch(console.error);
  }
  saveFinances(finances);
  renderFinances();
  showToast('Finance record deleted.', 'success');
};

window.editFinanceRecord = function (id) {
  if (!financeManagerAuthorized) {
    showToast('This account can view financial data but cannot modify it.', 'warning');
    return;
  }

  const finances = getFinances();
  const item = finances.find(f => f.id == id);
  if (!item) return;

  $('#recordId').value = item.id;
  $('#recordDate').value = item.date || '';
  $('#recordCandidate').value = item.candidate || '';
  $('#recordTakenBy').value = item.takenBy || '';
  $('#recordAmount').value = item.amount || 79;
  $('#recordStatus').value = item.status || 'Settled';

  $('#recordModalEyebrow').textContent = 'EDIT SESSION & SETTLEMENT';
  open('recordModal');
};

function exportFinancesToCSV() {
  const finances = getFinances();
  const headers = ['Interview Date', 'Candidate Name', 'Taken By', 'Amount settlement', 'Settlement Status'];
  const rows = finances.map(item => [
    `"${item.date || ''}"`,
    `"${(item.candidate || '').replace(/"/g, '""')}"`,
    `"${(item.takenBy || '').replace(/"/g, '""')}"`,
    item.amount || 0,
    `"${item.status || 'Pending'}"`
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  link.setAttribute('download', `nextround-finances-${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// ==========================================================
// Applications Pipeline Logic
// ==========================================================
function renderApplications() {
  const list = $('#applicationList');
  if (!list) return;
  const websiteApplications = supabaseEnabled ? remoteApplications : applications;
  const all = websiteApplications.slice().sort((a, b) => {
    const dateDifference = new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0);
    if (dateDifference) return dateDifference;
    return Number(b.id || 0) - Number(a.id || 0);
  });
  const pageCount = Math.max(1, Math.ceil(all.length / applicationsPerPage));
  applicationPage = Math.min(applicationPage, pageCount);
  const pageStart = (applicationPage - 1) * applicationsPerPage;
  const pageItems = all.slice(pageStart, pageStart + applicationsPerPage);
  const pagination = $('#applicationPagination');

  if ($('#applicationCountBadge')) $('#applicationCountBadge').textContent = all.length;
  if ($('#applicationSubNote')) {
    $('#applicationSubNote').textContent = supabaseEnabled
      ? `${websiteApplications.length} database applications`
      : `${websiteApplications.length} local applications`;
  }

  if (!all.length) {
    list.innerHTML = '<p class="empty-state">New applications from the public form will appear here.</p>';
    if (pagination) pagination.hidden = true;
    return;
  }

  const field = (title, value) => `
    <div class="application-field">
      <dt>${title}</dt>
      <dd>${value || 'Not provided'}</dd>
    </div>
  `;

  list.innerHTML = pageItems.map(a => `
    <article class="application-row">
      <div class="application-heading">
        <strong>${a.name || 'Applicant'}</strong>
        <span>${a.source || 'Google Form'}</span>
      </div>
      <dl class="application-details">
        ${field('Full name', a.name)}
        ${field('Email address', a.email)}
        ${field('WhatsApp number', a.whatsapp)}
        ${field('College name', a.college)}
        ${field('Current semester', a.semester)}
        ${field('Branch', a.branch)}
        ${field('Technologies you know', a.technology)}
        ${field('Languages you know', a.languages)}
        ${field('Preferred interview date', a.preferredDate)}
        ${field('Preferred interview format', a.format)}
        ${field('Anything we should know?', a.notes)}
        ${field('Payment screenshot / proof', a.paymentProof)}
      </dl>
    </article>
  `).join('');

  if (pagination) {
    pagination.hidden = pageCount <= 1;
    pagination.innerHTML = `
      <button type="button" data-application-page="previous" ${applicationPage === 1 ? 'disabled' : ''}>Previous</button>
      <span>Page ${applicationPage} of ${pageCount}</span>
      <button type="button" data-application-page="next" ${applicationPage === pageCount ? 'disabled' : ''}>Next</button>
    `;
    pagination.querySelector('[data-application-page="previous"]')?.addEventListener('click', () => {
      applicationPage -= 1;
      renderApplications();
    });
    pagination.querySelector('[data-application-page="next"]')?.addEventListener('click', () => {
      applicationPage += 1;
      renderApplications();
    });
  }
}

function render() {
  renderFinances();
  renderSchedules();
  renderApplications();
  renderAnnouncements();
  renderAnnouncementAdminList();
}

// ==========================================================
// Form Submission & Automatic Pipeline Linking
// ==========================================================
const form = $('#applicationForm');
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const file = form.querySelector('[type=file]');
    if (file?.files[0]) data.paymentProof = file.files[0].name;

    if (supabaseEnabled) {
      try {
        let paymentProofPath = null;
        if (file?.files[0]) {
          const safeName = file.files[0].name.replace(/[^a-zA-Z0-9._-]/g, '-');
          paymentProofPath = `${Date.now()}-${safeName}`;
          const uploadResponse = await fetch(`${supabaseConfig.url}/storage/v1/object/payment-proofs/${paymentProofPath}`, {
            method: 'POST',
            headers: {
              apikey: supabaseConfig.anonKey,
              Authorization: `Bearer ${supabaseConfig.anonKey}`,
              'Content-Type': file.files[0].type || 'application/octet-stream'
            },
            body: file.files[0]
          });
          if (!uploadResponse.ok) {
            const details = await uploadResponse.text();
            const error = new Error(`Payment proof upload failed (${uploadResponse.status})`);
            error.status = uploadResponse.status;
            error.details = details;
            error.operation = 'payment-proof-upload';
            throw error;
          }
        }

        await supabaseRequest('applications', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            name: data.name,
            email: data.email,
            whatsapp: data.whatsapp,
            college: data.college,
            semester: data.semester,
            branch: data.branch,
            technology: data.technology,
            languages: data.languages,
            source: 'Website',
            preferred_date: data.preferredDate || null,
            interview_format: data.format,
            notes: data.notes || null,
            payment_proof_url: paymentProofPath
          })
        });

        form.reset();
        const label = $('#fileName');
        if (label) label.textContent = 'Choose image or PDF';
        showToast('Application submitted successfully. Someone from the team will contact you.', 'success');
        open('successModal');
        return;
      } catch (error) {
        captureClientError('application-submit', error);
        showToast('Failed to submit the form. Error code: SUBMIT_FAILED.', 'error', 5000);
        return;
      }
    }

    // 1. Save to applicant queue
    applications.push(data);
    save();

    // 2. Automatically create a NOT SETTLED / PENDING financial record
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    let sessionDate = `${dd}.${mm}.${yyyy}`;

    if (data.preferredDate) {
      const parts = data.preferredDate.split('-');
      if (parts.length === 3) {
        sessionDate = `${parts[2]}.${parts[1]}.${parts[0]}`;
      }
    }

    const finances = getFinances();
    finances.push({
      id: Date.now(),
      date: sessionDate,
      candidate: data.name || 'Website Applicant',
      takenBy: data.interviewer || 'Pending Assignment',
      amount: 79,
      status: 'Pending'
    });
    saveFinances(finances);

    form.reset();
    const label = $('#fileName');
    if (label) label.textContent = 'Choose image or PDF';
    showToast('Application submitted successfully.', 'success');
    open('successModal');
  });
}

// File upload preview label
const upload = $('[name=paymentProof]');
if (upload) {
  upload.addEventListener('change', () => {
    $('#fileName').textContent = upload.files[0]?.name || 'Choose image or PDF';
  });
}

// ==========================================================
// Admin Workspace Interactions & Navigation
// ==========================================================
['#openAdmin', '#openAdminFooter'].forEach(s => {
  $(s)?.addEventListener('click', () => open('adminModal'));
});

document.querySelectorAll('[data-close]').forEach(b => {
  b.addEventListener('click', () => close(b.dataset.close));
});

// Admin Authentication
$('#adminForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!supabaseClient) {
    showToast('Supabase Auth is not configured. Add the Supabase client script and a valid admin email.', 'error');
    return;
  }

  const email = $('#adminForm input[type="email"]')?.value?.trim() || '';
  const password = $('#adminForm input[type="password"]')?.value || '';

  if (!email || !password) {
    showToast('Enter the authorized team email and password.', 'warning');
    return;
  }

  if (!ensureAuthorizedAdmin()) {
    showToast('Add at least one team member email to SUPABASE_CONFIG.adminEmails before enabling the workspace.', 'warning');
    return;
  }

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;

    const signedInEmail = (data?.user?.email || '').trim().toLowerCase();
    if (!adminEmails.includes(signedInEmail)) {
      await supabaseClient.auth.signOut();
      throw new Error('This Supabase Auth user is not in SUPABASE_CONFIG.adminEmails.');
    }

    adminAuthorized = adminEmails.includes(signedInEmail);
    financeManagerAuthorized = signedInEmail === financeAdminEmail;
    updateFinanceAdminControls();

    if (!financeManagerAuthorized) {
      $('#adminLogin').hidden = true;
      $('#adminDashboard').hidden = false;
      showToast('This account can view the dashboard but cannot modify finance data.', 'info');
      await loadSupabaseData();
      return;
    }

    $('#adminLogin').hidden = true;
    $('#adminDashboard').hidden = false;
    showToast('Signed in successfully.', 'success');
    await loadSupabaseData();
  } catch (error) {
    console.error(error);
    showToast(`Unable to sign in: ${error.message || 'Check the email and password.'}`, 'error');
  }
});

$('#logout')?.addEventListener('click', async () => {
  adminAuthorized = false;
  financeManagerAuthorized = false;
  updateFinanceAdminControls();
  if (supabaseClient) {
    await supabaseClient.auth.signOut().catch(console.error);
  }
  $('#adminLogin').hidden = false;
  $('#adminDashboard').hidden = true;
  $('#adminForm').reset();
  showToast('Signed out.', 'info');
});

async function restoreAdminSession() {
  if (!supabaseClient) return;

  const { data, error } = await supabaseClient.auth.getSession();
  if (error || !data.session) return;

  const signedInEmail = (data.session.user?.email || '').trim().toLowerCase();
  if (!adminEmails.includes(signedInEmail)) {
    await supabaseClient.auth.signOut().catch(console.error);
    return;
  }

  adminAuthorized = true;
  financeManagerAuthorized = signedInEmail === financeAdminEmail;
  updateFinanceAdminControls();
  $('#adminLogin').hidden = true;
  $('#adminDashboard').hidden = false;
  open('adminModal');
  await loadSupabaseData();
}

supabaseClient?.auth.onAuthStateChange((event, session) => {
  if (event === 'TOKEN_REFRESHED' && session) {
    adminAuthorized = adminEmails.includes(session.user?.email?.toLowerCase() || '');
    financeManagerAuthorized = adminAuthorized && session.user.email.toLowerCase() === financeAdminEmail;
    updateFinanceAdminControls();
  }
});

$('#clearApplications')?.addEventListener('click', () => {
  if (!confirm('Clear demo website submissions?')) return;
  applications.splice(0);
  save();
  renderApplications();
});

// Record Session Modal Form
$('#openAddFinanceBtn')?.addEventListener('click', () => {
  if (!financeManagerAuthorized) {
    showToast('Only the finance admin can add finance records.', 'warning');
    return;
  }

  $('#recordId').value = '';
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  $('#recordDate').value = `${dd}.${mm}.${yyyy}`;
  $('#recordCandidate').value = '';
  $('#recordTakenBy').value = '';
  $('#recordAmount').value = 79;
  $('#recordStatus').value = 'Settled';
  $('#recordModalEyebrow').textContent = 'RECORD SESSION & PAYMENT';
  open('recordModal');
});

$('#openAnnouncementModalBtn')?.addEventListener('click', () => {
  if (!financeManagerAuthorized) {
    showToast('Only the finance admin can manage announcements.', 'warning');
    return;
  }
  resetAnnouncementForm();
  open('announcementModal');
});

$('#announcementNotification')?.addEventListener('click', () => {
  const panel = $('#liveAnnouncements');
  const isOpen = panel && !panel.hidden && panel.style.display !== 'none';
  announcementPanelOpen = !isOpen;
  renderAnnouncements();
  if (announcementPanelOpen) {
    $('#liveAnnouncements')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('#closeAnnouncementsBtn')) return;
  announcementPanelOpen = false;
  renderAnnouncements();
});

document.addEventListener('pointerdown', (event) => {
  const panel = $('#liveAnnouncements');
  if (!panel || panel.hidden) return;
  if (event.target.closest('#liveAnnouncements, #announcementNotification')) return;
  announcementPanelOpen = false;
  renderAnnouncements();
});

$('#announcementForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!financeManagerAuthorized) {
    showToast('This account can view the dashboard but cannot manage announcements.', 'warning');
    return;
  }

  const id = $('#announcementId').value;
  const item = createAnnouncementItem({
    id,
    title: $('#announcementTitle').value.trim(),
    guestName: $('#announcementGuest').value.trim(),
    description: $('#announcementDescription').value.trim(),
    eventDate: $('#announcementDate').value,
    eventTime: $('#announcementTime').value.trim(),
    eventEnd: $('#announcementEnd').value,
    meetLink: $('#announcementMeetLink').value.trim()
  });

  try {
    if (supabaseEnabled) {
      const payload = {
        title: item.title,
        guest_name: item.guestName,
        description: item.description,
        event_date: item.eventDate || null,
        event_time: item.eventTime,
        event_end: new Date(item.eventEnd).toISOString(),
        meet_link: item.meetLink,
        created_by: await getSignedInUserEmail()
      };
      await supabaseRequest(id ? `announcements?id=eq.${id}` : 'announcements', {
        method: id ? 'PATCH' : 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(payload)
      });
      await loadSupabaseData();
    } else {
      const current = getAnnouncements();
      const savedItem = { ...item, id: id || Date.now() };
      const index = current.findIndex(entry => String(entry.id) === String(id));
      if (index >= 0) current[index] = savedItem;
      else current.push(savedItem);
      saveAnnouncements(current);
      render();
    }
    close('announcementModal');
    resetAnnouncementForm();
    showToast('Announcement saved.', 'success');
  } catch (error) {
    console.error(error);
    showToast(`Unable to save announcement: ${error.message || 'Check your Supabase policies.'}`, 'error');
  }
});

$('#recordForm')?.addEventListener('submit', (e) => {
  e.preventDefault();

  if (!financeManagerAuthorized) {
    showToast('This account can view financial data but cannot modify it.', 'warning');
    return;
  }

  const recId = $('#recordId').value;
  const finances = getFinances();

  if (recId) {
    // Edit existing
    const item = finances.find(f => f.id == recId);
    if (item) {
      item.date = $('#recordDate').value.trim();
      item.candidate = $('#recordCandidate').value.trim();
      item.takenBy = $('#recordTakenBy').value.trim();
      item.amount = Number($('#recordAmount').value) || 79;
      item.status = $('#recordStatus').value;
    }
  } else {
    // Create new
    finances.push({
      id: Date.now(),
      date: $('#recordDate').value.trim(),
      candidate: $('#recordCandidate').value.trim(),
      takenBy: $('#recordTakenBy').value.trim() || 'Pending Assignment',
      amount: Number($('#recordAmount').value) || 79,
      status: $('#recordStatus').value
    });
  }

  if (supabaseEnabled) {
    const payload = {
      interview_date: toDatabaseDate($('#recordDate').value.trim()),
      candidate: $('#recordCandidate').value.trim(),
      taken_by: $('#recordTakenBy').value.trim() || 'Pending Assignment',
      amount: Number($('#recordAmount').value) || 79,
      status: $('#recordStatus').value
    };
    const request = recId
      ? supabaseRequest(`finance_records?id=eq.${recId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(payload) })
      : supabaseRequest('finance_records', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(payload) });
    request.then(() => {
      loadSupabaseData();
      showToast('Finance record saved.', 'success');
    }).catch(console.error);
  }

  saveFinances(finances);
  close('recordModal');
  renderFinances();
  if (!supabaseEnabled) showToast('Finance record saved.', 'success');
});

$('#openScheduleInterviewBtn')?.addEventListener('click', () => {
  $('#scheduleForm')?.reset();
  openScheduleEditor();
});

$('#scheduleForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!supabaseClient) {
    showToast('Supabase is required to save shared interview schedules.', 'error');
    return;
  }

  const recordId = $('#scheduleRecordId').value;
  const scheduledBy = await getSignedInUserEmail();
  if (!scheduledBy) {
    showToast('Please sign in again before scheduling an interview.', 'warning');
    return;
  }

  const payload = {
    candidate_name: $('#scheduleCandidateName').value.trim(),
    interviewer_details: $('#scheduleInterviewerDetails').value.trim(),
    candidate_email: $('#scheduleCandidateEmail').value.trim(),
    candidate_phone: $('#scheduleCandidatePhone').value.trim(),
    interview_date: $('#scheduleInterviewDate').value,
    interview_time: $('#scheduleInterviewTime').value.trim(),
    google_meet_link: $('#scheduleGoogleMeetLink').value.trim(),
    scheduled_by: recordId ? remoteSchedules.find(item => item.id == recordId)?.scheduledBy || scheduledBy : scheduledBy,
    status: $('#scheduleStatus').value,
    details: $('#scheduleDetails').value.trim()
  };

  try {
    const rows = await supabaseRequest(recordId ? `scheduled_interviews?id=eq.${recordId}` : 'scheduled_interviews', {
      method: recordId ? 'PATCH' : 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload)
    });
    await loadSupabaseData();
    close('scheduleModal');
    const created = rows?.[0] ? mapSchedule(rows[0]) : remoteSchedules.find(item => item.id == recordId) || remoteSchedules[0];
    if (created && created.status !== 'Done') window.prepareScheduleEmail(created.id);
    showToast('Interview schedule saved.', 'success');
  } catch (error) {
    console.error(error);
    showToast(`Unable to schedule interview: ${error.message || 'Check your Supabase policies.'}`, 'error');
  }
});

$('#copyEmailDraftBtn')?.addEventListener('click', async () => {
  const body = $('#emailDraftBody')?.value || '';
  const draft = `To: ${$('#emailDraftTo')?.value || ''}\nSubject: ${$('#emailDraftSubject')?.value || ''}\n\n${body}`;
  try {
    await navigator.clipboard.writeText(draft);
    $('#copyEmailDraftBtn').textContent = 'Copied';
    showToast('Email draft copied to clipboard.', 'success');
    setTimeout(() => { $('#copyEmailDraftBtn').textContent = 'Copy Email Draft'; }, 1500);
  } catch (error) {
    $('#emailDraftBody')?.select();
    showToast('Copy was blocked by the browser. Select the email body and copy it manually.', 'warning');
  }
});

// Search & Filter Events
$('#financeSearchInput')?.addEventListener('input', (e) => {
  financeSearchQuery = e.target.value.trim();
  renderFinances();
});

$('#financeFilterPills')?.addEventListener('click', (e) => {
  const pill = e.target.closest('.filter-pill');
  if (!pill) return;
  document.querySelectorAll('#financeFilterPills .filter-pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  activeFinanceFilter = pill.dataset.filter || 'All';
  renderFinances();
});

$('#pastSchedulePrevious')?.addEventListener('click', () => {
  pastSchedulePage = Math.max(1, pastSchedulePage - 1);
  renderSchedules();
});

$('#pastScheduleNext')?.addEventListener('click', () => {
  pastSchedulePage += 1;
  renderSchedules();
});

// Export CSV
$('#exportFinanceBtn')?.addEventListener('click', exportFinancesToCSV);

// Workspace Tab Switching
$('#tabFinancesBtn')?.addEventListener('click', () => {
  $('#tabFinancesBtn').classList.add('active');
  $('#tabSchedulesBtn').classList.remove('active');
  $('#tabApplicationsBtn').classList.remove('active');
  $('#financesTab').hidden = false;
  $('#schedulesTab').hidden = true;
  $('#applicationsTab').hidden = true;
});

$('#tabSchedulesBtn')?.addEventListener('click', () => {
  $('#tabSchedulesBtn').classList.add('active');
  $('#tabApplicationsBtn').classList.remove('active');
  $('#tabFinancesBtn').classList.remove('active');
  $('#schedulesTab').hidden = false;
  $('#applicationsTab').hidden = true;
  $('#financesTab').hidden = true;
  renderSchedules();
});

$('#tabApplicationsBtn')?.addEventListener('click', () => {
  $('#tabApplicationsBtn').classList.add('active');
  $('#tabSchedulesBtn').classList.remove('active');
  $('#tabFinancesBtn').classList.remove('active');
  $('#schedulesTab').hidden = true;
  $('#financesTab').hidden = true;
  $('#applicationsTab').hidden = false;
  renderApplications();
});

// ==========================================================
// Moving Feedback Carousel
// ==========================================================
function initFeedbackCarousel() {
  const track = document.getElementById('feedbackTrack');
  if (!track) return;

  const prevBtn = document.getElementById('prevFeedback');
  const nextBtn = document.getElementById('nextFeedback');
  const dotsContainer = document.getElementById('carouselDots');
  const cards = track.querySelectorAll('.feedback-card');

  cards.forEach((card) => {
    const body = card.querySelector('.feedback-body');
    if (!body || body.scrollHeight <= body.clientHeight + 1) return;

    const readMore = document.createElement('button');
    readMore.type = 'button';
    readMore.className = 'feedback-read-more';
    readMore.textContent = 'Read more';
    readMore.setAttribute('aria-expanded', 'false');
    body.after(readMore);

    readMore.addEventListener('click', () => {
      const expanded = card.classList.toggle('is-expanded');
      readMore.textContent = expanded ? 'Show less' : 'Read more';
      readMore.setAttribute('aria-expanded', String(expanded));
    });
  });
  if (!cards.length) return;

  let isHovered = false;
  let autoTimer = null;

  function getStepWidth() {
    const firstCard = track.querySelector('.feedback-card');
    if (!firstCard) return 350;
    const style = window.getComputedStyle(track);
    const gap = parseFloat(style.gap) || 22;
    return firstCard.offsetWidth + gap;
  }

  function renderDots() {
    if (!dotsContainer) return;
    dotsContainer.innerHTML = Array.from(cards).map((_, i) =>
      `<button aria-label="Go to feedback ${i + 1}" data-index="${i}"></button>`
    ).join('');
    updateActiveDot();
  }

  function updateActiveDot() {
    if (!dotsContainer) return;
    const step = getStepWidth();
    const activeIndex = Math.min(cards.length - 1, Math.max(0, Math.round(track.scrollLeft / step)));
    const dots = dotsContainer.querySelectorAll('button');
    dots.forEach((dot, idx) => {
      dot.classList.toggle('active', idx === activeIndex);
    });
  }

  function scrollNext() {
    const step = getStepWidth();
    const maxScroll = track.scrollWidth - track.clientWidth;
    if (track.scrollLeft >= maxScroll - 15) {
      track.scrollTo({ left: 0, behavior: 'smooth' });
    } else {
      track.scrollBy({ left: step, behavior: 'smooth' });
    }
  }

  function scrollPrev() {
    const step = getStepWidth();
    if (track.scrollLeft <= 15) {
      track.scrollTo({ left: track.scrollWidth, behavior: 'smooth' });
    } else {
      track.scrollBy({ left: -step, behavior: 'smooth' });
    }
  }

  function startAutoPlay() {
    stopAutoPlay();
    autoTimer = setInterval(() => {
      if (!isHovered) scrollNext();
    }, 3200);
  }

  function stopAutoPlay() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
  }

  track.addEventListener('mouseenter', () => { isHovered = true; });
  track.addEventListener('mouseleave', () => { isHovered = false; });
  track.addEventListener('touchstart', () => { isHovered = true; }, { passive: true });
  track.addEventListener('touchend', () => { isHovered = false; });

  let scrollTimeout = null;
  track.addEventListener('scroll', () => {
    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(updateActiveDot, 60);
  }, { passive: true });

  prevBtn?.addEventListener('click', () => {
    scrollPrev();
    startAutoPlay();
  });

  nextBtn?.addEventListener('click', () => {
    scrollNext();
    startAutoPlay();
  });

  dotsContainer?.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const idx = parseInt(btn.dataset.index, 10);
    const step = getStepWidth();
    track.scrollTo({ left: idx * step, behavior: 'smooth' });
    startAutoPlay();
  });

  renderDots();
  startAutoPlay();
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFeedbackCarousel);
} else {
  initFeedbackCarousel();
}

restoreAdminSession();
loadAnnouncements();
