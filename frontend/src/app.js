// API client
const API_BASE = '/api';

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// State
const state = {
  stats: null,
  contribution: null,
  allContributions: {}, // Map of year -> {weeks, year}
  selectedDate: null,
  selectedConversation: null,
  conversations: [],
  availableYears: [],
  selectedYear: null, // null = rolling 12 months
  searchQuery: '',
  searchResults: [],
  isSearching: false,
};

// DOM Elements
let elements = {};

// Initialize app
export async function init() {
  elements = {
    app: document.getElementById('app'),
  };
  render();
  await loadData();
}

// Load data from API
async function loadData() {
  try {
    const stats = await fetchJSON(`${API_BASE}/stats`);
    state.stats = stats;

    // Determine available years from date range
    const startYear = new Date(stats.dateRange.start).getFullYear();
    const endYear = new Date(stats.dateRange.end).getFullYear();
    state.availableYears = [];
    for (let y = startYear; y <= endYear; y++) {
      state.availableYears.push(y);
    }

    // For rolling view, load current year and previous year
    const currentYear = new Date().getFullYear();
    await Promise.all([
      loadContribution(currentYear),
      loadContribution(currentYear - 1)
    ]);

    // Set current year as active for display
    state.contribution = state.allContributions[currentYear];
    render();
  } catch (err) {
    console.error('Failed to load data:', err);
    renderError(err.message);
  }
}

async function loadContribution(year) {
  try {
    const data = await fetchJSON(`${API_BASE}/contribution?year=${year}`);
    state.allContributions[year] = data;
  } catch (err) {
    console.error('Failed to load contribution:', err);
  }
}

async function loadConversations(date) {
  state.selectedDate = date;
  state.conversations = [];
  state.selectedConversation = null;
  render();

  try {
    const result = await fetchJSON(`${API_BASE}/conversations?date=${date}`);
    state.conversations = result.conversations;
    render();
  } catch (err) {
    console.error('Failed to load conversations:', err);
  }
}

async function loadConversation(id) {
  state.selectedConversation = null;
  render();

  try {
    state.selectedConversation = await fetchJSON(`${API_BASE}/conversation/${id}`);
    render();
  } catch (err) {
    console.error('Failed to load conversation:', err);
  }
}

// Render functions
function render() {
  if (!state.stats || !state.contribution) {
    elements.app.innerHTML = '<div class="loading">Loading...</div>';
    return;
  }

  elements.app.innerHTML = `
    <header>
      <h1>ChatGPT Data Viewer</h1>
      <div class="year-selector">
        <button class="${state.selectedYear === null ? 'active' : ''}"
                onclick="window.selectYear(null)">Last 12 months</button>
        ${state.availableYears.map(y => `
          <button class="${state.selectedYear === y ? 'active' : ''}"
                  onclick="window.selectYear(${y})">${y}</button>
        `).join('')}
      </div>
      <a href="https://github.com/alexeygrigorev/chatgpt-data-viewer" target="_blank" class="github-link">
        <i class="fab fa-github"></i>
      </a>
    </header>

    <div class="stats">
      <div class="stat">
        <div class="stat-label">Conversations</div>
        <div class="stat-value">${getVisibleCount().toLocaleString()}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Date Range</div>
        <div class="stat-value" style="font-size: 1rem;">${getVisibleDateRange()}</div>
      </div>
    </div>

    <div class="contribution-section">
      ${renderContributionGrid()}
      ${renderMonthLabels()}
      <div class="contribution-legend">
        <span>Less</span>
        <div class="legend-box" style="background: var(--contrib-0)"></div>
        <div class="legend-box" style="background: var(--contrib-1)"></div>
        <div class="legend-box" style="background: var(--contrib-2)"></div>
        <div class="legend-box" style="background: var(--contrib-3)"></div>
        <div class="legend-box" style="background: var(--contrib-4)"></div>
        <span>More</span>
      </div>
    </div>

    <div class="search-section">
      <div class="search-box">
        <input type="text"
               id="searchInput"
               placeholder="Search conversations..."
               value="${escapeHtml(state.searchQuery)}"
               onkeydown="if(event.key === 'Enter') window.doSearch()"
        />
        <button onclick="window.doSearch()">Search</button>
        ${state.searchQuery ? `<button class="search-clear" onclick="window.clearSearch()">×</button>` : ''}
      </div>
    </div>

    <div id="tooltip" class="tooltip"></div>

    <div class="main-content">
      ${state.searchQuery ? renderSearchResults() : renderConversationList()}
      ${renderConversationDetail()}
    </div>
  `;
}

