# Humanize Text Figma Plugin — Design Spec

## Overview

A Figma plugin that assesses text layers for AI writing patterns and rewrites them. Users provide their own Anthropic API key. Rules are fetched from the humanize-text GitHub repo at runtime so updates don't require a new plugin version.

## Architecture

Three components, no backend:

1. **Plugin sandbox** (main.ts) — Figma API context. Extracts text nodes, applies rewrites, handles fonts.
2. **Plugin UI** (ui.html + ui.ts) — iframe. Settings, scorecard, rewrite list, user interactions.
3. **Claude API** — called directly from the iframe via `@anthropic-ai/sdk` with `dangerouslyAllowBrowser: true`.

### Data flow

```
User clicks "Assess"
  → Sandbox extracts TEXT nodes (from selection or whole page)
  → Sends [{id, name, text, layerPath}] to UI via postMessage
  → UI fetches SKILL.md from GitHub (or uses cache)
  → UI calls Claude API: system = SKILL.md rules, user = text nodes JSON
  → Claude returns structured JSON: scores + rewrites
  → UI renders scorecard + rewrite list
  → User clicks "Apply" (per item) or "Apply all"
  → UI sends [{id, newText}] to sandbox via postMessage
  → Sandbox loads fonts, updates node.characters
  → UI shows confirmation + "Undo all" button
```

## Plugin Sandbox (main.ts)

### Text extraction

```ts
function extractTextNodes(nodes: readonly SceneNode[]): TextNodeData[]
```

- Recursively walks children of provided nodes
- For each TEXT node, collects: `id`, `name`, `characters`, `layerPath` (parent chain for context)
- Returns flat array

### Selection logic

- `figma.currentPage.selection.length > 0` → extract from selection
- Nothing selected → extract from `figma.currentPage.children`
- Send count to UI first. If 50+, UI shows warning and waits for confirmation before proceeding.
- If 0 text nodes found, send empty array (UI shows "No text layers found").

### Applying rewrites

```ts
function applyRewrite(nodeId: string, newText: string): Promise<void>
```

- `figma.getNodeById(nodeId)` → verify it's still a TEXT node
- Check if node has mixed styles via `node.getStyledTextSegments(["fontName", "fontSize", "fontWeight"])`
- If uniform style: `await figma.loadFontAsync(node.fontName as FontName)` then `node.characters = newText`
- If mixed styles: store segment boundaries, load all fonts, set characters, then re-apply styles via range methods

### Batch apply

```ts
function applyAll(rewrites: {id: string, text: string}[]): Promise<{applied: number, failed: string[]}>
```

- Iterates rewrites sequentially (font loading is async)
- Returns count of applied + list of failed node IDs (node deleted, font unavailable)
- On success, zooms to first modified node via `figma.viewport.scrollAndZoomIntoView`

### Message protocol (sandbox ↔ UI)

| Direction | Type | Payload |
|-----------|------|---------|
| Sandbox → UI | `text-nodes` | `{nodes: TextNodeData[], totalCount: number}` |
| UI → Sandbox | `apply-rewrite` | `{nodeId: string, newText: string}` |
| UI → Sandbox | `apply-all` | `{rewrites: {id: string, text: string}[]}` |
| Sandbox → UI | `apply-result` | `{success: boolean, applied: number, failed: string[]}` |
| UI → Sandbox | `undo-all` | `{originals: {id: string, text: string}[]}` |
| UI → Sandbox | `select-node` | `{nodeId: string}` |
| Sandbox → UI | `undo-result` | `{success: boolean, restored: number}` |

## Plugin UI (ui.html + ui.ts)

### States

1. **No API key** — centered card with input field, "Save" button, link to console.anthropic.com. Subtext: "Your key is stored locally and never leaves your machine."
2. **Ready** — "Assess selected" button (label changes to "Assess page" if nothing selected). Shows layer count after extraction.
3. **Warning** — shown if 50+ text layers. "Found 127 text layers. This will use approximately X tokens. Continue?"
4. **Loading** — progress text: "Scanning 23 text layers..." with a simple spinner.
5. **Results** — scorecard at top, flagged items below, "Apply all" fixed at bottom.
6. **Applied** — confirmation banner: "12 layers updated". "Undo all" button.

### Scorecard (top of results)

```
Human Score: 80%
[========--------]

AI Vocabulary     7/10
Content Inflation 6/10
Grammar Patterns  8/10
UX Copy Quality   7/10
Structural Tells  9/10
Punctuation       9/10
Meta-Content      10/10
Figma Copy Ctx    8/10
```

- Progress bar color: green (85%+), yellow (60-84%), red (<60%)
- Each category row shows score. Tapping a category scrolls to its flagged items below.

### Rewrite list (below scorecard)

Each item:
```
[Layer name]                    [Apply]
"Original text here truncated..."
→ "Suggested rewrite here..."
Issue: AI vocab (seamless), vague benefit
```

- Layer name is clickable → sends `select-node` to sandbox, which selects and zooms to the node
- "Apply" button per item, turns to checkmark on success
- Original text in muted color, suggested in white
- Issue tag in small purple text

