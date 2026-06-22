# Tally — a tiny Splitwise clone for your local network

Tally is a small self-hosted web app for splitting shared expenses with roommates, trip
groups, or friends. Add the people in your group, log expenses as they happen, and Tally
keeps a running ledger of who owes whom — plus the simplest set of payments to settle
everything up.

It's built to run on one machine on your home/office Wi-Fi, with everyone else on the
same network just opening a URL in their browser. No accounts, no cloud, no install on
anyone else's device.

## Why this exists

Splitwise (the app) is great, but sometimes you want something:
- **Self-hosted** — your data lives in one file on one machine you control.
- **No sign-up** — anyone on the network opens a link, no login screen.
- **Zero dependencies** — pure Node.js (built-in `http` module) and vanilla JS/CSS on the
  frontend. Nothing to `npm install`, nothing to compile.
- **Easy to read and modify** — the whole backend is one file, the whole frontend is three
  files. Good starting point if you want to bolt on your own features.

## Features

- Add/remove people in the group
- Log an expense: description, amount, who paid, and who it's split between
  (even split across however many people you select)
- Running list of all expenses (delete any of them, balances update instantly)
- Per-person balance: how much they're owed or how much they owe
- "Settle up" view — the minimum number of payments needed to zero everyone out
  (e.g. instead of 5 people all paying each other, it might collapse to 2 payments)
- Data persists in a single JSON file (`data/db.json`), so restarting the server doesn't
  lose anything

## What it deliberately doesn't do

This is intentionally small. It does **not** have: user accounts/auth, unequal/percentage
splits, multiple groups, currency conversion, receipts/photos, or recurring expenses.
If you need those, see [Extending it](#extending-it) below — the codebase is small enough
to add them yourself, or treat this as a base for something bigger.

---

## Requirements

- [Node.js](https://nodejs.org) version 16 or later (nothing else — no database server,
  no npm packages). Check your version with:
  ```bash
  node --version
  ```

## Setup

1. Copy this folder onto the machine that will act as the server (your laptop, a spare
   desktop, a Raspberry Pi — anything that stays on and stays connected to your network).
2. Open a terminal in the project folder.
3. Start the server:
   ```bash
   node server/index.js
   ```
   You should see:
   ```
   Splitwise Clone running!
   Local:   http://localhost:3000
   Network: http://<your-machine-ip>:3000

   Data stored in: /path/to/data/db.json
   ```

That's it — there's no `npm install` step because there are no external dependencies.

## Using it on your local network

1. On the server machine, find its local IP address:
   - **Mac/Linux:** run `ifconfig` or `ip addr` and look for something like `192.168.1.x`
   - **Windows:** run `ipconfig` and look for "IPv4 Address"
2. On any other device connected to the **same Wi-Fi/router**, open a browser and go to:
   ```
   http://<that-ip-address>:3000
   ```
   For example: `http://192.168.1.42:3000`
3. Everyone editing that same URL is looking at and editing the same shared ledger —
   there's no per-person login, by design. It's meant for a trusted group (e.g. people
   sharing a flat or a trip) who all just want to log expenses quickly.

> **Note:** This is plain HTTP with no authentication, intended for trusted local
> networks only (home Wi-Fi, office LAN). Don't expose port 3000 to the public internet
> as-is — anyone who could reach it could read or modify the ledger.

### Changing the port

By default it runs on port `3000`. To use a different port:
```bash
PORT=8080 node server/index.js
```
(On Windows PowerShell: `$env:PORT=8080; node server/index.js`)

### Keeping it running

If you close the terminal, the server stops. To keep it running in the background:

- **Mac/Linux:**
  ```bash
  nohup node server/index.js > server.log 2>&1 &
  ```
- Or use a process manager like [`pm2`](https://pm2.keymetrics.io/) if you want it to
  survive reboots:
  ```bash
  npm install -g pm2
  pm2 start server/index.js --name tally
  ```

---

## How to use the app

1. **People tab** — add everyone in your group by name.
2. **Ledger tab** — add an expense: what it was for, the amount, who paid, and tick
   which people it should be split between (defaults to splitting evenly across whoever
   you select).
3. **Settle up tab** — see each person's running balance (green = owed money, orange =
   owes money), and the shortest list of payments that would zero everything out.

Deleting an expense recalculates balances immediately. You can't remove a person who's
attached to an existing expense — delete or reassign that expense first, to avoid
silently corrupting the ledger.

---

## Project structure

```
splitwise-clone/
├── server/
│   └── index.js        # Entire backend: HTTP server, REST API, balance math
├── public/
│   ├── index.html       # App shell / markup
│   ├── styles.css        # Styling
│   └── app.js            # Frontend logic (fetch calls, rendering, events)
├── data/
│   └── db.json            # Created automatically on first run — your data lives here
├── package.json
└── README.md
```

## How balances are calculated

Every expense has a payer and a list of people it's split among. For each expense, the
payer's balance goes up by the full amount, and every person in the split (including the
payer, if they're in their own split) goes down by `amount / number of people in split`.
Summing this across all expenses gives each person's net balance: positive means the
group owes them money, negative means they owe the group.

The settle-up screen then runs a simple greedy matching: largest creditor is paid by
largest debtor, repeat, until everyone's balance is zero. This produces the minimum (or
near-minimum) number of payments to settle the whole group.

## Backing up or resetting your data

All data lives in `data/db.json`. To back it up, just copy that file. To wipe everything
and start fresh, stop the server and delete it:
```bash
rm data/db.json
```
A fresh empty one will be created automatically the next time the server starts.

## Extending it

Some natural next steps if you want to keep building on this:
- Unequal splits (e.g. by percentage or fixed amounts instead of even split)
- Multiple separate groups/ledgers instead of one shared ledger
- Basic auth or a shared passphrase if you want it on a less-trusted network
- Editing an expense instead of only delete-and-recreate
- Exporting the ledger to CSV

The whole backend is ~250 lines in one file, so most of these are small, contained
changes.

## License

MIT — do whatever you like with it.
