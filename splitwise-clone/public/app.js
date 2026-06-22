/* ============================================================
   Tally — frontend logic (vanilla JS, no framework, no build)
   ============================================================ */

const state = {
  people: [],
  expenses: [],
  selectedSplit: new Set(),
};

// ---------- API helpers ----------

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 2400);
}

function formatMoney(n) {
  const sign = n < 0 ? '-' : '';
  return `${sign}₹${Math.abs(n).toFixed(2)}`;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function personName(id) {
  const p = state.people.find((p) => p.id === id);
  return p ? p.name : '(removed)';
}

// ---------- Tabs ----------

document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`view-${btn.dataset.tab}`).classList.add('active');
  if (btn.dataset.tab === 'settle') refreshBalancesAndSettlements();
});

// ---------- Rendering ----------

function renderPeopleDependentUI() {
  // "Paid by" select
  const select = document.getElementById('exp-paidby');
  const prevValue = select.value;
  select.innerHTML = state.people
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
    .join('');
  if (state.people.some((p) => p.id === prevValue)) select.value = prevValue;

  // Split among chips
  const splitContainer = document.getElementById('split-among');
  if (state.people.length === 0) {
    splitContainer.innerHTML = '<p class="empty-state">Add people first, on the People tab.</p>';
  } else {
    splitContainer.innerHTML = state.people
      .map(
        (p) =>
          `<button type="button" class="chip ${state.selectedSplit.has(p.id) ? 'selected' : ''}" data-id="${p.id}">${escapeHtml(p.name)}</button>`
      )
      .join('');
  }

  // People list
  const peopleList = document.getElementById('people-list');
  if (state.people.length === 0) {
    peopleList.innerHTML = '<li class="empty-state">No one added yet. Add yourself and your group first.</li>';
  } else {
    peopleList.innerHTML = state.people
      .map(
        (p) => `
        <li>
          <span class="person-name">${escapeHtml(p.name)}</span>
          <button class="person-remove" data-id="${p.id}">remove</button>
        </li>`
      )
      .join('');
  }
}

function renderExpenses() {
  const list = document.getElementById('expense-list');
  if (state.expenses.length === 0) {
    list.innerHTML = '<p class="empty-state">No expenses yet. The first one is always the hardest.</p>';
    return;
  }
  list.innerHTML = state.expenses
    .map((exp) => {
      const splitNames = exp.splitAmong.map(personName).join(', ');
      return `
      <div class="receipt-item">
        <div class="receipt-main">
          <div class="receipt-desc">${escapeHtml(exp.description)}</div>
          <div class="receipt-meta">${escapeHtml(personName(exp.paidBy))} paid · split with ${escapeHtml(splitNames)} · ${formatDate(exp.date)}</div>
        </div>
        <div class="receipt-row-bottom">
          <div class="receipt-amount">${formatMoney(exp.amount)}</div>
          <button class="receipt-delete" data-id="${exp.id}" title="Delete expense">✕</button>
        </div>
      </div>`;
    })
    .join('');
}

function renderBalances(balances) {
  const list = document.getElementById('balance-list');
  if (balances.length === 0) {
    list.innerHTML = '<p class="empty-state">Add some people and expenses to see balances.</p>';
    return;
  }
  list.innerHTML = balances
    .map((b) => {
      let cls = 'even';
      let tag = 'settled up';
      if (b.balance > 0.005) { cls = 'is-owed'; tag = 'is owed'; }
      else if (b.balance < -0.005) { cls = 'owes'; tag = 'owes'; }
      return `
      <div class="balance-row ${cls}">
        <div>
          <div class="balance-name">${escapeHtml(b.name)}</div>
          <span class="balance-tag">${tag}</span>
        </div>
        <div class="balance-amount">${formatMoney(Math.abs(b.balance))}</div>
      </div>`;
    })
    .join('');
}

function renderSettlements(settlements) {
  const list = document.getElementById('settlement-list');
  if (settlements.length === 0) {
    list.innerHTML = '<p class="empty-state">Everyone is settled up. Nice.</p>';
    return;
  }
  list.innerHTML = settlements
    .map(
      (s) => `
      <div class="settlement-row">
        <span>${escapeHtml(s.fromName)}</span>
        <span class="settlement-arrow">→</span>
        <span>${escapeHtml(s.toName)}</span>
        <span class="settlement-amount">${formatMoney(s.amount)}</span>
      </div>`
    )
    .join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Data loading ----------

async function loadPeople() {
  state.people = await api('/people');
  renderPeopleDependentUI();
}

async function loadExpenses() {
  state.expenses = await api('/expenses');
  renderExpenses();
}

async function refreshBalancesAndSettlements() {
  const [balances, settlements] = await Promise.all([
    api('/balances'),
    api('/settlements'),
  ]);
  renderBalances(balances);
  renderSettlements(settlements);
}

async function refreshAll() {
  await loadPeople();
  await loadExpenses();
}

// ---------- Event handlers ----------

document.getElementById('split-among').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const id = chip.dataset.id;
  if (state.selectedSplit.has(id)) {
    state.selectedSplit.delete(id);
    chip.classList.remove('selected');
  } else {
    state.selectedSplit.add(id);
    chip.classList.add('selected');
  }
});

document.getElementById('person-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('person-name');
  const errorEl = document.getElementById('person-error');
  errorEl.textContent = '';
  try {
    await api('/people', { method: 'POST', body: JSON.stringify({ name: input.value.trim() }) });
    input.value = '';
    await loadPeople();
    showToast('Person added');
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

document.getElementById('people-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('.person-remove');
  if (!btn) return;
  try {
    await api(`/people/${btn.dataset.id}`, { method: 'DELETE' });
    state.selectedSplit.delete(btn.dataset.id);
    await loadPeople();
    showToast('Person removed');
  } catch (err) {
    showToast(err.message, true);
  }
});

document.getElementById('expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('expense-error');
  errorEl.textContent = '';

  const description = document.getElementById('exp-description').value.trim();
  const amount = document.getElementById('exp-amount').value;
  const paidBy = document.getElementById('exp-paidby').value;
  const splitAmong = Array.from(state.selectedSplit);

  if (splitAmong.length === 0) {
    errorEl.textContent = 'Select at least one person to split with.';
    return;
  }

  try {
    await api('/expenses', {
      method: 'POST',
      body: JSON.stringify({ description, amount, paidBy, splitAmong }),
    });
    document.getElementById('expense-form').reset();
    state.selectedSplit.clear();
    renderPeopleDependentUI();
    await loadExpenses();
    showToast('Expense added');
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

document.getElementById('expense-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('.receipt-delete');
  if (!btn) return;
  try {
    await api(`/expenses/${btn.dataset.id}`, { method: 'DELETE' });
    await loadExpenses();
    showToast('Expense deleted');
  } catch (err) {
    showToast(err.message, true);
  }
});

// ---------- Init ----------

refreshAll().catch((err) => showToast(err.message, true));
