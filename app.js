const $ = (s) => document.querySelector(s);
const isAdminRoute = new URLSearchParams(window.location.search).get('admin') === '1'
  || window.location.pathname.endsWith('/admin')
  || window.location.pathname.endsWith('/admin.html');

if (isAdminRoute) document.body.classList.add('admin-route');

const THEME_STORAGE_KEY = 'nextround-theme';
const THEME_ICONS = {
  moon: '<svg class="moon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.3 15.4A8.7 8.7 0 0 1 8.6 3.7 8.8 8.8 0 1 0 20.3 15.4Z"/></svg>',
  sun: '<svg class="sun" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>'
};
function setSiteTheme(theme, persist = true) {
  const dark = theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.innerHTML = dark ? THEME_ICONS.sun : THEME_ICONS.moon;
    button.setAttribute('aria-pressed', String(dark));
    button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    button.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  });
  if (persist) localStorage.setItem(THEME_STORAGE_KEY, dark ? 'dark' : 'light');
}

setSiteTheme(localStorage.getItem(THEME_STORAGE_KEY) || 'light', false);
document.querySelectorAll('[data-theme-toggle]').forEach(button => {
  button.addEventListener('click', () => {
    setSiteTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
});

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
let pendingResumeUpload = null;
let remoteAnnouncements = null;
let remoteSiteNotices = null;
let applicationPage = 1;
let activeApplicationFilter = 'All';
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
const SITE_NOTICE_STORAGE_KEY = 'nextroundSiteNotice';
const DEFAULT_APPLICATION_PAUSE_MESSAGE = 'Due to high demand, we have temporarily paused applications while our interview panels get ready. We’ll be back soon. Please check back shortly.';
let applicationAvailability = null;
let applicationSortDirection = 'desc';
let financeSortDirection = 'desc';
let scheduleSortDirection = 'desc';
let pastScheduleSortDirection = 'desc';
let announcementSortDirection = 'desc';

function parseAdminDate(value) {
  const text = String(value || '').trim();
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  match = text.match(/^(\d{1,2})([./])(\d{1,2})\2(\d{4})$/);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[3]);
    const monthFirst = match[2] === '/' && first <= 12 && second <= 12;
    const day = monthFirst ? second : first;
    const month = monthFirst ? first : second;
    return new Date(Number(match[4]), month - 1, day).getTime();
  }
  const parsed = new Date(text).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatDateDDMMYYYY(value) {
  if (value instanceof Date) {
    return `${String(value.getDate()).padStart(2, '0')}/${String(value.getMonth() + 1).padStart(2, '0')}/${value.getFullYear()}`;
  }
  const text = String(value || '').trim();
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  match = text.match(/^(\d{1,2})([./])(\d{1,2})\2(\d{4})$/);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[3]);
    const monthFirst = match[2] === '/' && first <= 12 && second <= 12;
    const day = monthFirst ? second : first;
    const month = monthFirst ? first : second;
    return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${match[4]}`;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return value || 'Date not provided';
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

function updateSortButton(button, direction, label) {
  if (!button) return;
  button.textContent = direction === 'asc' ? '↑' : '↓';
  button.setAttribute('aria-label', `Sort ${label} by date ${direction === 'asc' ? 'ascending' : 'descending'}`);
  button.setAttribute('title', `Sort by date ${direction === 'asc' ? 'ascending' : 'descending'}`);
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function hashResumeUploadToken(token) {
  if (window.crypto?.subtle) {
    const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  if (!supabaseClient) throw new Error('Resume upload setup is unavailable in this browser.');
  const { data, error } = await supabaseClient.rpc('hash_resume_upload_token', { p_token: token });
  if (error) throw error;
  if (!/^[a-f0-9]{64}$/.test(String(data || ''))) throw new Error('Could not prepare the resume upload.');
  return data;
}

function getAdminGlobalSearchEntries(scopeTabId) {
  const entries = [];
  const addRecords = (records, type, target, getTitle, getDetail) => {
    (Array.isArray(records) ? records : []).forEach(record => {
      entries.push({
        type,
        target,
        title: getTitle(record) || type,
        detail: getDetail(record),
        searchable: JSON.stringify(record || {})
      });
    });
  };

  if (scopeTabId === 'tabApplicationsBtn') {
    addRecords(supabaseEnabled ? remoteApplications : applications, 'Application', 'tabApplicationsBtn',
      item => item.name || item.full_name || item.email,
      item => [item.email, item.whatsapp, item.college, getSessionTypeLabel(item.sessionType), item.preferredDate].filter(Boolean).join(' · '));
  } else if (scopeTabId === 'tabFinancesBtn') {
    addRecords(Array.isArray(remoteFinances) ? remoteFinances : getFinances(), 'Finance', 'tabFinancesBtn',
      item => item.candidate || item.candidate_name,
      item => [`₹${item.amount || 0}`, item.status, item.date || item.interview_date, item.takenBy || item.taken_by].filter(Boolean).join(' · '));
  } else if (scopeTabId === 'tabSchedulesBtn') {
    addRecords(remoteSchedules, 'Scheduled interview', 'tabSchedulesBtn',
      item => item.candidateName || item.candidateEmail,
      item => [item.candidateEmail, item.candidatePhone, item.interviewDate, item.interviewTime, item.interviewerDetails, item.status].filter(Boolean).join(' · '));
    addRecords((supabaseEnabled ? remoteApplications : applications).filter(item => item.resume_path), 'Resume upload', 'tabSchedulesBtn',
      item => item.name || item.email,
      item => [item.email, item.resume_uploaded_at ? `Uploaded ${item.resume_uploaded_at}` : 'Resume uploaded'].filter(Boolean).join(' · '));
  } else if (scopeTabId === 'tabAnnouncementsBtn') {
    addRecords(getAnnouncements(), 'Event announcement', 'tabAnnouncementsBtn',
      item => item.title || item.guestName,
      item => [item.guestName, item.eventDate, item.eventTime, item.description].filter(Boolean).join(' · '));
    addRecords(getSiteNotices(), 'Homepage notice', 'tabAnnouncementsBtn',
      item => item.message,
      item => item.active ? 'Active homepage notice' : 'Inactive homepage notice');
  }
  if (scopeTabId === 'tabAnnouncementsBtn' && applicationAvailability) {
    addRecords([applicationAvailability], 'Application availability', 'tabAnnouncementsBtn',
      item => item.accepting_responses ? 'Applications open' : 'Applications paused',
      item => item.pause_message || 'Application availability settings');
  }
  return entries;
}

function renderAdminGlobalSearch(query) {
  const resultsPanel = $('#adminGlobalSearchResults');
  if (!resultsPanel) return;
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
  const activeTabId = document.querySelector('.workspace-tabs .tab-btn.active')?.id || 'tabApplicationsBtn';
  const sectionLabels = {
    tabApplicationsBtn: ['applications', 'Search applications…'],
    tabSchedulesBtn: ['scheduled interviews', 'Search scheduled interviews…'],
    tabFinancesBtn: ['finance records', 'Search finance records…'],
    tabAnnouncementsBtn: ['announcements and notices', 'Search announcements and notices…']
  };
  const [sectionLabel, placeholder] = sectionLabels[activeTabId] || sectionLabels.tabApplicationsBtn;
  const searchInput = $('#adminGlobalSearchInput');
  if (searchInput) searchInput.placeholder = placeholder;
  const searchLabel = document.querySelector('label[for="adminGlobalSearchInput"]');
  if (searchLabel) searchLabel.textContent = `Search ${sectionLabel}`;
  if (!normalizedQuery) {
    resultsPanel.hidden = true;
    resultsPanel.innerHTML = '';
    return;
  }
  resultsPanel.hidden = false;
  if (normalizedQuery.length < 2) {
    resultsPanel.innerHTML = '<p class="admin-search-hint">Enter at least 2 characters to search.</p>';
    return;
  }

  const matches = getAdminGlobalSearchEntries(activeTabId).filter(entry =>
    `${entry.title} ${entry.detail} ${entry.searchable}`.toLocaleLowerCase().includes(normalizedQuery)
  );
  if (!matches.length) {
    resultsPanel.innerHTML = '<p class="admin-search-hint">No matching admin records found.</p>';
    return;
  }
  const shown = matches.slice(0, 50);
  resultsPanel.innerHTML = `<p class="admin-search-count">${matches.length} result${matches.length === 1 ? '' : 's'}${matches.length > shown.length ? ' · showing first 50' : ''}</p>
    <div class="admin-search-result-list">${shown.map(entry => `
      <article class="admin-search-result">
        <div><span>${escapeHtml(entry.type)}</span><strong>${escapeHtml(entry.title)}</strong><p>${escapeHtml(entry.detail || 'No additional details')}</p></div>
        <button type="button" class="button button-outline btn-sm" data-admin-search-tab="${escapeHtml(entry.target)}">Open section</button>
      </article>`).join('')}</div>`;
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
    if (notification) {
      notification.hidden = true;
      notification.style.display = 'none';
      notification.setAttribute('aria-expanded', 'false');
    }
    return;
  }

  if (notification) {
    notification.hidden = false;
    notification.style.display = 'inline-flex';
    notification.setAttribute('aria-expanded', String(announcementPanelOpen));
  }
  container.hidden = !announcementPanelOpen;
  container.style.display = announcementPanelOpen ? 'grid' : 'none';
  container.innerHTML = `<div class="announcement-popup-header">
    <span class="announcement-popup-title">Live announcements</span>
    <button type="button" id="closeAnnouncementsBtn" class="announcement-popup-close" aria-label="Close announcements" onclick="closeAnnouncements()">×</button>
  </div>${announcements.map(item => {
    const meetText = item.meetLink ? `<a class="announcement-link" href="${escapeHtml(item.meetLink)}" target="_blank" rel="noopener noreferrer">Join Google Meet</a>` : '';
    const dateLabel = item.eventDate ? formatDateDDMMYYYY(item.eventDate) : 'Date TBD';
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

function getSiteNotices() {
  if (remoteSiteNotices !== null) return remoteSiteNotices;
  if (supabaseEnabled) return [];
  try {
    const stored = JSON.parse(localStorage.getItem(SITE_NOTICE_STORAGE_KEY) || 'null');
    if (Array.isArray(stored)) return stored;
    return stored ? [{ ...stored, id: stored.id || 1 }] : [];
  } catch (error) {
    localStorage.removeItem(SITE_NOTICE_STORAGE_KEY);
    return [];
  }
}

function getActiveSiteNotice() {
  return getSiteNotices()
    .filter(notice => notice.active && notice.message)
    .sort((a, b) => parseAdminDate(b.created_at || b.updated_at) - parseAdminDate(a.created_at || a.updated_at))[0] || null;
}

function renderSiteNotice() {
  const bar = $('#siteNoticeBar');
  const text = $('#siteNoticeText');
  if (!bar || !text) return;
  const notice = getActiveSiteNotice();
  const message = notice?.active && notice.message ? String(notice.message).trim() : '';
  bar.hidden = !message;
  bar.classList.toggle('is-ticker', message.length > 90);
  text.textContent = message;
}

async function loadSiteNotices() {
  if (!supabaseEnabled) {
    renderSiteNotice();
    renderSiteNoticeAdminList();
    return;
  }
  try {
    remoteSiteNotices = await supabaseRequest('site_notices?select=*&order=created_at.desc,id.desc') || [];
    renderSiteNotice();
    renderSiteNoticeAdminList();
  } catch (error) {
    console.error(error);
  }
}

function renderSiteNoticeAdminList() {
  const list = $('#siteNoticeAdminList');
  if (!list) return;
  const notices = getSiteNotices().slice().sort((a, b) =>
    parseAdminDate(b.created_at || b.updated_at) - parseAdminDate(a.created_at || a.updated_at)
  );
  if (!notices.length) {
    list.innerHTML = '<p class="empty-state">No notices have been created yet.</p>';
    return;
  }
  list.innerHTML = notices.map(notice => `
    <article class="site-notice-admin-item ${notice.active ? 'is-active' : ''}">
      <div class="site-notice-admin-copy">
        <span class="site-notice-status">${notice.active ? 'Currently shown' : 'Past notice'}</span>
        <p>${escapeHtml(notice.message || '')}</p>
        <small>${formatDateDDMMYYYY(notice.created_at || notice.updated_at)}</small>
      </div>
      ${adminAuthorized ? `<div class="announcement-admin-actions">
        <button type="button" onclick="editSiteNotice(${Number(notice.id)})">Edit</button>
        <button type="button" class="delete-btn" onclick="deleteSiteNotice(${Number(notice.id)})">Delete</button>
      </div>` : '<span class="site-notice-status">Read only</span>'}
    </article>
  `).join('');
}

function renderApplicationAvailability() {
  const form = $('#applicationForm');
  const notice = $('#applicationAvailabilityNotice');
  if (form && notice) {
    if (!supabaseEnabled) {
      form.hidden = false;
      notice.hidden = true;
    } else if (!applicationAvailability) {
      form.hidden = true;
      notice.hidden = false;
      notice.querySelector('h2').textContent = 'Applications temporarily unavailable';
      notice.querySelector('p:last-child').textContent = 'We can’t confirm application availability right now. Please try again shortly.';
    } else {
      const accepting = applicationAvailability.accepting_responses;
      form.hidden = !accepting;
      notice.hidden = accepting;
      if (!accepting) {
        notice.querySelector('h2').textContent = 'Applications are temporarily paused';
        notice.querySelector('p:last-child').textContent = applicationAvailability.pause_message || DEFAULT_APPLICATION_PAUSE_MESSAGE;
      }
    }
  }

  const adminForm = $('#applicationAvailabilityForm');
  if (!adminForm) return;
  adminForm.hidden = !financeManagerAuthorized;
  const pausedToggle = $('#applicationsPausedToggle');
  const action = $('#applicationAvailabilityAction');
  const messageField = $('#applicationPauseMessage');
  const messageFieldLabel = $('#applicationPauseMessageField');
  const saveMessageButton = $('#saveApplicationPauseMessage');
  const status = $('#applicationAvailabilityAdminStatus');
  if (!applicationAvailability) {
    if (status) status.textContent = 'Application settings have not loaded yet.';
    return;
  }
  const paused = !applicationAvailability.accepting_responses;
  if (pausedToggle) pausedToggle.checked = paused;
  if (action) action.textContent = paused ? 'Resume taking applications' : 'Pause applications';
  if (messageFieldLabel) messageFieldLabel.hidden = !paused;
  if (saveMessageButton) saveMessageButton.hidden = !paused;
  if (messageField && document.activeElement !== messageField) messageField.value = applicationAvailability.pause_message || '';
  if (status) {
    status.textContent = paused ? 'Applications are paused.' : 'Applications are open.';
  }
}

async function loadApplicationAvailability() {
  if (!supabaseEnabled) {
    applicationAvailability = {
      accepting_responses: true
    };
    renderApplicationAvailability();
    return;
  }

  try {
    const settings = await supabaseRequest('application_settings?select=accepting_responses,pause_message&id=eq.1');
    if (!Array.isArray(settings) || !settings.length) {
      throw new Error('Application settings are missing. Run the application availability SQL migration.');
    }
    applicationAvailability = {
      accepting_responses: settings[0].accepting_responses === true,
      pause_message: String(settings[0].pause_message || '')
    };
    renderApplicationAvailability();
  } catch (error) {
    applicationAvailability = null;
    captureClientError('application-availability-load', error);
    renderApplicationAvailability();
    if ($('#applicationAvailabilityForm') && financeManagerAuthorized) {
      showToast(`Application settings could not be loaded: ${error.message || 'Check Supabase policies.'}`, 'error', 7000);
    }
  }
}

$('#applicationsPausedToggle')?.addEventListener('change', async event => {
  if (!financeManagerAuthorized) {
    showToast('Only the finance admin can change application availability.', 'warning');
    await loadApplicationAvailability();
    return;
  }

  const toggle = event.currentTarget;
  const acceptingResponses = !toggle.checked;
  toggle.disabled = true;
  try {
    const updatedSettings = await supabaseRequest('application_settings?id=eq.1&select=id', {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        accepting_responses: acceptingResponses,
        updated_at: new Date().toISOString()
      })
    });
    if (!Array.isArray(updatedSettings) || !updatedSettings.length) {
      throw new Error('No application settings were updated. Check that the finance admin is signed in and the application settings migration has been applied.');
    }
    applicationAvailability = {
      ...applicationAvailability,
      accepting_responses: acceptingResponses
    };
    renderApplicationAvailability();
    showToast(acceptingResponses ? 'Applications are open.' : 'Applications are paused.', 'success');
  } catch (error) {
    captureClientError('application-availability-save', error);
    showToast(`Unable to update application availability: ${error.message || 'Check Supabase policies.'}`, 'error', 7000);
    await loadApplicationAvailability();
  } finally {
    toggle.disabled = false;
  }
});

$('#applicationAvailabilityForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  if (!financeManagerAuthorized || applicationAvailability?.accepting_responses !== false) {
    showToast('Pause applications before setting a custom message.', 'warning');
    return;
  }

  const message = $('#applicationPauseMessage').value.trim();
  const submitButton = $('#saveApplicationPauseMessage');
  submitButton.disabled = true;
  submitButton.textContent = 'Saving...';
  try {
    const updatedSettings = await supabaseRequest('application_settings?id=eq.1&select=id', {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        pause_message: message,
        updated_at: new Date().toISOString()
      })
    });
    if (!Array.isArray(updatedSettings) || !updatedSettings.length) {
      throw new Error('No application settings were updated. Check that the finance admin is signed in.');
    }
    applicationAvailability.pause_message = message;
    renderApplicationAvailability();
    showToast('Pause message saved.', 'success');
  } catch (error) {
    captureClientError('application-pause-message-save', error);
    showToast(`Unable to save the pause message: ${error.message || 'Check Supabase policies.'}`, 'error', 7000);
    await loadApplicationAvailability();
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Save pause message';
  }
});

