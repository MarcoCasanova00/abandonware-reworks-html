# Delicious Library Shared

Homage to **Delicious Library 1.6.2** (Delicious Monster, 2005, Mac PPC) —
rebuilt as a hosted website where people register and share media libraries
(books, movies, music, games).

## Run

Needs **Node 22.5+** (uses built-in `node:sqlite`, no `npm install`).

```sh
cd delicious-library
node server.js
# → Delicious Library Shared on http://localhost:3000
```

Open `http://localhost:3000` in a browser. Data lives in `library.db`
next to `server.js` (created on first run). `PORT=3001 node server.js`
to use another port.

## Accounts

- Register on the login page (2–24 chars, password min 4).
- Test account already in the shipped `library.db`: **demo / demo1234**
  (5 items, one private).
- ⚠ **DEBUG ONLY**: a "BYPASS AUTHENTICATION" button logs in as `debug`
  with no password. **Remove it before hosting publicly** — delete the
  `/api/debug-bypass` route in `server.js` and the `#bypass` button
  in `public/index.html`.

## Features

- Personal shelves: add / edit (inline) / delete, ratings, shelves,
  public-private toggle per item.
- Discover: search everyone's public items; click an owner to open
  their public shelf (`/api/u/<name>`).
- Search own library (title / creator / shelf), filter by media type.
- JSON API: `/api/register /login /logout /me /items /discover /u/:name`.

## Troubleshooting

- **Connection refused** → the server isn't running (or you're browsing
  the wrong host/port). Start `node server.js` and keep that terminal
  open; browse the exact URL it prints.
- **WSL + Windows browser** → run the server inside WSL, browse
  `http://localhost:3000` in Windows (forwarded automatically). If that
  fails, use the WSL IP instead: `hostname -I` in WSL, then
  `http://<that-ip>:3000` in Windows.
- **"bad login"** → that database has no such user (fresh `library.db`).
  Register, or copy over a `library.db` that has the account.
- **EADDRINUSE** → a copy is already running. Kill it or set `PORT=`.