function getVisibleCount() {
  if (state.selectedYear !== null) {
    return state.allContributions[state.selectedYear]?.total || 0;
  }

  // Count only last 12 months across all years
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setMonth(now.getMonth() - 12);
  twelveMonthsAgo.setHours(0, 0, 0, 0);

  let count = 0;
  const yearsNeeded = [new Date().getFullYear() - 1, new Date().getFullYear()];

  for (const year of yearsNeeded) {
    const contrib = state.allContributions[year];
    if (!contrib) continue;

    for (const day of contrib.days) {
      const date = new Date(day.date + 'T12:00:00');
      if (date >= twelveMonthsAgo && date <= now) {
        count += day.count;
      }
    }
  }
  return count;
}

function getVisibleDateRange() {
  if (state.selectedYear !== null) {
    return `${state.selectedYear}-01 → ${state.selectedYear}-12`;
  }

  // Rolling 12 months
  const now = new Date();
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setMonth(now.getMonth() - 11);
  twelveMonthsAgo.setDate(1);

  const formatMonth = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `${formatMonth(twelveMonthsAgo)} → ${formatMonth(now)}`;
}

function renderMonthLabels() {
  if (state.selectedYear !== null) {
    // Year mode - show standard month labels aligned with week columns
    const contrib = state.allContributions[state.selectedYear];
    if (!contrib) return '';

    // Grid has 7 rows, so column = day_index / 7
    // Calculate which column each month starts in
    const monthColumns = [];
    let dayIndex = 0;
    for (let month = 0; month < 12; month++) {
      monthColumns.push(dayIndex);
      const daysInMonth = new Date(state.selectedYear, month + 1, 0).getDate();
      dayIndex += daysInMonth;
    }

    const labels = [];
    for (let month = 0; month < 12; month++) {
      const column = Math.floor(monthColumns[month] / 7);
      // Each column is 11px + 2px gap = 13px, but grid has 4px padding
      const position = 4 + column * 13;
      labels.push(`<span style="position: absolute; left: ${position}px;">${new Date(state.selectedYear, month, 1).toLocaleString('default', { month: 'short' })}</span>`);
    }

    return `<div class="day-labels" style="position: relative;">${labels.join('')}</div>`;
  }

  // Rolling mode - collect all visible dates and group by month
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setMonth(now.getMonth() - 12);
  twelveMonthsAgo.setHours(0, 0, 0, 0);

  const months = [];
  const yearsNeeded = [new Date().getFullYear() - 1, new Date().getFullYear()];

  // Collect visible days with their day indices
  const visibleDays = [];
  for (const year of yearsNeeded) {
    const contrib = state.allContributions[year];
    if (!contrib) continue;

    for (const day of contrib.days) {
      const date = new Date(day.date + 'T12:00:00');
      if (date >= twelveMonthsAgo && date <= now) {
        visibleDays.push({ date, count: day.count });
      }
    }
  }

  // Sort by date
  visibleDays.sort((a, b) => a.date - b.date);

  // Group by month and track first occurrence
  const monthFirstIndices = {};
  for (let i = 0; i < visibleDays.length; i++) {
    const d = visibleDays[i].date;
    const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
    if (!(monthKey in monthFirstIndices)) {
      monthFirstIndices[monthKey] = i;
    }
  }

  const labels = [];
  for (const [monthKey, dayIndex] of Object.entries(monthFirstIndices)) {
    const [year, month] = monthKey.split('-').map(Number);
    const column = Math.floor(dayIndex / 7);
    const position = 4 + column * 13;
    const date = new Date(year, month, 1);
    labels.push(`<span style="position: absolute; left: ${position}px;">${date.toLocaleString('default', { month: 'short' })}</span>`);
  }

  return `<div class="day-labels" style="position: relative;">${labels.join('')}</div>`;
}

