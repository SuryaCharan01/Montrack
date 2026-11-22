/* ==========================================================================
   Montrack — Offline Personal Expense Tracker with Smart Memory
   ========================================================================== */

const DB_NAME = 'MontrackDB';
const DB_VERSION = 1;
let db = null;

const DEFAULT_CATEGORIES = [
  { name: 'Food', icon: '🍔', isDefault: true },
  { name: 'Transport', icon: '🚌', isDefault: true },
  { name: 'Education', icon: '📚', isDefault: true },
  { name: 'Medical', icon: '💊', isDefault: true },
  { name: 'Shopping', icon: '🛍️', isDefault: true },
  { name: 'Entertainment', icon: '🎬', isDefault: true },
  { name: 'Bills & Utilities', icon: '⚡', isDefault: true },
  { name: 'Groceries', icon: '🥦', isDefault: true },
  { name: 'Other', icon: '📦', isDefault: true }
];

const CHART_COLORS = [
  '#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#64748b'
];

let state = {
  expenses: [],
  categories: [],
  reportPeriod: 'week'
};

/* ==========================================================================
   1. INDEXEDDB STORAGE LAYER (100% Local & Offline)
   ========================================================================== */
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains('expenses')) {
        const expStore = database.createObjectStore('expenses', { keyPath: 'id' });
        expStore.createIndex('date', 'date', { unique: false });
        expStore.createIndex('category', 'category', { unique: false });
      }
      if (!database.objectStoreNames.contains('categories')) {
        database.createObjectStore('categories', { keyPath: 'name' });
      }
    };

    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function dbPut(storeName, item) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function dbClear(storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* ==========================================================================
   2. SMART MEMORY & AUTOCOMPLETE ENGINE
   Learns frequency, recency, and associations (Place -> Category/Desc/Amount)
   ========================================================================== */
class SmartMemoryEngine {
  static scoreItem(count, lastTimestamp) {
    const daysAgo = Math.max(0, (Date.now() - lastTimestamp) / (1000 * 60 * 60 * 24));
    const recencyWeight = 1 / (1 + daysAgo * 0.15);
    return count * 0.65 + recencyWeight * 5;
  }

  static getPlaceSuggestions(query = '') {
    const map = new Map();
    const q = query.trim().toLowerCase();

    state.expenses.forEach(exp => {
      if (!exp.place) return;
      if (q && !exp.place.toLowerCase().includes(q)) return;
      const key = exp.place.trim();
      const prev = map.get(key) || { value: key, count: 0, last: 0 };
      prev.count += 1;
      prev.last = Math.max(prev.last, exp.createdAt || new Date(exp.date).getTime());
      map.set(key, prev);
    });

    return Array.from(map.values())
      .sort((a, b) => this.scoreItem(b.count, b.last) - this.scoreItem(a.count, a.last))
      .slice(0, 5)
      .map(i => i.value);
  }

  static getAssociationsForPlace(place) {
    if (!place) return { categories: [], descriptions: [], amounts: [] };
    const pLower = place.trim().toLowerCase();
    const matches = state.expenses.filter(e => e.place && e.place.trim().toLowerCase() === pLower);

    const catMap = new Map();
    const descMap = new Map();
    const amtMap = new Map();

    matches.forEach(m => {
      const ts = m.createdAt || new Date(m.date).getTime();
      if (m.category) {
        const c = catMap.get(m.category) || { val: m.category, count: 0, last: 0 };
        c.count++; c.last = Math.max(c.last, ts);
        catMap.set(m.category, c);
      }
      if (m.description) {
        const d = descMap.get(m.description) || { val: m.description, count: 0, last: 0 };
        d.count++; d.last = Math.max(d.last, ts);
        descMap.set(m.description, d);
      }
      if (m.amount) {
        const a = amtMap.get(m.amount) || { val: m.amount, count: 0, last: 0 };
        a.count++; a.last = Math.max(a.last, ts);
        amtMap.set(m.amount, a);
      }
    });

    const rank = (m) => Array.from(m.values())
      .sort((a, b) => this.scoreItem(b.count, b.last) - this.scoreItem(a.count, a.last))
      .slice(0, 4)
      .map(i => i.val);

    return {
      categories: rank(catMap),
      descriptions: rank(descMap),
      amounts: rank(amtMap)
    };
  }

  static getDescriptionSuggestions(query = '', place = '') {
    const q = query.trim().toLowerCase();
    const pLower = place.trim().toLowerCase();
    const map = new Map();

    state.expenses.forEach(exp => {
      if (!exp.description) return;
      if (q && !exp.description.toLowerCase().includes(q)) return;
      const bonus = (pLower && exp.place?.toLowerCase() === pLower) ? 3 : 1;
      const prev = map.get(exp.description) || { val: exp.description, count: 0, last: 0 };
      prev.count += bonus;
      prev.last = Math.max(prev.last, exp.createdAt || 0);
      map.set(exp.description, prev);
    });

    return Array.from(map.values())
      .sort((a, b) => this.scoreItem(b.count, b.last) - this.scoreItem(a.count, a.last))
      .slice(0, 4)
      .map(i => i.val);
  }

  static getTopCombos(limit = 6) {
    const comboMap = new Map();
    state.expenses.forEach(exp => {
      const key = `${exp.place}|${exp.category}|${exp.amount}|${exp.description || ''}`;
      const ts = exp.createdAt || new Date(exp.date).getTime();
      const prev = comboMap.get(key) || {
        place: exp.place,
        category: exp.category,
        amount: exp.amount,
        description: exp.description || '',
        paymentMethod: exp.paymentMethod || 'UPI',
        count: 0,
        last: 0
      };
      prev.count += 1;
      prev.last = Math.max(prev.last, ts);
      comboMap.set(key, prev);
    });

    return Array.from(comboMap.values())
      .filter(c => c.count >= 1)
      .sort((a, b) => this.scoreItem(b.count, b.last) - this.scoreItem(a.count, a.last))
      .slice(0, limit);
  }
}

/* ==========================================================================
   3. INITIALIZATION & DATA LOADING
   ========================================================================== */
async function bootstrap() {
  initTheme();
  registerSW();
  await initDB();

  let cats = await dbGetAll('categories');
  if (cats.length === 0) {
    for (const c of DEFAULT_CATEGORIES) {
      await dbPut('categories', c);
    }
    cats = DEFAULT_CATEGORIES;
  }
  state.categories = cats;

  await refreshData();
  bindEvents();
}

async function refreshData() {
  const expenses = await dbGetAll('expenses');
  state.expenses = expenses.sort((a, b) => {
    if (b.date !== a.date) return b.date.localeCompare(a.date);
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  populateCategoryDropdowns();
  renderDashboard();
  renderHistory();
  renderAnalytics();
  renderCustomCategories();
}

/* ==========================================================================
   4. TIMEZONE-SAFE DATE & CURRENCY HELPERS
   ========================================================================== */
function formatINR(num) {
  return '₹' + Number(num || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function toLocalISO(d = new Date()) {
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().split('T')[0];
}

function getTodayISO() {
  return toLocalISO(new Date());
}

function getStartOfWeekISO() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  return toLocalISO(new Date(d.getFullYear(), d.getMonth(), diff));
}

/* ==========================================================================
   5. DASHBOARD & SMART COMBOS
   ========================================================================== */
function renderDashboard() {
  const todayStr = getTodayISO();
  const weekStartStr = getStartOfWeekISO();
  const monthPrefix = todayStr.slice(0, 7);

  let todaySum = 0, todayCount = 0;
  let weekSum = 0;
  let monthSum = 0, monthCount = 0;
  const catTotals = {};

  state.expenses.forEach(e => {
    const amt = Number(e.amount);
    if (e.date === todayStr) {
      todaySum += amt;
      todayCount++;
    }
    if (e.date >= weekStartStr && e.date <= todayStr) {
      weekSum += amt;
    }
    if (e.date.startsWith(monthPrefix)) {
      monthSum += amt;
      monthCount++;
      catTotals[e.category] = (catTotals[e.category] || 0) + amt;
    }
  });

  const dayOfMonth = new Date().getDate();
  const avgDaily = monthSum / Math.max(1, dayOfMonth);

  let topCat = '—', topCatAmt = 0;
  Object.entries(catTotals).forEach(([cat, val]) => {
    if (val > topCatAmt) {
      topCat = cat;
      topCatAmt = val;
    }
  });

  document.getElementById('stat-today').textContent = formatINR(todaySum);
  document.getElementById('stat-today-count').textContent = `${todayCount} txn${todayCount === 1 ? '' : 's'}`;
  document.getElementById('stat-week').textContent = formatINR(weekSum);
  document.getElementById('stat-avg-daily').textContent = `Avg ${formatINR(avgDaily)}/day`;
  document.getElementById('stat-month').textContent = formatINR(monthSum);
  document.getElementById('stat-month-count').textContent = `${monthCount} txn${monthCount === 1 ? '' : 's'}`;
  document.getElementById('stat-top-cat').textContent = topCat;
  document.getElementById('stat-top-cat-amt').textContent = formatINR(topCatAmt);

  // Smart Combos
  const combos = SmartMemoryEngine.getTopCombos(6);
  const comboSec = document.getElementById('smart-combos-section');
  const comboList = document.getElementById('smart-combos-list');

  if (combos.length > 0) {
    comboSec.style.display = 'block';
    comboList.innerHTML = combos.map((c, idx) => `
      <button class="combo-chip" data-combo-idx="${idx}">
        <span class="combo-top">${getCatIcon(c.category)} ${formatINR(c.amount)} • ${escapeHTML(c.place)}</span>
        <span class="combo-sub">${escapeHTML(c.description || c.category)}</span>
      </button>
    `).join('');

    comboList.querySelectorAll('.combo-chip').forEach(btn => {
      btn.addEventListener('click', async () => {
        const c = combos[btn.dataset.comboIdx];
        await saveExpenseObject({
          id: crypto.randomUUID(),
          amount: Number(c.amount),
          category: c.category,
          place: c.place,
          description: c.description,
          date: getTodayISO(),
          paymentMethod: c.paymentMethod,
          createdAt: Date.now()
        });
        showToast(`Logged ${formatINR(c.amount)} at ${c.place}`);
      });
    });
  } else {
    comboSec.style.display = 'none';
  }

  // Recent 5 transactions
  const recentEl = document.getElementById('recent-list');
  const recentItems = state.expenses.slice(0, 5);
  recentEl.innerHTML = recentItems.length
    ? recentItems.map(renderTxnHTML).join('')
    : `<p class="hint-text" style="text-align:center;padding:24px 0;">No expenses yet. Tap + to add your first one!</p>`;
}

function getCatIcon(catName) {
  const found = state.categories.find(c => c.name === catName);
  return found ? found.icon : '💸';
}

function renderTxnHTML(txn) {
  return `
    <div class="txn-item">
      <div class="txn-icon">${getCatIcon(txn.category)}</div>
      <div class="txn-details">
        <div class="txn-title">${escapeHTML(txn.place)} ${txn.description ? `• <span style="font-weight:400">${escapeHTML(txn.description)}</span>` : ''}</div>
        <div class="txn-meta">${escapeHTML(txn.category)} • ${txn.date} • ${escapeHTML(txn.paymentMethod || 'UPI')}</div>
      </div>
      <div class="txn-right">
        <div class="txn-amount">${formatINR(txn.amount)}</div>
        <div class="txn-actions">
          <button class="mini-btn" onclick="editExpense('${txn.id}')">Edit</button>
          <button class="mini-btn del" onclick="deleteExpense('${txn.id}')">Del</button>
        </div>
      </div>
    </div>
  `;
}

/* ==========================================================================
   6. EXPENSE ENTRY & SMART AUTOCOMPLETE UI
   ========================================================================== */
function openEntryModal(expense = null) {
  const modal = document.getElementById('entry-modal');
  const form = document.getElementById('expense-form');
  form.reset();

  clearSuggestions();

  if (expense) {
    document.getElementById('modal-title').textContent = 'Edit Expense';
    document.getElementById('entry-id').value = expense.id;
    document.getElementById('entry-amount').value = expense.amount;
    document.getElementById('entry-place').value = expense.place;
    document.getElementById('entry-category').value = expense.category;
    document.getElementById('entry-desc').value = expense.description || '';
    document.getElementById('entry-date').value = expense.date;
    document.getElementById('entry-payment').value = expense.paymentMethod || 'UPI';
  } else {
    document.getElementById('modal-title').textContent = 'Add Expense';
    document.getElementById('entry-id').value = '';
    document.getElementById('entry-date').value = getTodayISO();
    renderPlaceSuggestions('');
  }

  modal.classList.add('open');
  if (!expense) setTimeout(() => document.getElementById('entry-amount').focus(), 100);
}

function closeEntryModal() {
  document.getElementById('entry-modal').classList.remove('open');
}

function clearSuggestions() {
  ['suggest-amounts', 'suggest-places', 'suggest-categories', 'suggest-descs'].forEach(id => {
    document.getElementById(id).innerHTML = '';
  });
}

function renderPlaceSuggestions(query) {
  const places = SmartMemoryEngine.getPlaceSuggestions(query);
  const container = document.getElementById('suggest-places');
  container.innerHTML = places.map(p => `<button type="button" class="sug-pill">${escapeHTML(p)}</button>`).join('');
  container.querySelectorAll('.sug-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('entry-place').value = btn.textContent;
      applyPlaceAssociations(btn.textContent);
    });
  });
}

function applyPlaceAssociations(place) {
  const assoc = SmartMemoryEngine.getAssociationsForPlace(place);

  if (assoc.categories.length > 0) {
    document.getElementById('entry-category').value = assoc.categories[0];
    const catBox = document.getElementById('suggest-categories');
    catBox.innerHTML = assoc.categories.map(c => `<button type="button" class="sug-pill">${getCatIcon(c)} ${escapeHTML(c)}</button>`).join('');
    catBox.querySelectorAll('.sug-pill').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        document.getElementById('entry-category').value = assoc.categories[i];
      });
    });
  }

  const descBox = document.getElementById('suggest-descs');
  descBox.innerHTML = assoc.descriptions.map(d => `<button type="button" class="sug-pill">${escapeHTML(d)}</button>`).join('');
  descBox.querySelectorAll('.sug-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('entry-desc').value = btn.textContent;
    });
  });

  const amtBox = document.getElementById('suggest-amounts');
  amtBox.innerHTML = assoc.amounts.map(a => `<button type="button" class="sug-pill">₹${a}</button>`).join('');
  amtBox.querySelectorAll('.sug-pill').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      document.getElementById('entry-amount').value = assoc.amounts[i];
    });
  });
}