### "Apply all" bar

Fixed at bottom of panel when results are showing:
```
[Apply all 8 rewrites]
```

After applying:
```
[✓ 8 layers updated] [Undo all]
```

### Settings

Accessible via gear icon in top-right:
- API key field (masked, with show/hide toggle)
- "Clear key" button
- Current rules version (shows last-fetched timestamp)
- "Refresh rules" button

## Rules Fetching

### Source URL

```
https://raw.githubusercontent.com/gregorymm/humanize-text/main/skills/humanize-text/SKILL.md
```

### Caching strategy

- On each assessment, check `figma.clientStorage` for cached rules + timestamp
- If cache is less than 24 hours old, use cached version
- If cache is stale or missing, fetch from GitHub
- If fetch fails (offline, rate limited, 404): use cached version if available, otherwise show error
- Store via `figma.clientStorage.setAsync('skill_rules', {content, fetchedAt})`

## Claude API Integration

### Client initialization

```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: storedKey,
  dangerouslyAllowBrowser: true,
  defaultHeaders: {
    "anthropic-dangerous-direct-browser-access": "true",
  },
});
```

### Request structure

- Model: `claude-sonnet-4-6` (fast, cost-effective for scoring)
- Max tokens: 4096
- System prompt: SKILL.md content + JSON output instruction:

```
You are a text assessment tool. Analyze the provided text nodes for AI writing patterns using the rules in this document.

[SKILL.md content here]

Return a JSON object with this exact structure:
{
  "humanScore": <number 0-100>,
  "categories": [
    {"name": "<category name>", "score": <1-10>, "flags": <count>}
  ],
  "rewrites": [
    {"id": "<node id>", "original": "<current text>", "suggested": "<rewritten text>", "issue": "<brief issue description>"}
  ]
}

Only include nodes that need changes in the rewrites array. Nodes scoring 9/10 or above across all categories can be omitted.
Return ONLY the JSON, no markdown fencing, no explanation.
```

- User message: `JSON.stringify(textNodes)`

### Response parsing

- Parse response as JSON
- Validate structure (humanScore is number, categories is array of 8, rewrites have required fields)
- If parsing fails, show error: "Couldn't parse assessment results. Try again."

### Token estimation

Before calling API, estimate tokens: `~(total characters / 4) + system prompt tokens`. Show in the warning dialog for 50+ nodes.

## Undo System

- Before applying any rewrite, store `{id, originalText}` for every modified node in a local array
- "Undo all" iterates this array, restoring original text (with same font-loading logic)
- Undo state clears when: new assessment runs, plugin closes, or user dismisses the results
- Individual undo not supported in v1 (apply-all or individual apply, but undo is always all-or-nothing)

## Tech Stack

- **Language:** TypeScript
- **Bundler:** esbuild (bundles sandbox and UI separately)
- **API client:** `@anthropic-ai/sdk` (bundled into UI)
- **UI:** vanilla HTML/CSS (no framework, keeps bundle under 200KB)
- **Styling:** dark theme matching Figma's plugin panel (bg #2c2c2c, text #fff, accent purple #A78BFA and green #C6F96C)

## Build & Distribution

### File structure
```
figma-plugin/
  manifest.json
  src/
    main.ts          # plugin sandbox
    ui.html          # plugin UI shell
    ui.ts            # UI logic + API calls
    styles.css       # plugin styles
    types.ts         # shared types
  dist/
    main.js          # bundled sandbox
    ui.html          # bundled UI (inline JS + CSS)
  package.json
  tsconfig.json
  esbuild.config.js
```

### manifest.json
```json
{
  "name": "Humanize Text",
  "id": "humanize-text-plugin",
  "api": "1.0.0",
  "main": "dist/main.js",
  "ui": "dist/ui.html",
  "editorType": ["figma"],
  "networkAccess": {
    "allowedDomains": [
      "api.anthropic.com",
      "raw.githubusercontent.com"
    ]
  }
}
```

### Build commands
```bash
npm run build    # esbuild both sandbox + UI
npm run dev      # watch mode for development
```

### Distribution
- Publish to Figma Community (free plugin)
- Source code in the same `gregorymm/humanize-text` GitHub repo under `figma-plugin/` directory

## Error Handling

| Error | User sees |
|-------|-----------|
| Invalid API key | "Invalid API key. Check console.anthropic.com" |
| Rate limited | "Rate limited by Anthropic. Wait a moment and try again." |
| Network offline | "Can't reach the API. Check your connection." |
| Rules fetch failed | Falls back to cache silently. If no cache: "Couldn't load assessment rules." |
| JSON parse failed | "Couldn't parse results. Try again." |
| Node deleted before apply | Skipped, shown in failed list |
| Font not available | "Couldn't load font for [layer name]. Skipped." |

## Out of Scope for v1

- Individual undo (only undo-all)
- History of past assessments
- Custom rules/overrides
- Batch assessment across multiple pages
- Export report as PDF/image
- Plugin settings sync across devices