function renderContributionGrid() {
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setMonth(now.getMonth() - 12);
  twelveMonthsAgo.setHours(0, 0, 0, 0);

  const cells = [];

  if (state.selectedYear === null) {
    // Rolling 12 months mode - combine data from multiple years
    const yearsNeeded = [new Date().getFullYear() - 1, new Date().getFullYear()];

    for (const year of yearsNeeded) {
      const contrib = state.allContributions[year];
      if (!contrib) continue;

      for (const day of contrib.days) {
        const date = new Date(day.date + 'T12:00:00');

        // Only include dates in the 12-month window
        if (date < twelveMonthsAgo || date > now) {
          continue;
        }

        const count = day.count;
        let level = 0;
        if (count > 0) level = 1;
        if (count >= 3) level = 2;
        if (count >= 6) level = 3;
        if (count >= 10) level = 4;

        cells.push({ date: day.date, count, level });
      }
    }

    // Sort by date
    cells.sort((a, b) => a.date.localeCompare(b.date));
  } else {
    // Single year mode
    const contrib = state.allContributions[state.selectedYear];
    if (!contrib) return '<div class="loading">Loading...</div>';

    for (const day of contrib.days) {
      const count = day.count;
      let level = 0;
      if (count > 0) level = 1;
      if (count >= 3) level = 2;
      if (count >= 6) level = 3;
      if (count >= 10) level = 4;

      cells.push({ date: day.date, count, level });
    }
  }

  // Auto-scroll to right for rolling mode
  if (state.selectedYear === null) {
    setTimeout(() => {
      const grid = document.getElementById('grid');
      if (grid) grid.scrollLeft = grid.scrollWidth;
    }, 0);
  }

  const cellHtml = cells.map(c =>
    `<div class="day-cell level-${c.level} ${state.selectedDate === c.date ? 'selected' : ''}"
          data-date="${c.date}"
          data-count="${c.count}"></div>`
  ).join('');

  return `<div class="contribution-grid" id="grid">${cellHtml}</div>`;
}

function renderConversationList() {
  const header = `
    <div class="panel-header">
      <span>${state.selectedDate ? `Conversations for ${state.selectedDate}` : 'Select a day'}</span>
      ${state.selectedDate ? `<button class="panel-close" onclick="window.clearDate()">×</button>` : ''}
    </div>
  `;

  if (!state.selectedDate) {
    return `
      <div class="conversation-list-panel">
        ${header}
        <div class="empty-state">Click on a cell in the contribution graph to see conversations</div>
      </div>
    `;
  }

  if (state.conversations.length === 0) {
    return `
      <div class="conversation-list-panel">
        ${header}
        <div class="empty-state">No conversations found for this date</div>
      </div>
    `;
  }

  const items = state.conversations.map(c => `
    <div class="conversation-item ${state.selectedConversation?.id === c.id ? 'active' : ''}"
         onclick="window.selectConversation('${c.id}')">
      <div class="conversation-title">${escapeHtml(c.title)}</div>
      <div class="conversation-meta">
        <span>${c.model || 'unknown'}</span>
        <span>${c.messageCount} messages</span>
      </div>
    </div>
  `).join('');

  return `
    <div class="conversation-list-panel">
      ${header}
      <div class="conversation-list">${items}</div>
    </div>
  `;
}

function renderConversationDetail() {
  if (!state.selectedConversation) {
    return `
      <div class="conversation-detail">
        <div class="empty-state">Select a conversation to view messages</div>
      </div>
    `;
  }

  const c = state.selectedConversation;
  const messages = c.messages
    .filter(m => m.content && m.content.trim() !== '')
    .map(m => `
    <div class="message ${m.role}">
      <div class="message-role">${m.role}${m.name ? ` (${m.name})` : ''}</div>
      <div class="message-content">${escapeHtml(m.content)}</div>
    </div>
  `).join('');

  return `
    <div class="conversation-detail">
      <div class="detail-header">
        <div class="detail-title">${escapeHtml(c.title)}</div>
        <div class="detail-meta">
          ${c.model ? `Model: ${c.model} • ` : ''}
          Created: ${formatDateTime(c.createTime)}
        </div>
        <a class="save-link" onclick="window.downloadConversation()">
          <i class="fas fa-save"></i>
        </a>
      </div>
      <div class="messages">${messages}<div class="messages-spacer"></div></div>
    </div>
  `;
}

