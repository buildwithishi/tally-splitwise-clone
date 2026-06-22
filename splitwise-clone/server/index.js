/**
 * Splitwise Clone — single-file Node.js backend
 * Zero external dependencies. Stores data in data/db.json.
 * Serves the frontend from /public and exposes a small REST API.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// ---------- Storage ----------

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ people: [], expenses: [] }, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function id() {
  return crypto.randomBytes(8).toString('hex');
}

// ---------- Balance calculation ----------
// Each expense: { id, description, amount, paidBy: personId, splitAmong: [personId...], date }
// Split is always even among splitAmong for simplicity & clarity.

function computeBalances(db) {
  const balances = {}; // personId -> net balance (positive = is owed money, negative = owes money)
  db.people.forEach((p) => (balances[p.id] = 0));

  db.expenses.forEach((exp) => {
    const share = exp.amount / exp.splitAmong.length;
    balances[exp.paidBy] = (balances[exp.paidBy] || 0) + exp.amount;
    exp.splitAmong.forEach((personId) => {
      balances[personId] = (balances[personId] || 0) - share;
    });
  });

  // Round to 2 decimals to avoid floating point dust
  Object.keys(balances).forEach((k) => {
    balances[k] = Math.round(balances[k] * 100) / 100;
  });

  return balances;
}

// Simplify balances into a minimal list of "who pays whom"
function simplifyDebts(balances, people) {
  const nameOf = {};
  people.forEach((p) => (nameOf[p.id] = p.name));

  const creditors = [];
  const debtors = [];

  Object.entries(balances).forEach(([personId, amt]) => {
    if (amt > 0.005) creditors.push({ personId, amt });
    else if (amt < -0.005) debtors.push({ personId, amt: -amt });
  });

  creditors.sort((a, b) => b.amt - a.amt);
  debtors.sort((a, b) => b.amt - a.amt);

  const settlements = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const amount = Math.min(debtor.amt, creditor.amt);

    if (amount > 0.005) {
      settlements.push({
        from: debtor.personId,
        fromName: nameOf[debtor.personId],
        to: creditor.personId,
        toName: nameOf[creditor.personId],
        amount: Math.round(amount * 100) / 100,
      });
    }

    debtor.amt -= amount;
    creditor.amt -= amount;

    if (debtor.amt < 0.005) i++;
    if (creditor.amt < 0.005) j++;
  }

  return settlements;
}

// ---------- HTTP helpers ----------

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = '';
    req.on('data', (chunk) => {
      chunks += chunk;
      if (chunks.length > 1e6) req.destroy(); // 1MB safety cap
    });
    req.on('end', () => {
      if (!chunks) return resolve({});
      try {
        resolve(JSON.parse(chunks));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(PUBLIC_DIR, filePath);

  // Prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// ---------- Validation helpers ----------

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// ---------- API router ----------

async function handleApi(req, res, pathname, query) {
  const db = readDb();

  // GET /api/people
  if (pathname === '/api/people' && req.method === 'GET') {
    return sendJson(res, 200, db.people);
  }

  // POST /api/people { name }
  if (pathname === '/api/people' && req.method === 'POST') {
    const body = await readBody(req);
    if (!isNonEmptyString(body.name)) {
      return sendJson(res, 400, { error: 'name is required' });
    }
    const name = body.name.trim();
    if (db.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      return sendJson(res, 409, { error: 'A person with that name already exists' });
    }
    const person = { id: id(), name };
    db.people.push(person);
    writeDb(db);
    return sendJson(res, 201, person);
  }

  // DELETE /api/people/:id
  const personMatch = pathname.match(/^\/api\/people\/([a-f0-9]+)$/);
  if (personMatch && req.method === 'DELETE') {
    const pid = personMatch[1];
    const usedInExpense = db.expenses.some(
      (e) => e.paidBy === pid || e.splitAmong.includes(pid)
    );
    if (usedInExpense) {
      return sendJson(res, 409, {
        error: 'Cannot remove a person who is part of existing expenses. Delete those expenses first.',
      });
    }
    db.people = db.people.filter((p) => p.id !== pid);
    writeDb(db);
    return sendJson(res, 200, { ok: true });
  }

  // GET /api/expenses
  if (pathname === '/api/expenses' && req.method === 'GET') {
    const sorted = [...db.expenses].sort((a, b) => new Date(b.date) - new Date(a.date));
    return sendJson(res, 200, sorted);
  }

  // POST /api/expenses { description, amount, paidBy, splitAmong: [ids] }
  if (pathname === '/api/expenses' && req.method === 'POST') {
    const body = await readBody(req);
    const { description, amount, paidBy, splitAmong } = body;

    if (!isNonEmptyString(description)) {
      return sendJson(res, 400, { error: 'description is required' });
    }
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      return sendJson(res, 400, { error: 'amount must be a positive number' });
    }
    if (!isNonEmptyString(paidBy) || !db.people.some((p) => p.id === paidBy)) {
      return sendJson(res, 400, { error: 'paidBy must reference an existing person' });
    }
    if (!Array.isArray(splitAmong) || splitAmong.length === 0) {
      return sendJson(res, 400, { error: 'splitAmong must be a non-empty array of person ids' });
    }
    const validIds = new Set(db.people.map((p) => p.id));
    if (!splitAmong.every((pid) => validIds.has(pid))) {
      return sendJson(res, 400, { error: 'splitAmong contains an unknown person id' });
    }

    const expense = {
      id: id(),
      description: description.trim(),
      amount: Math.round(numAmount * 100) / 100,
      paidBy,
      splitAmong,
      date: new Date().toISOString(),
    };
    db.expenses.push(expense);
    writeDb(db);
    return sendJson(res, 201, expense);
  }

  // DELETE /api/expenses/:id
  const expenseMatch = pathname.match(/^\/api\/expenses\/([a-f0-9]+)$/);
  if (expenseMatch && req.method === 'DELETE') {
    const eid = expenseMatch[1];
    const before = db.expenses.length;
    db.expenses = db.expenses.filter((e) => e.id !== eid);
    if (db.expenses.length === before) {
      return sendJson(res, 404, { error: 'Expense not found' });
    }
    writeDb(db);
    return sendJson(res, 200, { ok: true });
  }

  // GET /api/balances
  if (pathname === '/api/balances' && req.method === 'GET') {
    const balances = computeBalances(db);
    const result = db.people.map((p) => ({
      id: p.id,
      name: p.name,
      balance: balances[p.id] || 0,
    }));
    return sendJson(res, 200, result);
  }

  // GET /api/settlements
  if (pathname === '/api/settlements' && req.method === 'GET') {
    const balances = computeBalances(db);
    const settlements = simplifyDebts(balances, db.people);
    return sendJson(res, 200, settlements);
  }

  return sendJson(res, 404, { error: 'Unknown API route' });
}

// ---------- Server ----------

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname);

  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, parsed.query);
    } else {
      serveStatic(req, res, pathname);
    }
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message || 'Internal server error' });
  }
});

ensureDb();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Splitwise Clone running!`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://<your-machine-ip>:${PORT}\n`);
  console.log(`  Data stored in: ${DB_FILE}\n`);
});