window.editSiteNotice = function (id) {
  if (!adminAuthorized) {
    showToast('Only an authorized admin can manage site notices.', 'warning');
    return;
  }
  const notice = getSiteNotices().find(item => String(item.id) === String(id));
  if (!notice) return;
  $('#siteNoticeRecordId').value = notice.id;
  $('#siteNoticeMessage').value = notice.message || '';
  $('#siteNoticeActive').checked = Boolean(notice.active);
  $('#siteNoticeForm').hidden = false;
  $('#siteNoticeSubmitBtn').textContent = 'Update notice';
  $('#siteNoticeMessage').focus();
};

window.deleteSiteNotice = async function (id) {
  if (!adminAuthorized) {
    showToast('Only an authorized admin can manage site notices.', 'warning');
    return;
  }
  if (!confirm('Delete this notice from the notice history?')) return;
  try {
    if (supabaseEnabled) {
      await supabaseRequest(`site_notices?id=eq.${id}`, { method: 'DELETE' });
      await loadSupabaseData();
    } else {
      remoteSiteNotices = getSiteNotices().filter(notice => String(notice.id) !== String(id));
      localStorage.setItem(SITE_NOTICE_STORAGE_KEY, JSON.stringify(remoteSiteNotices));
      renderSiteNotice();
      renderSiteNoticeAdminList();
    }
    showToast('Notice deleted.', 'success');
  } catch (error) {
    console.error(error);
    showToast(`Unable to delete the notice: ${error.message || 'Check your Supabase policies.'}`, 'error');
  }
};

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

  const announcements = getAnnouncements().slice().sort((a, b) => {
    const difference = parseAdminDate(a.eventDate) - parseAdminDate(b.eventDate);
    return announcementSortDirection === 'asc' ? difference : -difference;
  });
  updateSortButton($('#announcementDateSort'), announcementSortDirection, 'announcements');

  if (!announcements.length) {
    list.innerHTML = '<p class="empty-state">No announcements yet. Use “Add Announcement” to publish a live session.</p>';
    return;
  }

  list.innerHTML = announcements.map(item => {
    const active = isAnnouncementActive(item);
    const dateLabel = item.eventDate ? formatDateDDMMYYYY(item.eventDate) : 'No date';
    return `
      <div class="announcement-admin-item ${active ? '' : 'expired'}">
        <div>
          <strong>${escapeHtml(item.title || 'Announcement')}</strong>
          <p>${escapeHtml(item.guestName || 'Guest')}</p>
          <small>${dateLabel}${item.eventTime ? ' • ' + escapeHtml(item.eventTime) : ''}</small>
        </div>
        ${adminAuthorized ? `<div class="announcement-admin-actions">
          <button type="button" onclick="editAnnouncement(${escapeHtml(String(item.id || ''))})">Edit</button>
          <button type="button" class="delete-btn" onclick="deleteAnnouncement(${escapeHtml(String(item.id || ''))})">Delete</button>
        </div>` : '<span class="site-notice-status">Read only</span>'}
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
  if (!adminAuthorized) {
    showToast('Only an authorized admin can edit announcements.', 'warning');
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
  if (!adminAuthorized) {
    showToast('Only an authorized admin can delete announcements.', 'warning');
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

async function loadCompletedInterviewCount() {
  const countElement = $('#completedInterviewCount');
  if (!countElement || !supabaseEnabled) return;

  const formatter = new Intl.NumberFormat('en-IN');
  let currentCount = 0;
  let hasLoadedCount = false;

  const animateCount = count => {
    const startCount = currentCount;
    currentCount = count;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      countElement.textContent = formatter.format(count);
      return;
    }

    const startTime = performance.now();
    const duration = 1000;
    const animate = now => {
      const progress = Math.min((now - startTime) / duration, 1);
      const easedProgress = 1 - ((1 - progress) ** 3);
      const displayedCount = Math.round(startCount + ((count - startCount) * easedProgress));
      countElement.textContent = formatter.format(displayedCount);
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  };

  const refreshCount = async () => {
    try {
      const response = await fetch(`${supabaseConfig.url}/rest/v1/rpc/completed_interview_count`, {
        method: 'POST',
        headers: {
          apikey: supabaseConfig.anonKey,
          Authorization: `Bearer ${supabaseConfig.anonKey}`,
          'Content-Type': 'application/json'
        },
        body: '{}'
      });
      if (!response.ok) {
        const error = new Error(`Completed interview count request failed (${response.status})`);
        error.status = response.status;
        error.details = await response.text();
        throw error;
      }

      const count = Number(await response.json());
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error('Completed interview count returned an invalid value.');
      }

      animateCount(count);
      hasLoadedCount = true;
    } catch (error) {
      captureClientError('completed-interview-count', error);
      if (!hasLoadedCount) countElement.textContent = '—';
    }
  };

  await refreshCount();
  window.setInterval(refreshCount, 60000);
}

function normalizeSessionType(value) {
  const type = String(value || '').toLowerCase();
  if (type === 'guidance') return 'guidance';
  if (['hr-interview', 'hr interview'].includes(type)) return 'hr-interview';
  if (['same-day-mock', 'same-day-mock-interview', 'same day mock interview'].includes(type)) return 'same-day-mock';
  return 'mock-interview';
}

function getSessionTypeLabel(value) {
  const type = normalizeSessionType(value);
  return type === 'guidance' ? '1:1 Guidance' : type === 'hr-interview' ? 'HR Interview' : type === 'same-day-mock' ? 'Same-Day Mock Interview' : 'Mock Interview';
}

function getSessionAmount(value) {
  const type = normalizeSessionType(value);
  return type === 'guidance' || type === 'hr-interview' ? (type === 'guidance' ? 49 : 99) : type === 'same-day-mock' ? 199 : 129;
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
    sessionType: normalizeSessionType(row.session_type || row.sessionType),
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
    status: row.status,
    sessionType: normalizeSessionType(row.session_type || row.sessionType)
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
  const { data, error } = await supabaseClient.auth.getUser();
  const user = data?.user;
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

  try {
    const signedInEmail = await getSignedInUserEmail();
    if (!signedInEmail) return;

    const results = await Promise.allSettled([
      supabaseRequest('applications?select=*&order=created_at.desc'),
      supabaseRequest('finance_records?select=*&order=created_at.desc'),
      supabaseRequest('scheduled_interviews?select=*&order=interview_date.desc,created_at.desc'),
      supabaseRequest('announcements?select=*&order=event_end.asc'),
      supabaseRequest('site_notices?select=*&order=created_at.desc,id.desc')
    ]);

    const [applicationsResult, financesResult, schedulesResult, announcementsResult, siteNoticeResult] = results;
    const sources = [
      ['applications', applicationsResult],
      ['finance records', financesResult],
      ['scheduled interviews', schedulesResult],
      ['announcements', announcementsResult],
      ['site notice', siteNoticeResult]
    ];

    sources.forEach(([source, result]) => {
      if (result.status === 'rejected') {
        console.error(`Could not load ${source}.`, result.reason);
        showToast(`${source} could not be loaded: ${result.reason?.message || 'Check Supabase policies.'}`, 'error', 7000);
      }
    });

    if (applicationsResult.status === 'fulfilled') remoteApplications = Array.isArray(applicationsResult.value) ? applicationsResult.value.map(mapApplication) : [];
    if (financesResult.status === 'fulfilled') remoteFinances = Array.isArray(financesResult.value) ? financesResult.value.map(mapFinance) : [];
    if (schedulesResult.status === 'fulfilled') remoteSchedules = Array.isArray(schedulesResult.value) ? schedulesResult.value.map(mapSchedule) : [];
    if (announcementsResult.status === 'fulfilled') remoteAnnouncements = Array.isArray(announcementsResult.value) ? announcementsResult.value.map(mapAnnouncement) : [];
    if (siteNoticeResult.status === 'fulfilled') {
      remoteSiteNotices = Array.isArray(siteNoticeResult.value) ? siteNoticeResult.value : [];
      renderSiteNotice();
      renderSiteNoticeAdminList();
    }
    render();
  } catch (error) {
    captureClientError('dashboard-load', error);
    showToast(`Dashboard load failed: ${error.message || 'Check Supabase configuration and policies.'}`, 'error', 7000);
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
  document.body.style.overflow = isAdminRoute ? '' : 'hidden';
};

const close = (id) => {
  const el = $('#' + id);
  if (el) el.classList.remove('show');
  document.body.style.overflow = '';
};

function setAdminRouteAuthenticated(isAuthenticated) {
  document.body.classList.toggle('admin-authenticated', isAuthenticated);
}

// ==========================================================
// Financials & Settlements Dashboard Logic
// ==========================================================
let activeFinanceFilter = 'All';
let activeFinanceSessionFilter = 'All';
let financeSearchQuery = '';
let pastSchedulePage = 1;
const PAST_SCHEDULE_PAGE_SIZE = 10;

function updateFinanceAdminControls() {
  const addFinanceButton = $('#openAddFinanceBtn');
  const addAnnouncementButton = $('#openAnnouncementModalBtn');
  const addSiteNoticeButton = $('#newSiteNoticeBtn');

  if (addFinanceButton) {
    addFinanceButton.hidden = !financeManagerAuthorized;
    addFinanceButton.style.display = financeManagerAuthorized ? '' : 'none';
  }

  if (addAnnouncementButton) {
    addAnnouncementButton.hidden = !adminAuthorized;
    addAnnouncementButton.style.display = adminAuthorized ? '' : 'none';
  }

  if (addSiteNoticeButton) {
    addSiteNoticeButton.hidden = !adminAuthorized;
    addSiteNoticeButton.style.display = adminAuthorized ? '' : 'none';
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
  let filtered = allFinances.slice();
  filtered.sort((a, b) => {
    const difference = parseAdminDate(a.date) - parseAdminDate(b.date);
    return financeSortDirection === 'asc' ? difference : -difference;
  });
  updateSortButton($('#financeDateSort'), financeSortDirection, 'finance records');

  if (activeFinanceFilter === 'Pending') {
    filtered = filtered.filter(item => item.status !== 'Settled');
  } else if (activeFinanceFilter === 'Settled') {
    filtered = filtered.filter(item => item.status === 'Settled');
  }

  if (activeFinanceSessionFilter !== 'All') {
    filtered = filtered.filter(item => normalizeSessionType(item.sessionType) === activeFinanceSessionFilter);
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
        <td><strong>${item.date ? formatDateDDMMYYYY(item.date) : '—'}</strong></td>
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
  return formatDateDDMMYYYY(value);
}

function renderSchedules() {
  const tableBody = $('#scheduleTableBody');
  const pastTableBody = $('#pastScheduleTableBody');
  if (!tableBody || !pastTableBody) return;

  const scheduled = remoteSchedules.filter(item => item.status !== 'Done').slice().sort((a, b) => {
    const difference = parseAdminDate(a.interviewDate) - parseAdminDate(b.interviewDate);
    return scheduleSortDirection === 'asc' ? difference : -difference;
  });
  const past = remoteSchedules.filter(item => item.status === 'Done').slice().sort((a, b) => {
    const difference = parseAdminDate(a.interviewDate) - parseAdminDate(b.interviewDate);
    return pastScheduleSortDirection === 'asc' ? difference : -difference;
  });
  updateSortButton($('#scheduleDateSort'), scheduleSortDirection, 'scheduled interviews');
  updateSortButton($('#pastScheduleDateSort'), pastScheduleSortDirection, 'past interviews');
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

function getResumeApplications() {
  const source = supabaseEnabled ? remoteApplications : applications;
  return source.filter(item => item.resume_path);
}

function renderResumeUploads() {
  const container = $('#resumeUploadAdminList');
  if (!container) return;
  const resumes = getResumeApplications();
  if (!resumes.length) {
    container.innerHTML = '<p class="empty-state">No resumes have been uploaded yet.</p>';
    return;
  }
  container.innerHTML = resumes.map(item => `
    <article class="resume-upload-admin-row">
      <div><strong>${escapeHtml(item.name || 'Candidate')}</strong><span>${escapeHtml(item.email || '')}</span><small class="resume-state-uploaded">Uploaded ${escapeHtml(item.resume_uploaded_at ? new Date(item.resume_uploaded_at).toLocaleString() : '')}</small></div>
      <div class="resume-upload-actions">
        <button type="button" class="button button-outline btn-sm" data-resume-view="${escapeHtml(item.id)}">View resume</button>
        ${financeManagerAuthorized
          ? `<button type="button" class="delete-row-btn" data-resume-delete="${escapeHtml(item.id)}">Delete</button>`
          : '<span class="resume-read-only">Read only</span>'}
      </div>
    </article>`).join('');
}

window.deleteResumeUpload = async function (id) {
  if (!financeManagerAuthorized) {
    showToast('Only the finance admin can delete uploaded resumes.', 'warning');
    return;
  }
  const item = getResumeApplications().find(application => String(application.id) === String(id));
  if (!item) return;
  if (!confirm(`Delete the uploaded resume for ${item.name || 'this candidate'}? The file will be permanently deleted.`)) return;
  try {
    const { error: storageError } = await supabaseClient.storage.from('candidate-resumes').remove([item.resume_path]);
    if (storageError) throw storageError;
    const { data, error } = await supabaseClient.rpc('delete_application_resume', { p_application_id: item.id });
    if (error) throw error;
    if (data !== true) throw new Error('The resume record could not be cleared.');
    item.resume_path = null;
    item.resume_uploaded_at = null;
    renderResumeUploads();
    showToast('Resume and upload record deleted.', 'success');
  } catch (error) {
    showToast(`Unable to delete the resume: ${error.message || 'Check Supabase policies.'}`, 'error');
  }
};

window.openResumeUpload = async function (id) {
  if (!adminAuthorized) return;
  const item = getResumeApplications().find(application => String(application.id) === String(id));
  if (!item?.resume_path) return;
  const previewWindow = window.open('about:blank', '_blank');
  try {
    const { data, error } = await supabaseClient.storage.from('candidate-resumes').createSignedUrl(item.resume_path, 300);
    if (error) throw error;
    if (!data?.signedUrl) throw new Error('A temporary resume link could not be created.');
    if (previewWindow) {
      previewWindow.opener = null;
      previewWindow.location.href = data.signedUrl;
    } else {
      showToast('Allow pop-ups to open the resume.', 'warning');
    }
  } catch (error) {
    previewWindow?.close();
    showToast(`Unable to open the resume: ${error.message || 'Check Supabase policies.'}`, 'error');
  }
};

$('#resumeUploadAdminList')?.addEventListener('click', event => {
  const viewButton = event.target.closest('[data-resume-view]');
  const deleteButton = event.target.closest('[data-resume-delete]');
  if (viewButton) window.openResumeUpload(viewButton.dataset.resumeView);
  if (deleteButton) window.deleteResumeUpload(deleteButton.dataset.resumeDelete);
});

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

Keep your updated resume readily available.
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
  $('#recordSessionType').value = normalizeSessionType(item.sessionType);
  $('#recordAmount').value = item.amount || getSessionAmount(item.sessionType);
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
function getApplicationTimestamp(application) {
  return application.created_at || application.createdAt || application.submittedAt || application.submitted_at || '';
}

function formatApplicationTimestamp(value) {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return `${formatDateDDMMYYYY(date)}, ${date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
}

function getLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function renderApplicationStats(all) {
  const now = new Date();
  const todayKey = getLocalDateKey(now);
  const timestampedApplications = all
    .map(application => ({ application, date: new Date(getApplicationTimestamp(application)) }))
    .filter(item => !Number.isNaN(item.date.getTime()));
  const latest = timestampedApplications.slice().sort((a, b) => b.date - a.date)[0];
  const receivedToday = timestampedApplications.filter(item => getLocalDateKey(item.date) === todayKey).length;

  $('#applicationTotalStat') && ($('#applicationTotalStat').textContent = all.length);
  $('#applicationTodayStat') && ($('#applicationTodayStat').textContent = receivedToday);
  $('#applicationLatestStat') && ($('#applicationLatestStat').textContent = latest ? formatApplicationTimestamp(getApplicationTimestamp(latest.application)).split(',')[0] : '-');
  $('#applicationLatestNote') && ($('#applicationLatestNote').textContent = latest ? formatApplicationTimestamp(getApplicationTimestamp(latest.application)) : 'No submissions yet');
}

function renderApplications() {
  const list = $('#applicationList');
  if (!list) return;
  const websiteApplications = supabaseEnabled ? remoteApplications : applications;
  const allApplications = websiteApplications.slice().sort((a, b) => {
    const dateDifference = new Date(getApplicationTimestamp(b) || 0) - new Date(getApplicationTimestamp(a) || 0);
    if (dateDifference) return applicationSortDirection === 'asc' ? -dateDifference : dateDifference;
    return Number(b.id || 0) - Number(a.id || 0);
  });
  const all = activeApplicationFilter === 'All'
    ? allApplications
    : allApplications.filter(application => normalizeSessionType(application.sessionType) === activeApplicationFilter);
  const pageCount = Math.max(1, Math.ceil(all.length / applicationsPerPage));
  applicationPage = Math.min(applicationPage, pageCount);
  const pageStart = (applicationPage - 1) * applicationsPerPage;
  const pageItems = all.slice(pageStart, pageStart + applicationsPerPage);
  const pagination = $('#applicationPagination');

  if ($('#applicationCountBadge')) $('#applicationCountBadge').textContent = all.length;
  if ($('#applicationSubNote')) {
    const sourceLabel = supabaseEnabled ? 'database' : 'local';
    $('#applicationSubNote').textContent = activeApplicationFilter === 'All'
      ? `${allApplications.length} ${sourceLabel} applications`
      : `${all.length} ${getSessionTypeLabel(activeApplicationFilter)} applications`;
  }
  renderApplicationStats(allApplications);

  if (!all.length) {
    list.innerHTML = '<p class="empty-state">New applications from the public form will appear here.</p>';
    if (pagination) pagination.hidden = true;
    return;
  }

  const field = (title, value) => `
    <div class="application-field">
      <dt>${escapeHtml(title)}</dt>
      <dd>${escapeHtml(value || 'Not provided')}</dd>
    </div>
  `;

  list.innerHTML = pageItems.map(a => {
    const applicationTimestamp = getApplicationTimestamp(a);
    return `
    <article class="application-row">
      <div class="application-heading">
        <div>
          <strong>${escapeHtml(a.name || 'Applicant')}</strong>
          <span class="application-source">${escapeHtml(a.source || 'Google Form')}</span>
        </div>
        <time datetime="${escapeHtml(applicationTimestamp)}">${escapeHtml(formatApplicationTimestamp(applicationTimestamp))}</time>
      </div>
      <dl class="application-summary">
        ${field('Session type', getSessionTypeLabel(a.sessionType))}
        ${field('Email address', a.email)}
        ${field('WhatsApp number', a.whatsapp)}
        ${field('College name', a.college)}
      </dl>
      <button type="button" class="application-read-more" data-application-id="${escapeHtml(a.id || applicationTimestamp)}">Read more</button>
      <dl class="application-details">
        ${field('Session type', getSessionTypeLabel(a.sessionType))}
        ${field('Full name', a.name)}
        ${field('Email address', a.email)}
        ${field('WhatsApp number', a.whatsapp)}
        ${field('College name', a.college)}
        ${field('Current semester', a.semester)}
        ${field('Branch', a.branch)}
        ${field('Technologies you know', a.technology)}
        ${field('Languages you know', a.languages)}
        ${field('Preferred interview date', a.preferredDate ? formatDateDDMMYYYY(a.preferredDate) : '')}
        ${field('Preferred interview format', a.format)}
        ${field('Anything we should know?', a.notes)}
        ${field('Payment screenshot / proof', a.paymentProof)}
      </dl>
    </article>
  `;
  }).join('');

  list.querySelectorAll('[data-application-id]').forEach(button => {
    button.addEventListener('click', () => {
      const application = pageItems.find(item => String(item.id || getApplicationTimestamp(item)) === button.dataset.applicationId);
      if (!application) return;
      const detailContent = $('#applicationDetailContent');
      if (!detailContent) return;
      const applicationTimestamp = getApplicationTimestamp(application);
      detailContent.innerHTML = `
        <div class="application-heading">
          <div>
            <strong>${escapeHtml(application.name || 'Applicant')}</strong>
            <span class="application-source">${escapeHtml(application.source || 'Google Form')}</span>
          </div>
          <time datetime="${escapeHtml(applicationTimestamp)}">${escapeHtml(formatApplicationTimestamp(applicationTimestamp))}</time>
        </div>
        <dl class="application-details application-details-modal">
          ${field('Session type', getSessionTypeLabel(application.sessionType))}
          ${field('Full name', application.name)}
          ${field('Email address', application.email)}
          ${field('WhatsApp number', application.whatsapp)}
          ${field('College name', application.college)}
          ${field('Current semester', application.semester)}
          ${field('Branch', application.branch)}
          ${field('Technologies you know', application.technology)}
          ${field('Languages you know', application.languages)}
          ${field('Preferred interview date', application.preferredDate ? formatDateDDMMYYYY(application.preferredDate) : '')}
          ${field('Preferred interview format', application.format)}
          ${field('Anything we should know?', application.notes)}
          ${field('Payment screenshot / proof', application.paymentProof)}
        </dl>
      `;
      open('applicationDetailModal');
    });
  });

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
  const sections = [
    ['Finance records', renderFinances],
    ['Interview schedules', renderSchedules],
    ['Resume uploads', renderResumeUploads],
    ['Candidate applications', renderApplications],
    ['Live announcements', renderAnnouncements],
    ['Event announcement history', renderAnnouncementAdminList],
    ['Homepage notice', renderSiteNotice],
    ['Homepage notice history', renderSiteNoticeAdminList]
  ];
  sections.forEach(([label, renderSection]) => {
    try {
      renderSection();
    } catch (error) {
      captureClientError(`${label.toLowerCase().replaceAll(' ', '-')}-render`, error);
      showToast(`${label} could not be displayed: ${error.message || 'Check the browser console.'}`, 'error', 7000);
    }
  });
}

// ==========================================================
// Form Submission & Automatic Pipeline Linking
// ==========================================================
const form = $('#applicationForm');
if (form) {
  const sessionTypeField = $('#sessionType');
  const requestedSessionType = new URLSearchParams(window.location.search).get('session');
  if (sessionTypeField && ['mock-interview', 'same-day-mock', 'guidance', 'hr-interview'].includes(requestedSessionType)) {
    sessionTypeField.value = requestedSessionType;
  }
  const clearApplicationFieldError = (control) => {
    const label = control.closest('label');
    const error = label?.querySelector(`[data-validation-for="${control.name}"]`);
    if (error) {
      if (control.getAttribute('aria-describedby') === error.id) control.removeAttribute('aria-describedby');
      error.remove();
    }
    control.removeAttribute('aria-invalid');
    label?.classList.remove('has-validation-error');
  };
  const validateRequiredApplicationFields = () => {
    let firstInvalidField = null;
    const controls = [...form.querySelectorAll('input, select, textarea')]
      .filter(control => control.required && !control.disabled);

    controls.forEach(control => {
      const label = control.closest('label');
      if (control.checkValidity()) {
        clearApplicationFieldError(control);
        return;
      }

      if (!firstInvalidField) firstInvalidField = control;
      let error = label?.querySelector(`[data-validation-for="${control.name}"]`);
      if (!error && label) {
        error = document.createElement('span');
        error.className = 'application-field-error';
        error.dataset.validationFor = control.name;
        error.id = `${form.id}-${control.name}-error`;
        error.setAttribute('role', 'alert');
        label.append(error);
      }
      if (error) {
        error.textContent = control.validity.valueMissing
          ? 'This field is required.'
          : control.validity.typeMismatch
            ? 'Enter a valid email address.'
            : 'Please enter a valid value.';
        control.setAttribute('aria-describedby', error.id);
      }
      control.setAttribute('aria-invalid', 'true');
      label?.classList.add('has-validation-error');
    });

    if (firstInvalidField) {
      firstInvalidField.focus();
      firstInvalidField.closest('label')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    return true;
  };
  const updateApplicationForm = () => {
    const sessionType = normalizeSessionType(sessionTypeField?.value);
    const isGuidance = sessionType === 'guidance';
    const isSameDay = sessionType === 'same-day-mock';
    const isHrInterview = sessionType === 'hr-interview';
    const preferredDate = form.querySelector('[name="preferredDate"]');
    const preferredDateField = form.querySelector('[data-preferred-date-field]');
    if (preferredDate) {
      const today = new Date();
      const todayValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const firstAvailableDate = new Date(today);
      if (!isSameDay) firstAvailableDate.setDate(firstAvailableDate.getDate() + 1);
      const minimumDate = `${firstAvailableDate.getFullYear()}-${String(firstAvailableDate.getMonth() + 1).padStart(2, '0')}-${String(firstAvailableDate.getDate()).padStart(2, '0')}`;
      preferredDate.min = minimumDate;
      preferredDate.hidden = isSameDay;
      preferredDate.required = !isGuidance && !isSameDay;
      preferredDate.value = isSameDay ? todayValue : '';
    }
    if (preferredDateField) preferredDateField.hidden = isSameDay;
    document.querySelectorAll('[data-guidance-hide]').forEach(group => {
      group.hidden = isGuidance;
      group.style.display = isGuidance ? 'none' : '';
      group.querySelectorAll('input, select, textarea').forEach(control => {
        control.required = !isGuidance;
        if (isGuidance) {
          control.value = '';
          clearApplicationFieldError(control);
        }
      });
    });
    const paymentTitle = $('#paymentTitle');
    const paymentDescription = $('#paymentDescription');
    const paymentQr = $('#paymentQr');
    const formTimeEstimate = $('#formTimeEstimate');
    if (formTimeEstimate) formTimeEstimate.textContent = isGuidance ? '~2 minutes' : '~5 minutes';
    if (paymentTitle) paymentTitle.innerHTML = isGuidance ? '1:1 guidance<br><em>₹49</em>' : isHrInterview ? 'HR interview<br><em>₹99</em>' : isSameDay ? 'Same-day mock interview<br><em>₹199</em>' : 'Mock interview<br><em>₹129</em>';
    if (paymentQr) {
      const qrBySession = {
        guidance: 'assets/1%20on%201%2049.png',
        'hr-interview': 'assets/HR%2099.png',
        'same-day-mock': 'assets/same%20day%20199.png',
        'mock-interview': 'assets/standard%20mock%20129.png'
      };
      paymentQr.src = qrBySession[sessionType] || qrBySession['mock-interview'];
      paymentQr.alt = `NextRound ${getSessionTypeLabel(sessionType)} payment QR`;
    }
    if (paymentDescription) paymentDescription.textContent = isSameDay
      ? 'Same-day slots depend on interviewer availability. Scan the official NextRound QR for ₹199, then upload your payment screenshot.'
      : 'Scan the official NextRound QR, make payment, then upload a screenshot below.';
  };

  sessionTypeField?.addEventListener('change', updateApplicationForm);
  updateApplicationForm();

  form.addEventListener('input', event => {
    const control = event.target;
    if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) {
      if (control.checkValidity()) clearApplicationFieldError(control);
    }
  });
  form.addEventListener('change', event => {
    const control = event.target;
    if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) {
      if (control.checkValidity()) clearApplicationFieldError(control);
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.dataset.submitting === 'true' || form.dataset.submitted === 'true') return;
    if (!validateRequiredApplicationFields()) return;
    if (supabaseEnabled) await loadApplicationAvailability();
    if (supabaseEnabled && applicationAvailability?.accepting_responses !== true) {
      renderApplicationAvailability();
      showToast(DEFAULT_APPLICATION_PAUSE_MESSAGE, 'warning', 7000);
      return;
    }
    form.dataset.submitting = 'true';
    let submissionSucceeded = false;
    const submitButton = form.querySelector('[type="submit"]');
    const submitLabel = submitButton?.textContent || '';
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Submitting...';
    }

    try {
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
        if (!window.crypto?.getRandomValues) throw new Error('Secure random generation is unavailable in this browser.');
        const resumeTokenBytes = window.crypto.getRandomValues(new Uint8Array(32));
        const resumeToken = Array.from(resumeTokenBytes, byte => byte.toString(16).padStart(2, '0')).join('');
        const resumeTokenHash = await hashResumeUploadToken(resumeToken);
        const applicationPayload = {
          name: data.name,
          email: data.email,
          whatsapp: data.whatsapp,
          college: data.college,
          semester: data.semester,
          branch: data.branch,
          technology: data.technology,
          languages: data.languages,
          source: 'Website',
          session_type: normalizeSessionType(data.sessionType),
          preferred_date: data.preferredDate || null,
          interview_format: data.format || null,
          notes: data.notes || null,
          payment_proof_url: paymentProofPath,
          resume_upload_token_hash: resumeTokenHash
        };
        await supabaseRequest('applications', {
          method: 'POST',
          headers: {
            Prefer: 'return=minimal',
            Authorization: `Bearer ${supabaseConfig.anonKey}`
          },
          body: JSON.stringify(applicationPayload)
        });
        const { data: applicationId, error: applicationIdError } = await supabaseClient.rpc('application_id_for_resume_token', { p_token_hash: resumeTokenHash });
        if (applicationIdError) console.error('Could not prepare the resume upload step:', applicationIdError);
        pendingResumeUpload = applicationId ? { applicationId, tokenHash: resumeTokenHash } : null;
        form.reset();
        updateApplicationForm();
        const label = $('#fileName');
        if (label) label.textContent = 'Choose image or PDF';
        $('#resumeUploadSection').hidden = false;
        $('#resumeUploadStatus').textContent = pendingResumeUpload ? '' : 'Your application was received, but resume upload is temporarily unavailable. Please contact the NextRound team.';
        $('#resumeFile').value = '';
        $('#resumeUploadForm').hidden = !pendingResumeUpload;
        $('#resumeUploadButton').disabled = false;
        $('#resumeUploadButton').textContent = 'Upload resume';
        showToast('Application submitted successfully. Someone from the team will contact you.', 'success');
        open('successModal');
        submissionSucceeded = true;
        return;
      } catch (error) {
        captureClientError('application-submit', error);
        const detail = error.details && typeof error.details === 'object'
          ? error.details.message || error.details.error
          : '';
        if (error.details?.code === 'P0001') {
          await loadApplicationAvailability();
        }
        const status = error.status ? ` (HTTP ${error.status})` : '';
        const reason = detail ? ` ${detail}` : '';
        showToast(`Application could not be submitted${status}.${reason} Please try again.`, 'error', 7000);
        return;
      }
    }

    // 1. Save to applicant queue
    data.submittedAt = new Date().toISOString();
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
    const sessionType = normalizeSessionType(data.sessionType);
    finances.push({
      id: Date.now(),
      date: sessionDate,
      candidate: data.name || 'Website Applicant',
      takenBy: data.interviewer || 'Pending Assignment',
      amount: getSessionAmount(sessionType),
      sessionType,
      status: 'Pending'
    });
    saveFinances(finances);

    form.reset();
    updateApplicationForm();
    const label = $('#fileName');
    if (label) label.textContent = 'Choose image or PDF';
    showToast('Application submitted successfully.', 'success');
    open('successModal');
    submissionSucceeded = true;
    } finally {
      delete form.dataset.submitting;
      if (submitButton) {
        submitButton.disabled = submissionSucceeded;
        submitButton.textContent = submissionSucceeded ? 'Submitted' : submitLabel;
      }
      if (submissionSucceeded) form.dataset.submitted = 'true';
    }
  });
}