function renderSearchResults() {
  const header = `
    <div class="panel-header">
      <span>Search results for "${escapeHtml(state.searchQuery)}"</span>
      <button class="panel-close" onclick="window.clearSearch()">×</button>
    </div>
  `;

  if (state.isSearching) {
    return `
      <div class="conversation-list-panel">
        ${header}
        <div class="empty-state">Searching...</div>
      </div>
    `;
  }

  if (state.searchResults.length === 0) {
    return `
      <div class="conversation-list-panel">
        ${header}
        <div class="empty-state">No results found</div>
      </div>
    `;
  }

  const items = state.searchResults.map(r => `
    <div class="conversation-item ${state.selectedConversation?.id === r.id ? 'active' : ''}"
         onclick="window.selectConversation('${r.id}')">
      <div class="conversation-title">${escapeHtml(r.title)}</div>
      <div class="conversation-meta">
        <span>${r.model || 'unknown'}</span>
        <span>${new Date(r.createTime).toISOString().slice(0, 10)}</span>
      </div>
    </div>
  `).join('');

  return `
    <div class="conversation-list-panel">
      ${header}
      <div class="conversation-list">${items}</div>
    </div>
  `;
}

function renderError(message) {
  elements.app.innerHTML = `
    <div class="empty-state" style="color: #f85149;">
      Error: ${escapeHtml(message)}
    </div>
  `;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDateTime(timestamp) {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

// Global event handlers
window.selectYear = async (year) => {
  state.selectedYear = year;
  state.selectedDate = null;
  state.conversations = [];
  state.selectedConversation = null;
  state.searchQuery = '';
  state.searchResults = [];

  if (year !== null) {
    // Load specific year
    if (!state.allContributions[year]) {
      await loadContribution(year);
    }
    state.contribution = state.allContributions[year];
  } else {
    // Rolling view - use current year for display
    state.contribution = state.allContributions[new Date().getFullYear()];
  }
  render();
};

window.clearDate = () => {
  state.selectedDate = null;
  state.conversations = [];
  state.selectedConversation = null;
  state.searchQuery = '';
  state.searchResults = [];
  render();
};

window.selectConversation = (id) => {
  loadConversation(id);
};

window.doSearch = async () => {
  const input = document.getElementById('searchInput');
  const query = input?.value?.trim() || '';
  if (!query) return;

  state.searchQuery = query;
  state.isSearching = true;
  state.searchResults = [];
  render();

  try {
    const result = await fetchJSON(`${API_BASE}/search?q=${encodeURIComponent(query)}&limit=50`);
    state.searchResults = result.results;
  } catch (err) {
    console.error('Search failed:', err);
  } finally {
    state.isSearching = false;
    render();
  }
};

window.clearSearch = () => {
  state.searchQuery = '';
  state.searchResults = [];
  state.selectedConversation = null;
  render();
};

window.downloadConversation = () => {
  if (!state.selectedConversation) return;

  const c = state.selectedConversation;

  // Build markdown content
  let md = `# ${c.title}\n\n`;
  md += `**Model:** ${c.model || 'unknown'}  \n`;
  md += `**Created:** ${new Date(c.createTime).toISOString()}  \n\n`;
  md += `---\n\n`;

  for (const m of c.messages) {
    if (!m.content || m.content.trim() === '') continue;

    const role = m.name ? `${m.role} (${m.name})` : m.role;
    md += `## ${role}\n\n`;
    md += `${m.content}\n\n`;
  }

  // Create blob and download
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${c.id}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Click handler for contribution grid
document.addEventListener('click', (e) => {
  const cell = e.target.closest('.day-cell');
  if (cell) {
    const date = cell.dataset.date;
    if (date) {
      loadConversations(date);
    }
  }
});

// Tooltip handler
document.addEventListener('mouseover', (e) => {
  const cell = e.target.closest('.day-cell');
  const tooltip = document.getElementById('tooltip');
  if (!tooltip) return;

  if (cell && cell.dataset.date) {
    const date = new Date(cell.dataset.date + 'T12:00:00');
    const count = parseInt(cell.dataset.count) || 0;
    const formattedDate = date.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });

    tooltip.innerHTML = `
      <div class="tooltip-date">${formattedDate}</div>
      <div class="tooltip-count">${count} ${count === 1 ? 'conversation' : 'conversations'}</div>
    `;
    tooltip.classList.add('visible');
  } else {
    tooltip.classList.remove('visible');
  }
}, true);

document.addEventListener('mouseout', (e) => {
  if (e.target.classList.contains('day-cell')) {
    const tooltip = document.getElementById('tooltip');
    if (tooltip) tooltip.classList.remove('visible');
  }
}, true);

document.addEventListener('mousemove', (e) => {
  const tooltip = document.getElementById('tooltip');
  if (tooltip && tooltip.classList.contains('visible')) {
    tooltip.style.left = (e.clientX + 12) + 'px';
    tooltip.style.top = (e.clientY + 12) + 'px';
  }
});
