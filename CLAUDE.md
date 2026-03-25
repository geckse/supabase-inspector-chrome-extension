# CLAUDE.md — Supabase Inspector

## What this is

Chrome Extension (Manifest V3) for debugging remote Supabase applications from the user's perspective. Intercepts credentials from the page's own Supabase requests, then provides inspection and manipulation tools in a Chrome Side Panel.

See `PROJECT.md` for the full product spec. See `docs/phase-*.md` for the original implementation plans.

## Architecture

```
content.js (injected into page)
  → wraps fetch/XHR/WebSocket in the page's main world
  → forwards intercepted data via window.postMessage → chrome.runtime.sendMessage

background.js (service worker)
  → stores credentials per tab (in-memory Map, never persisted)
  → routes messages between content script and side panel

sidepanel/ (Preact + HTM app)
  → reads credentials from background
  → makes its own Supabase REST/Storage API calls
  → 10 feature tabs: Security, Logger, Tables, Realtime, Storage, RPC, Auth, Query, Schema, Diff
```

## Tech stack

- **Preact + HTM** — loaded as vendored ES modules from `vendor/`, no build step
- **Vanilla CSS** — single `sidepanel/styles.css` file with CSS custom properties
- **Chrome Manifest V3** — service worker, side panel API, content scripts
- **No npm, no bundler, no framework CLI** — load as unpacked extension directly

## Key patterns

### Content script injection
The content script runs in an isolated world. To wrap `fetch`/`XHR`/`WebSocket`, it injects a `<script>` into the page's main world. Communication flows: page script → `window.postMessage` → content script → `chrome.runtime.sendMessage` → background.

### Credential extraction
Detects `.supabase.co` in request URLs. Extracts `apikey` header (case-insensitive) and `Authorization: Bearer` token. Stored per-tab in background service worker memory. Cleared on tab close or navigation.

### Supabase REST API
All data operations go through PostgREST at `/rest/v1/`. The `lib/supabase-rest.js` wrapper handles GET (select), POST (insert), PATCH (update), DELETE with proper `Prefer` headers. Schema discovery via OpenAPI spec at `GET /rest/v1/`.

### Component pattern (Preact + HTM)
```js
import { h } from '../vendor/preact.module.js';
import { useState, useEffect } from '../vendor/preact-hooks.module.js';
import htm from '../vendor/htm.module.js';
const html = htm.bind(h);

export function MyComponent({ props }) {
  const [state, setState] = useState(null);
  return html`<div class="my-component">${state}</div>`;
}
```
No JSX, no build step. `html` tagged template literal is the render function.

## File structure

```
├── manifest.json              ← extension manifest (Manifest V3)
├── background.js              ← service worker: credential store, message routing
├── content.js                 ← injected into pages to intercept Supabase requests
├── sidepanel/
│   ├── index.html             ← side panel entry point
│   ├── app.js                 ← root Preact app, tab routing
│   ├── styles.css             ← all styles, single file
│   └── components/
│       ├── Header.js          ← connection status header
│       ├── TabBar.js          ← tab navigation
│       ├── ErrorBanner.js     ← global error display
│       ├── SecurityTab.js     ← JWT analysis, RLS checks
│       ├── LoggerTab.js       ← request/response logger
│       ├── TablesTab.js       ← table browser with CRUD
│       ├── TableGrid.js       ← data grid for table rows
│       ├── InlineEditor.js    ← in-place cell editing
│       ├── RowForm.js         ← add/edit row form
│       ├── RealtimeTab.js     ← realtime subscription monitor
│       ├── StorageTab.js      ← storage bucket browser
│       ├── RpcTab.js          ← RPC function caller
│       ├── AuthTab.js         ← auth user inspection
│       ├── QueryTab.js        ← raw SQL/PostgREST query runner
│       ├── SchemaTab.js       ← schema explorer (tables, columns, FKs)
│       └── PermissionDiffTab.js ← RLS permission diff tool
├── lib/
│   ├── credential-store.js    ← per-tab credential management
│   ├── jwt-decode.js          ← JWT parsing without dependencies
│   ├── logger-store.js        ← request log buffer
│   ├── supabase-rest.js       ← PostgREST API wrapper
│   ├── supabase-storage.js    ← Storage API wrapper
│   ├── realtime-monitor.js    ← WebSocket realtime listener
│   └── schema-parser.js       ← OpenAPI spec parser (shared across tabs)
├── vendor/                    ← preact.module.js, preact-hooks.module.js, htm.module.js
├── icons/                     ← extension icons (16, 48, 128)
├── docs/                      ← phase implementation specs (reference)
├── PROJECT.md                 ← full project spec
└── CLAUDE.md                  ← this file
```

## Style rules

- Dark theme. Background: `#171717`. Primary accent: `#3ecf8e` (Supabase green).
- All colors via CSS custom properties defined at the top of `styles.css`.
- Semantic colors: `--safe` (green), `--warning` (yellow), `--danger` (red), `--info` (blue).
- Monospace font (`--font-mono`) for data, code, table names. Sans-serif (`--font-sans`) for UI labels.
- See the Color Scheme section in `PROJECT.md` for the full variable list.

## Code conventions

- ES modules everywhere (`import`/`export`), no CommonJS
- No TypeScript — plain JS with JSDoc comments where types matter
- Component files export a single named function component
- Lib files export classes or pure functions
- No external dependencies beyond vendored Preact + HTM
- Credentials are never persisted to disk, never sent externally
- All Supabase API calls go through `lib/supabase-rest.js` or `lib/supabase-storage.js`
- `lib/schema-parser.js` is the single source of truth for OpenAPI spec parsing — used by Tables, Query, Schema, and RPC tabs

## Testing

No test framework. Verify manually by loading as unpacked extension in `chrome://extensions`:

1. Enable Developer Mode
2. "Load unpacked" → select project root
3. Visit a Supabase-backed site
4. Click extension icon to open side panel

## Common gotchas

- **Content script isolation**: `window.fetch` in a content script is the *extension's* fetch, not the page's. Must inject into the main world to wrap the page's globals.
- **Service worker lifecycle**: Background service workers can be terminated. The in-memory credential store is lost — content script will re-capture on the next Supabase request.
- **CORS**: Side panel fetch calls to `*.supabase.co` work because of `host_permissions` in the manifest. No CORS issues from the extension context.
- **OpenAPI spec**: `GET /rest/v1/` returns the PostgREST OpenAPI 2.0 spec. It's the source for table names, column types, PKs, FKs, and RPC functions.
- **PostgREST pagination**: Use `Range` header + `Prefer: count=exact` to get total row count from `content-range` response header.