// File upload preview label
const upload = $('[name=paymentProof]');
if (upload) {
  upload.addEventListener('change', () => {
    $('#fileName').textContent = upload.files[0]?.name || 'Choose image or PDF';
  });
}

$('#resumeUploadForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  if (!pendingResumeUpload || !supabaseClient) return;
  const fileInput = $('#resumeFile');
  const file = fileInput?.files?.[0];
  if (!file) return;
  const extension = file.name.split('.').pop().toLowerCase();
  if (!['pdf', 'doc', 'docx'].includes(extension)) {
    $('#resumeUploadStatus').textContent = 'Choose a PDF, DOC, or DOCX file.';
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    $('#resumeUploadStatus').textContent = 'The resume must be 10 MB or smaller.';
    return;
  }

  const button = $('#resumeUploadButton');
  button.disabled = true;
  button.textContent = 'Uploading…';
  $('#resumeUploadStatus').textContent = 'Uploading your resume…';
  try {
    const objectPath = `${pendingResumeUpload.applicationId}/${pendingResumeUpload.tokenHash}/resume.${extension}`;
    const contentTypes = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };
    const { error: uploadError } = await supabaseClient.storage.from('candidate-resumes').upload(objectPath, file, {
      cacheControl: '3600',
      contentType: contentTypes[extension],
      upsert: true
    });
    if (uploadError) throw uploadError;
    const { data, error } = await supabaseClient.rpc('complete_application_resume', {
      p_application_id: pendingResumeUpload.applicationId,
      p_token_hash: pendingResumeUpload.tokenHash,
      p_object_path: objectPath
    });
    if (error) throw error;
    if (data !== true) throw new Error('The resume could not be linked to your application. Please contact the NextRound team.');
    $('#resumeUploadStatus').textContent = 'Your updated resume was uploaded successfully. Thank you.';
    $('#resumeUploadForm').hidden = true;
    button.textContent = 'Resume uploaded';
    pendingResumeUpload = null;
  } catch (error) {
    console.error('Resume upload failed:', error);
    $('#resumeUploadStatus').textContent = error.message || 'Your resume could not be uploaded. Please try again.';
    button.disabled = false;
    button.textContent = 'Upload resume';
  }
});

