# Supabase Inspector

A Chrome Extension (Manifest V3) for debugging remote Supabase applications from the user's perspective. Intercepts credentials from a page's own Supabase requests, then provides inspection and manipulation tools in a Chrome Side Panel.

## Features

| Tab | Description |
|---|---|
| **Security** | RLS risk dashboard — probes every table and flags exposed data. JWT claims viewer. |
| **Logger** | Real-time request/response log with method, table, status, and duration. Filterable and exportable. |
| **Tables** | Paginated data grid with column sorting, inline editing, row insert, and delete. |
| **Realtime** | WebSocket channel monitor — shows active subscriptions and live INSERT/UPDATE/DELETE events. |
| **Storage** | Bucket and file browser with breadcrumb navigation, upload, download, and delete. |
| **RPC** | Database function executor with typed parameter forms. Generates curl and JS fetch snippets. |
| **Auth** | Session overview with visual token expiry bar, MFA status, and collapsible JWT/metadata sections. |
| **Query** | Visual query builder (select, filter, order, join) with raw mode and result grid. |
| **Schema** | Table/column detail viewer with PK/FK badges and a relationship diagram. |
| **Diff** | Permission diff — compares anonymous vs. authenticated access across all tables. |

## How It Works

1. A content script injects into every page and wraps `fetch`, `XMLHttpRequest`, and `WebSocket` in the page's main world.
2. When a request to `*.supabase.co` is detected, the script extracts the project URL, API key, and JWT, then forwards them to the background service worker.
3. The side panel reads credentials from the background and makes its own Supabase REST/Storage API calls using the intercepted tokens.

Credentials are stored in-memory only (never persisted to disk) and are cleared when the tab is closed.

## Install

No build step required — this is a plain ES modules extension.

1. Clone the repo
2. Open `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the project root folder
5. Visit any Supabase-backed website
6. Click the extension icon to open the side panel

## Tech Stack

- **Preact + HTM** — vendored ES modules, no build step
- **Vanilla CSS** — single stylesheet with CSS custom properties (dark theme)
- **Chrome Manifest V3** — service worker, side panel API, content scripts
- **No npm, no bundler, no framework CLI**

## Project Structure

```
├── manifest.json              # Extension configuration
├── background.js              # Service worker — credential store, message routing
├── content.js                 # Content script — fetch/XHR/WebSocket interception
├── sidepanel/
│   ├── index.html             # Side panel entry point
│   ├── app.js                 # Preact root — tab routing, state management
│   ├── styles.css             # All styles
│   └── components/            # One file per tab/component
├── lib/                       # Shared logic (REST client, schema parser, JWT, etc.)
├── vendor/                    # Preact, hooks, HTM (local ES modules)
└── icons/                     # Extension icons
```

## RLS Checker — What It Tests

The Security tab's RLS Checker probes every table discovered via the OpenAPI spec. Here's what it checks:

| Check | How | What it flags |
|---|---|---|
| **Anonymous read** | `SELECT *` with only the `apikey` (no JWT) | Tables readable without authentication — flagged as exposed if 30+ rows, warning if fewer |
| **Authenticated read** | `SELECT *` with the intercepted JWT | Sensitive tables where the authenticated role can read 30+ rows (may indicate missing row-level scoping) |
| **Anonymous INSERT** | `POST {}` with only the `apikey` | Tables that accept inserts from unauthenticated users (inferred from 400/409/201 vs 401/403) |
| **Authenticated INSERT** | `POST {}` with the JWT | Sensitive tables where the authenticated role can insert (same status-code inference) |
| **Column exposure diff** | Compares column lists between anon and auth responses | Flags when anonymous access exposes columns that are hidden from authenticated users |
| **Sensitive table detection** | Matches table names against a built-in list (`users`, `payments`, `api_keys`, etc.) | Sensitive tables are sorted first and have stricter thresholds |

### Known gaps

- **UPDATE and DELETE are not tested.** PostgREST returns `200`/`204` for "0 rows affected" regardless of whether RLS allows the operation, so there's no way to distinguish "denied by policy" from "allowed but matched nothing" without side effects.
- **Row-level scoping** is not verified. The checker can detect *whether* a role has access, but not *whether* RLS policies correctly scope rows to the current user (e.g. `auth.uid() = user_id`).
- **The sensitive table list is static.** Custom table names that hold sensitive data but aren't in the built-in list won't get the stricter thresholds.
- **Schema-level restrictions**: tables in non-public schemas are still checked if they are discovered from intercepted traffic (the extension falls back to probing tables from logged requests when the OpenAPI spec is unavailable). However, tables that never appear in traffic won't be discovered.

## Security Notes

- Credentials are **never persisted** to disk or sent to any external service.
- All API calls go directly to the user's own Supabase instance using their intercepted tokens.
- The extension only activates when it detects requests to `*.supabase.co`.

## License

MIT