async function saveExpenseObject(obj) {
  await dbPut('expenses', obj);
  await refreshData();
}

window.editExpense = function(id) {
  const exp = state.expenses.find(e => e.id === id);
  if (exp) openEntryModal(exp);
};

window.deleteExpense = async function(id) {
  if (!confirm('Delete this expense?')) return;
  await dbDelete('expenses', id);
  await refreshData();
  showToast('Expense deleted');
};

/* ==========================================================================
   7. HISTORY & FILTERING
   ========================================================================== */
function renderHistory() {
  const q = document.getElementById('filter-search').value.trim().toLowerCase();
  const cat = document.getElementById('filter-category').value;
  const from = document.getElementById('filter-date-from').value;
  const to = document.getElementById('filter-date-to').value;

  const filtered = state.expenses.filter(e => {
    if (cat && e.category !== cat) return false;
    if (from && e.date < from) return false;
    if (to && e.date > to) return false;
    if (q) {
      const hay = `${e.place} ${e.description || ''} ${e.category} ${e.paymentMethod || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const total = filtered.reduce((sum, e) => sum + Number(e.amount), 0);
  document.getElementById('filter-summary').textContent = `${filtered.length} txn${filtered.length === 1 ? '' : 's'} • Total ${formatINR(total)}`;

  const listEl = document.getElementById('history-list');
  listEl.innerHTML = filtered.length
    ? filtered.map(renderTxnHTML).join('')
    : `<p class="hint-text" style="text-align:center;padding:24px 0;">No matching transactions found.</p>`;
}

/* ==========================================================================
   8. ANALYTICS & AUTOMATED WEEKLY/MONTHLY REPORTS
   ========================================================================== */
function renderAnalytics() {
  renderAutomatedReport();
  drawCategoryPieChart();
  drawDailyBarChart();
  drawMonthlyLineChart();
  drawLocationBarChart();
}

function renderAutomatedReport() {
  const period = state.reportPeriod;
  const now = new Date();
  const todayISO = getTodayISO();

  let currStart, prevStart, prevEnd;

  if (period === 'week') {
    currStart = getStartOfWeekISO();
    const [y, m, d] = currStart.split('-').map(Number);
    prevStart = toLocalISO(new Date(y, m - 1, d - 7));
    prevEnd = toLocalISO(new Date(y, m - 1, d - 1));
  } else {
    currStart = todayISO.slice(0, 7) + '-01';
    prevStart = toLocalISO(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    prevEnd = toLocalISO(new Date(now.getFullYear(), now.getMonth(), 0));
  }

  const currTxns = state.expenses.filter(e => e.date >= currStart && e.date <= todayISO);
  const prevTxns = state.expenses.filter(e => e.date >= prevStart && e.date <= prevEnd);

  const currTotal = currTxns.reduce((s, e) => s + Number(e.amount), 0);
  const prevTotal = prevTxns.reduce((s, e) => s + Number(e.amount), 0);

  const catMap = {}, dayMap = {}, placeCount = {};