// ==========================================================
// Admin Workspace Interactions & Navigation
// ==========================================================
['#openAdmin', '#openAdminFooter'].forEach(s => {
  $(s)?.addEventListener('click', event => {
    event.preventDefault();
    window.location.assign('admin.html');
  });
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
    setAdminRouteAuthenticated(true);
    updateFinanceAdminControls();
    renderApplicationAvailability();
    await loadApplicationAvailability();

    if (!financeManagerAuthorized) {
      $('#adminLogin').hidden = true;
      $('#adminDashboard').hidden = false;
      showToast('Successfully logged in as an Admin.', 'success');
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
  setAdminRouteAuthenticated(false);
  updateFinanceAdminControls();
  renderApplicationAvailability();
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
  setAdminRouteAuthenticated(true);
  updateFinanceAdminControls();
  renderApplicationAvailability();
  await loadApplicationAvailability();
  $('#adminLogin').hidden = true;
  $('#adminDashboard').hidden = false;
  await loadSupabaseData();
}

supabaseClient?.auth.onAuthStateChange((event, session) => {
  if (event === 'TOKEN_REFRESHED' && session) {
    adminAuthorized = adminEmails.includes(session.user?.email?.toLowerCase() || '');
    financeManagerAuthorized = adminAuthorized && session.user.email.toLowerCase() === financeAdminEmail;
    updateFinanceAdminControls();
    renderApplicationAvailability();
  }
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
  $('#recordSessionType').value = 'mock-interview';
  $('#recordAmount').value = 129;
  $('#recordStatus').value = 'Settled';
  $('#recordModalEyebrow').textContent = 'RECORD SESSION & PAYMENT';
  open('recordModal');
});

$('#openAnnouncementModalBtn')?.addEventListener('click', () => {
  if (!adminAuthorized) {
    showToast('Only an authorized admin can manage announcements.', 'warning');
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

  if (!adminAuthorized) {
    showToast('Only an authorized admin can manage announcements.', 'warning');
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

$('#siteNoticeForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!adminAuthorized) {
    showToast('Only an authorized admin can manage the site notice.', 'warning');
    return;
  }

  const noticeId = $('#siteNoticeRecordId').value;
  const notice = {
    message: $('#siteNoticeMessage').value.trim(),
    active: $('#siteNoticeActive').checked,
    updated_at: new Date().toISOString()
  };
  if (notice.active && !notice.message) {
    showToast('Enter a message before publishing the site notice.', 'warning');
    return;
  }

  try {
    if (supabaseEnabled) {
      if (notice.active) {
        await supabaseRequest('site_notices?active=eq.true', {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ active: false })
        });
      }
      await supabaseRequest(noticeId ? `site_notices?id=eq.${noticeId}` : 'site_notices', {
        method: noticeId ? 'PATCH' : 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(notice)
      });
      await loadSupabaseData();
    } else {
      remoteSiteNotices = getSiteNotices().map(item => ({
        ...item,
        active: notice.active ? false : item.active
      }));
      const existingIndex = remoteSiteNotices.findIndex(item => String(item.id) === String(noticeId));
      const savedNotice = {
        ...notice,
        id: noticeId || Date.now(),
        created_at: existingIndex >= 0 ? remoteSiteNotices[existingIndex].created_at : new Date().toISOString()
      };
      if (existingIndex >= 0) remoteSiteNotices[existingIndex] = savedNotice;
      else remoteSiteNotices.unshift(savedNotice);
      localStorage.setItem(SITE_NOTICE_STORAGE_KEY, JSON.stringify(remoteSiteNotices));
      renderSiteNotice();
      renderSiteNoticeAdminList();
    }
    $('#siteNoticeForm').reset();
    $('#siteNoticeRecordId').value = '';
    $('#siteNoticeForm').hidden = true;
    $('#siteNoticeSubmitBtn').textContent = 'Save notice';
    showToast('Site notice saved.', 'success');
  } catch (error) {
    console.error(error);
    showToast(`Unable to save the site notice: ${error.message || 'Check your Supabase policies.'}`, 'error');
  }
});

$('#newSiteNoticeBtn')?.addEventListener('click', () => {
  if (!adminAuthorized) {
    showToast('Only an authorized admin can manage site notices.', 'warning');
    return;
  }
  $('#siteNoticeForm').reset();
  $('#siteNoticeRecordId').value = '';
  $('#siteNoticeActive').checked = true;
  $('#siteNoticeSubmitBtn').textContent = 'Save notice';
  $('#siteNoticeForm').hidden = false;
  $('#siteNoticeMessage').focus();
});

$('#cancelSiteNoticeEdit')?.addEventListener('click', () => {
  $('#siteNoticeForm').reset();
  $('#siteNoticeRecordId').value = '';
  $('#siteNoticeForm').hidden = true;
});

$('#scheduleDateSort')?.addEventListener('click', () => {
  scheduleSortDirection = scheduleSortDirection === 'asc' ? 'desc' : 'asc';
  renderSchedules();
});

$('#pastScheduleDateSort')?.addEventListener('click', () => {
  pastScheduleSortDirection = pastScheduleSortDirection === 'asc' ? 'desc' : 'asc';
  renderSchedules();
});

$('#financeDateSort')?.addEventListener('click', () => {
  financeSortDirection = financeSortDirection === 'asc' ? 'desc' : 'asc';
  renderFinances();
});

$('#announcementDateSort')?.addEventListener('click', () => {
  announcementSortDirection = announcementSortDirection === 'asc' ? 'desc' : 'asc';
  renderAnnouncementAdminList();
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
      item.sessionType = normalizeSessionType($('#recordSessionType').value);
      item.amount = Number($('#recordAmount').value) || getSessionAmount(item.sessionType);
      item.status = $('#recordStatus').value;
    }
  } else {
    // Create new
    finances.push({
      id: Date.now(),
      date: $('#recordDate').value.trim(),
      candidate: $('#recordCandidate').value.trim(),
      takenBy: $('#recordTakenBy').value.trim() || 'Pending Assignment',
      amount: Number($('#recordAmount').value) || getSessionAmount($('#recordSessionType').value),
      sessionType: normalizeSessionType($('#recordSessionType').value),
      status: $('#recordStatus').value
    });
  }

  if (supabaseEnabled) {
    const payload = {
      interview_date: toDatabaseDate($('#recordDate').value.trim()),
      candidate: $('#recordCandidate').value.trim(),
      taken_by: $('#recordTakenBy').value.trim() || 'Pending Assignment',
      amount: Number($('#recordAmount').value) || getSessionAmount($('#recordSessionType').value),
      status: $('#recordStatus').value,
      session_type: normalizeSessionType($('#recordSessionType').value)
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

$('#recordSessionType')?.addEventListener('change', event => {
  $('#recordAmount').value = getSessionAmount(event.target.value);
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

$('#financeSessionPills')?.addEventListener('click', (e) => {
  const pill = e.target.closest('.filter-pill');
  if (!pill) return;
  document.querySelectorAll('#financeSessionPills .filter-pill').forEach(button => button.classList.remove('active'));
  pill.classList.add('active');
  activeFinanceSessionFilter = pill.dataset.sessionFilter || 'All';
  renderFinances();
});

$('#applicationFilterPills')?.addEventListener('click', (e) => {
  const pill = e.target.closest('[data-application-filter]');
  if (!pill) return;
  document.querySelectorAll('#applicationFilterPills .filter-pill').forEach(button => button.classList.remove('active'));
  pill.classList.add('active');
  activeApplicationFilter = pill.dataset.applicationFilter || 'All';
  applicationPage = 1;
  renderApplications();
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
  $('#tabAnnouncementsBtn').classList.remove('active');
  $('#financesTab').hidden = false;
  $('#schedulesTab').hidden = true;
  $('#applicationsTab').hidden = true;
  $('#announcementsTab').hidden = true;
});

$('#tabSchedulesBtn')?.addEventListener('click', () => {
  $('#tabSchedulesBtn').classList.add('active');
  $('#tabApplicationsBtn').classList.remove('active');
  $('#tabFinancesBtn').classList.remove('active');
  $('#tabAnnouncementsBtn').classList.remove('active');
  $('#schedulesTab').hidden = false;
  $('#applicationsTab').hidden = true;
  $('#financesTab').hidden = true;
  $('#announcementsTab').hidden = true;
  renderSchedules();
});

$('#tabApplicationsBtn')?.addEventListener('click', () => {
  $('#tabApplicationsBtn').classList.add('active');
  $('#tabSchedulesBtn').classList.remove('active');
  $('#tabFinancesBtn').classList.remove('active');
  $('#tabAnnouncementsBtn').classList.remove('active');
  $('#schedulesTab').hidden = true;
  $('#financesTab').hidden = true;
  $('#applicationsTab').hidden = false;
  $('#announcementsTab').hidden = true;
  renderApplications();
});

$('#tabAnnouncementsBtn')?.addEventListener('click', () => {
  $('#tabAnnouncementsBtn').classList.add('active');
  $('#tabApplicationsBtn').classList.remove('active');
  $('#tabSchedulesBtn').classList.remove('active');
  $('#tabFinancesBtn').classList.remove('active');
  $('#applicationsTab').hidden = true;
  $('#schedulesTab').hidden = true;
  $('#financesTab').hidden = true;
  $('#announcementsTab').hidden = false;
  renderAnnouncementAdminList();
});

// ==========================================================
// Moving Feedback Carousel
// ==========================================================
function groupFeedbackByStudent(track) {
  const groupedCards = new Map();
  const feedbackCards = [...track.querySelectorAll('.feedback-card')];

  feedbackCards.forEach(card => {
    const name = card.querySelector('.student-name')?.textContent.trim().toLocaleLowerCase();
    if (!name) return;
    const existing = groupedCards.get(name);
    const entry = document.createElement('div');
    entry.className = 'feedback-entry';
    card.querySelectorAll('.feedback-lead, .feedback-body, .feedback-tags, .feedback-panelist').forEach(content => entry.append(content));

    if (!existing) {
      entry.dataset.feedbackIndex = '0';
      card.append(entry);
      groupedCards.set(name, card);
      return;
    }

    const entries = existing.querySelectorAll('.feedback-entry');
    entry.dataset.feedbackIndex = String(entries.length);
    entry.hidden = true;
    existing.append(entry);
    card.remove();

    let navigation = existing.querySelector('.feedback-entry-controls');
    if (!navigation) {
      navigation = document.createElement('div');
      navigation.className = 'feedback-entry-controls';
      navigation.innerHTML = '<button type="button" aria-label="Previous feedback" title="Previous feedback">←</button><span></span><button type="button" aria-label="Next feedback" title="Next feedback">→</button>';
      existing.append(navigation);
      const buttons = navigation.querySelectorAll('button');
      buttons[0].addEventListener('click', () => showFeedbackEntry(existing, -1));
      buttons[1].addEventListener('click', () => showFeedbackEntry(existing, 1));
    }
    navigation.hidden = false;
    updateFeedbackEntryControls(existing);
  });
}

function updateFeedbackEntryControls(card) {
  const entries = [...card.querySelectorAll('.feedback-entry')];
  const navigation = card.querySelector('.feedback-entry-controls');
  if (!navigation) return;
  const activeIndex = entries.findIndex(entry => !entry.hidden);
  navigation.querySelector('span').textContent = `${activeIndex + 1} / ${entries.length}`;
  navigation.querySelectorAll('button')[0].disabled = activeIndex <= 0;
  navigation.querySelectorAll('button')[1].disabled = activeIndex >= entries.length - 1;
}

function showFeedbackEntry(card, offset) {
  const entries = [...card.querySelectorAll('.feedback-entry')];
  const currentIndex = entries.findIndex(entry => !entry.hidden);
  const nextIndex = Math.max(0, Math.min(entries.length - 1, currentIndex + offset));
  entries.forEach((entry, index) => { entry.hidden = index !== nextIndex; });
  card.classList.remove('is-expanded');
  card.querySelectorAll('.feedback-read-more').forEach(button => button.remove());
  const body = entries[nextIndex]?.querySelector('.feedback-body');
  if (body && body.scrollHeight > body.clientHeight + 1) {
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
  }
  updateFeedbackEntryControls(card);
}

function initFeedbackCarousel() {
  const track = document.getElementById('feedbackTrack');
  if (!track) return;

  groupFeedbackByStudent(track);

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

const MAX_DOTS = 5;

function renderDots() {
  if (!dotsContainer) return;

  const activeIndex = Math.min(
    cards.length - 1,
    Math.max(0, Math.round(track.scrollLeft / getStepWidth()))
  );

  let start = Math.max(0, activeIndex - Math.floor(MAX_DOTS / 2));

  if (start + MAX_DOTS > cards.length) {
    start = Math.max(0, cards.length - MAX_DOTS);
  }

  const end = Math.min(cards.length, start + MAX_DOTS);

  dotsContainer.innerHTML = Array.from(
    { length: end - start },
    (_, i) => {
      const index = start + i;

      return `
        <button
          aria-label="Go to feedback ${index + 1}"
          data-index="${index}"
          class="${index === activeIndex ? 'active' : ''}"
        ></button>
      `;
    }
  ).join('');
}
function updateActiveDot() {
  if (!dotsContainer) return;

  const step = getStepWidth();
  const activeIndex = Math.min(
    cards.length - 1,
    Math.max(0, Math.round(track.scrollLeft / step))
  );

  const dots = dotsContainer.querySelectorAll('button');

  if (cards.length <= MAX_DOTS) {
    dots.forEach((dot, idx) => {
      dot.classList.toggle('active', idx === activeIndex);
    });
    return;
  }

  // Map all feedbacks into 5 visual positions
  const dotIndex = Math.min(
    MAX_DOTS - 1,
    Math.floor((activeIndex / cards.length) * MAX_DOTS)
  );

  dots.forEach((dot, idx) => {
    dot.classList.toggle('active', idx === dotIndex);
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

  track.scrollTo({
    left: idx * step,
    behavior: 'smooth'
  });

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

if (isAdminRoute) open('adminModal');
restoreAdminSession();
loadAnnouncements();
loadSiteNotices();
loadApplicationAvailability();
if ($('#applicationForm')) window.setInterval(loadApplicationAvailability, 30000);
loadCompletedInterviewCount();

$('#faqToggle')?.addEventListener('click', event => {
  const button = event.currentTarget;
  const expanded = button.getAttribute('aria-expanded') === 'true';
  document.querySelectorAll('[data-faq-extra]').forEach(item => { item.hidden = expanded; });
  button.setAttribute('aria-expanded', String(!expanded));
  button.textContent = expanded ? 'Show all FAQs' : 'Show fewer FAQs';
});

$('#adminGlobalSearchInput')?.addEventListener('input', event => {
  renderAdminGlobalSearch(event.currentTarget.value);
});

function refreshAdminGlobalSearchScope() {
  const input = $('#adminGlobalSearchInput');
  if (input) renderAdminGlobalSearch(input.value);
}

$('.workspace-tabs')?.addEventListener('click', event => {
  if (event.target.closest('.tab-btn')) refreshAdminGlobalSearchScope();
});

$('#adminGlobalSearchResults')?.addEventListener('click', event => {
  const button = event.target.closest('[data-admin-search-tab]');
  if (!button) return;
  const targetTab = document.getElementById(button.dataset.adminSearchTab);
  targetTab?.click();
  const sectionIds = {
    tabApplicationsBtn: 'applicationsTab',
    tabSchedulesBtn: 'schedulesTab',
    tabFinancesBtn: 'financesTab',
    tabAnnouncementsBtn: 'announcementsTab'
  };
  document.getElementById(sectionIds[button.dataset.adminSearchTab])?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
