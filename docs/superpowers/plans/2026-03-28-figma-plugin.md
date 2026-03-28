# Humanize Text Figma Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Figma plugin that assesses text layers for AI writing patterns using Claude API and rewrites them in-place.

**Architecture:** Figma plugin with sandbox (text extraction + apply) and iframe UI (settings, scorecard, API calls). No backend. Users provide their own Anthropic API key. Assessment rules fetched from GitHub at runtime.

**Tech Stack:** TypeScript, esbuild, @anthropic-ai/sdk, Figma Plugin API, vanilla HTML/CSS

---

## File Structure

```
figma-plugin/
  manifest.json          # Plugin manifest with network access config
  package.json           # Dependencies and build scripts
  tsconfig.json          # TypeScript config
  esbuild.config.js      # Build config for sandbox + UI bundles
  src/
    types.ts             # Shared types (TextNodeData, messages, API response)
    main.ts              # Plugin sandbox: extract text, apply rewrites, undo
    ui.ts                # UI logic: state machine, API calls, rendering
    ui.html              # HTML shell with inline CSS
    styles.css           # Plugin dark theme styles
  dist/                  # Build output (gitignored)
    main.js
    ui.html
```

---

### Task 1: Project scaffold and build system

**Files:**
- Create: `figma-plugin/package.json`
- Create: `figma-plugin/tsconfig.json`
- Create: `figma-plugin/esbuild.config.js`
- Create: `figma-plugin/manifest.json`
- Create: `figma-plugin/.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "humanize-text-figma-plugin",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "node esbuild.config.js",
    "dev": "node esbuild.config.js --watch"
  },
  "devDependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@figma/plugin-typings": "^1.100.0",
    "esbuild": "^0.24.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "typeRoots": ["node_modules/@figma"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create esbuild.config.js**

```js
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const watch = process.argv.includes("--watch");

async function build() {
  // Bundle the sandbox (runs in Figma's main thread)
  await esbuild.build({
    entryPoints: ["src/main.ts"],
    bundle: true,
    outfile: "dist/main.js",
    format: "iife",
    target: "es2020",
    watch: watch ? { onRebuild(err) { if (!err) console.log("sandbox rebuilt"); } } : false,
  });

  // Bundle the UI (runs in iframe)
  const uiResult = await esbuild.build({
    entryPoints: ["src/ui.ts"],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2020",
    define: { "process.env.NODE_ENV": '"production"' },
    watch: watch
      ? {
          onRebuild(err) {
            if (!err) {
              buildUiHtml();
              console.log("ui rebuilt");
            }
          },
        }
      : false,
  });

  function buildUiHtml() {
    const jsCode = uiResult.outputFiles[0].text;
    const css = fs.readFileSync(path.join(__dirname, "src/styles.css"), "utf8");
    const htmlShell = fs.readFileSync(path.join(__dirname, "src/ui.html"), "utf8");
    const finalHtml = htmlShell
      .replace("/* __CSS__ */", css)
      .replace("/* __JS__ */", jsCode);
    fs.mkdirSync("dist", { recursive: true });
    fs.writeFileSync("dist/ui.html", finalHtml);
  }

  buildUiHtml();
  console.log("Build complete");
  if (watch) console.log("Watching for changes...");
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: Create manifest.json**

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

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
```

- [ ] **Step 6: Install dependencies**

Run: `cd figma-plugin && npm install`
Expected: `node_modules/` created with @anthropic-ai/sdk, @figma/plugin-typings, esbuild, typescript

- [ ] **Step 7: Commit**

```bash
git add figma-plugin/package.json figma-plugin/tsconfig.json figma-plugin/esbuild.config.js figma-plugin/manifest.json figma-plugin/.gitignore figma-plugin/package-lock.json
git commit -m "feat: scaffold Figma plugin project with esbuild build system"
```

---

### Task 2: Shared types

**Files:**
- Create: `figma-plugin/src/types.ts`

- [ ] **Step 1: Create types.ts with all shared interfaces**

```ts
// Data extracted from a Figma TEXT node
export interface TextNodeData {
  id: string;
  name: string;
  text: string;
  layerPath: string;
}

// Claude API response structure
export interface AssessmentResult {
  humanScore: number;
  categories: CategoryScore[];
  rewrites: RewriteSuggestion[];
}

export interface CategoryScore {
  name: string;
  score: number;
  flags: number;
}

export interface RewriteSuggestion {
  id: string;
  original: string;
  suggested: string;
  issue: string;
}

// Messages: Sandbox -> UI
export type SandboxMessage =
  | { type: "text-nodes"; nodes: TextNodeData[]; totalCount: number }
  | { type: "apply-result"; success: boolean; applied: number; failed: string[] }
  | { type: "undo-result"; success: boolean; restored: number };

// Messages: UI -> Sandbox
export type UIMessage =
  | { type: "assess" }
  | { type: "assess-confirmed" }
  | { type: "apply-rewrite"; nodeId: string; newText: string }
  | { type: "apply-all"; rewrites: { id: string; text: string }[] }
  | { type: "undo-all"; originals: { id: string; text: string }[] }
  | { type: "select-node"; nodeId: string }
  | { type: "cancel" };

// UI state machine
export type UIState =
  | "no-api-key"
  | "ready"
  | "warning"
  | "loading"
  | "results"
  | "applied"
  | "error";

// Cached rules
export interface CachedRules {
  content: string;
  fetchedAt: number;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd figma-plugin && npx tsc --noEmit src/types.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add figma-plugin/src/types.ts
git commit -m "feat: add shared types for plugin messages and API response"
```

---

### Task 3: Plugin sandbox (main.ts)

**Files:**
- Create: `figma-plugin/src/main.ts`

- [ ] **Step 1: Create main.ts with text extraction**

```ts
import type { TextNodeData, UIMessage } from "./types";

figma.showUI(__html__, { width: 340, height: 560, themeColors: true });

function extractTextNodes(nodes: readonly SceneNode[]): TextNodeData[] {
  const result: TextNodeData[] = [];

  function walk(node: SceneNode, path: string) {
    if (node.type === "TEXT") {
      result.push({
        id: node.id,
        name: node.name,
        text: node.characters,
        layerPath: path,
      });
    }
    if ("children" in node) {
      for (const child of node.children) {
        walk(child, path ? `${path} > ${node.name}` : node.name);
      }
    }
  }

  for (const node of nodes) {
    walk(node, "");
  }
  return result;
}

function getTextNodes(): TextNodeData[] {
  const selection = figma.currentPage.selection;
  if (selection.length > 0) {
    return extractTextNodes(selection);
  }
  return extractTextNodes(figma.currentPage.children);
}

async function applyRewrite(nodeId: string, newText: string): Promise<boolean> {
  const node = figma.getNodeById(nodeId);
  if (!node || node.type !== "TEXT") return false;

  const textNode = node as TextNode;
  const segments = textNode.getStyledTextSegments([
    "fontName",
    "fontSize",
    "fontWeight",
    "italic",
    "textDecoration",
    "letterSpacing",
    "lineHeight",
    "fills",
  ]);

  if (segments.length <= 1) {
    const fontName = textNode.fontName;
    if (fontName === figma.mixed) {
      // Mixed but only one segment means uniform, load first
      await figma.loadFontAsync(segments[0].fontName);
    } else {
      await figma.loadFontAsync(fontName);
    }
    textNode.characters = newText;
    return true;
  }

  // Mixed styles: load all fonts, set text, re-apply styles proportionally
  const uniqueFonts = new Set<string>();
  for (const seg of segments) {
    uniqueFonts.add(JSON.stringify(seg.fontName));
  }
  for (const fontStr of uniqueFonts) {
    await figma.loadFontAsync(JSON.parse(fontStr));
  }

  // Store style info relative to text length
  const totalLen = textNode.characters.length;
  const styleRanges = segments.map((seg) => ({
    startRatio: seg.start / totalLen,
    endRatio: seg.end / totalLen,
    fontName: seg.fontName,
    fontSize: seg.fontSize,
    fills: seg.fills,
  }));

  textNode.characters = newText;

  // Re-apply styles proportionally to new text length
  const newLen = newText.length;
  for (const range of styleRanges) {
    const start = Math.round(range.startRatio * newLen);
    const end = Math.min(Math.round(range.endRatio * newLen), newLen);
    if (start >= end || start >= newLen) continue;
    textNode.setRangeFontName(start, end, range.fontName);
    textNode.setRangeFontSize(start, end, range.fontSize);
    if (range.fills && Array.isArray(range.fills)) {
      textNode.setRangeFills(start, end, range.fills);
    }
  }

  return true;
}

figma.ui.onmessage = async (msg: UIMessage) => {
  if (msg.type === "assess" || msg.type === "assess-confirmed") {
    const nodes = getTextNodes();
    figma.ui.postMessage({
      type: "text-nodes",
      nodes,
      totalCount: nodes.length,
    });
  }

  if (msg.type === "apply-rewrite") {
    const success = await applyRewrite(msg.nodeId, msg.newText);
    figma.ui.postMessage({
      type: "apply-result",
      success,
      applied: success ? 1 : 0,
      failed: success ? [] : [msg.nodeId],
    });
  }

  if (msg.type === "apply-all") {
    let applied = 0;
    const failed: string[] = [];
    for (const rewrite of msg.rewrites) {
      const ok = await applyRewrite(rewrite.id, rewrite.text);
      if (ok) applied++;
      else failed.push(rewrite.id);
    }
    if (applied > 0) {
      const firstNode = figma.getNodeById(msg.rewrites[0].id);
      if (firstNode) {
        figma.viewport.scrollAndZoomIntoView([firstNode]);
      }
    }
    figma.ui.postMessage({ type: "apply-result", success: true, applied, failed });
  }

  if (msg.type === "undo-all") {
    let restored = 0;
    for (const orig of msg.originals) {
      const ok = await applyRewrite(orig.id, orig.text);
      if (ok) restored++;
    }
    figma.ui.postMessage({ type: "undo-result", success: true, restored });
  }

  if (msg.type === "select-node") {
    const node = figma.getNodeById(msg.nodeId);
    if (node && "type" in node) {
      figma.currentPage.selection = [node as SceneNode];
      figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
    }
  }

  if (msg.type === "cancel") {
    figma.closePlugin();
  }
};
```

- [ ] **Step 2: Verify it compiles**

Run: `cd figma-plugin && npx tsc --noEmit`
Expected: No errors (may have warnings about figma globals, that's OK since @figma/plugin-typings provides those at runtime)

- [ ] **Step 3: Commit**

```bash
git add figma-plugin/src/main.ts
git commit -m "feat: plugin sandbox with text extraction, rewrite apply, and undo"
```

---

### Task 4: UI styles

**Files:**
- Create: `figma-plugin/src/styles.css`

- [ ] **Step 1: Create styles.css**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 12px;
  color: #e0e0e0;
  background: #2c2c2c;
  line-height: 1.5;
  overflow-x: hidden;
}

/* Layout */
.container { padding: 12px; }
.hidden { display: none !important; }

/* Header */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 12px;
  border-bottom: 1px solid #3c3c3c;
  margin-bottom: 12px;
}

.header h1 {
  font-size: 14px;
  font-weight: 700;
  color: #fff;
}

.gear-btn {
  background: none;
  border: none;
  color: #999;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  font-size: 16px;
}

.gear-btn:hover { color: #fff; background: #3c3c3c; }

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  width: 100%;
  transition: background 0.15s ease;
}

.btn-primary {
  background: #A78BFA;
  color: #fff;
}

.btn-primary:hover { background: #9575F0; }
.btn-primary:disabled { background: #555; color: #888; cursor: not-allowed; }

.btn-green {
  background: #C6F96C;
  color: #1a1a1a;
}

.btn-green:hover { background: #B8EB5E; }

.btn-outline {
  background: none;
  border: 1px solid #555;
  color: #ccc;
}

.btn-outline:hover { border-color: #888; color: #fff; }

.btn-small {
  padding: 4px 10px;
  font-size: 11px;
  width: auto;
}

/* Input */
.input {
  width: 100%;
  padding: 8px 10px;
  background: #1e1e1e;
  border: 1px solid #444;
  border-radius: 6px;
  color: #fff;
  font-size: 12px;
  outline: none;
}

.input:focus { border-color: #A78BFA; }

.input-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.input-group label {
  font-size: 11px;
  font-weight: 600;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.help-text {
  font-size: 11px;
  color: #777;
  margin-top: 4px;
}

.link {
  color: #A78BFA;
  text-decoration: none;
}

.link:hover { text-decoration: underline; }

/* Scorecard */
.scorecard {
  background: #1e1e1e;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}

.score-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.score-percent {
  font-size: 28px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.score-percent.green { color: #C6F96C; }
.score-percent.yellow { color: #FACC15; }
.score-percent.red { color: #F87171; }

.score-label {
  font-size: 11px;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}

.progress-bar {
  width: 100%;
  height: 4px;
  background: #333;
  border-radius: 2px;
  margin-bottom: 10px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.6s ease;
}

.progress-fill.green { background: #C6F96C; }
.progress-fill.yellow { background: #FACC15; }
.progress-fill.red { background: #F87171; }

.category-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 12px;
  cursor: pointer;
  border-radius: 4px;
  padding: 3px 6px;
}

.category-row:hover { background: #2a2a2a; }

.category-name { color: #bbb; }
.category-score {
  font-weight: 700;
  color: #A78BFA;
  font-variant-numeric: tabular-nums;
  min-width: 32px;
  text-align: right;
}

/* Rewrite items */
.rewrite-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 60px;
}

.rewrite-item {
  background: #1e1e1e;
  border-radius: 8px;
  padding: 10px 12px;
  border: 1px solid #333;
}

.rewrite-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.layer-name {
  font-size: 11px;
  font-weight: 600;
  color: #A78BFA;
  cursor: pointer;
  text-decoration: none;
}

.layer-name:hover { text-decoration: underline; }

.rewrite-original {
  font-size: 12px;
  color: #777;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.rewrite-arrow { color: #C6F96C; font-size: 11px; margin-bottom: 2px; }

.rewrite-suggested {
  font-size: 12px;
  color: #fff;
  margin-bottom: 4px;
}

.rewrite-issue {
  font-size: 10px;
  color: #A78BFA;
  font-weight: 500;
}

.applied-check {
  color: #C6F96C;
  font-weight: 700;
  font-size: 14px;
}

/* Bottom bar */
.bottom-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 10px 12px;
  background: #2c2c2c;
  border-top: 1px solid #3c3c3c;
  display: flex;
  gap: 8px;
}

/* Warning */
.warning-box {
  background: #3b2e00;
  border: 1px solid #665200;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}

.warning-box p { color: #FACC15; font-size: 12px; margin-bottom: 8px; }

/* Error */
.error-box {
  background: #3b1515;
  border: 1px solid #662020;
  border-radius: 8px;
  padding: 12px;
  color: #F87171;
  font-size: 12px;
  margin-bottom: 12px;
}

/* Settings panel */
.settings-panel {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: #2c2c2c;
  z-index: 10;
  padding: 12px;
  overflow-y: auto;
}

.settings-panel h2 {
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  margin-bottom: 16px;
}

.settings-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid #3c3c3c;
  font-size: 12px;
}

.settings-row .label { color: #999; }
.settings-row .value { color: #fff; font-weight: 500; }

/* Spinner */
.spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid #555;
  border-top-color: #A78BFA;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* Loading state */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 0;
  color: #999;
}

/* Empty state */
.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: #777;
}

/* Confirmation banner */
.success-banner {
  background: #1a2e1a;
  border: 1px solid #2d5a2d;
  border-radius: 8px;
  padding: 10px 12px;
  color: #C6F96C;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}
```

- [ ] **Step 2: Commit**

```bash
git add figma-plugin/src/styles.css
git commit -m "feat: dark theme styles matching Figma plugin panel"
```

---

### Task 5: UI HTML shell

**Files:**
- Create: `figma-plugin/src/ui.html`

- [ ] **Step 1: Create ui.html**

```html
<!DOCTYPE html>
<html>
<head>
  <style>/* __CSS__ */</style>
</head>
<body>
  <div class="container" id="app">
    <!-- Header -->
    <div class="header">
      <h1>Humanize Text</h1>
      <button class="gear-btn" id="settingsBtn" title="Settings">&#9881;</button>
    </div>

    <!-- State: No API Key -->
    <div id="state-no-key">
      <div class="input-group">
        <label>Anthropic API Key</label>
        <input type="password" class="input" id="apiKeyInput" placeholder="sk-ant-..." />
        <p class="help-text">
          Your key is stored locally and never leaves your machine.
          <br/>Get one at <a href="https://console.anthropic.com" target="_blank" class="link">console.anthropic.com</a>
        </p>
      </div>
      <button class="btn btn-primary" id="saveKeyBtn">Save key</button>
    </div>

    <!-- State: Ready -->
    <div id="state-ready" class="hidden">
      <button class="btn btn-primary" id="assessBtn">Assess selected layers</button>
    </div>

    <!-- State: Warning (50+ layers) -->
    <div id="state-warning" class="hidden">
      <div class="warning-box">
        <p id="warningText">Found 127 text layers. This will use approximately 8,000 tokens.</p>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-primary btn-small" id="confirmAssessBtn">Continue</button>
          <button class="btn btn-outline btn-small" id="cancelAssessBtn">Cancel</button>
        </div>
      </div>
    </div>

    <!-- State: Loading -->
    <div id="state-loading" class="hidden">
      <div class="loading-state">
        <div class="spinner"></div>
        <span id="loadingText">Scanning text layers...</span>
      </div>
    </div>

    <!-- State: Error -->
    <div id="state-error" class="hidden">
      <div class="error-box" id="errorText"></div>
      <button class="btn btn-outline" id="retryBtn">Try again</button>
    </div>

    <!-- State: Results -->
    <div id="state-results" class="hidden">
      <!-- Success banner (shown after apply) -->
      <div id="successBanner" class="success-banner hidden">
        <span>&#10003;</span>
        <span id="successText"></span>
      </div>

      <!-- Scorecard -->
      <div class="scorecard" id="scorecard">
        <div class="score-header">
          <div>
            <div class="score-percent" id="scorePercent">--</div>
            <div class="score-label">Human Score</div>
          </div>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" id="progressFill" style="width:0%"></div>
        </div>
        <div id="categoryRows"></div>
      </div>

      <!-- Rewrite list -->
      <div class="rewrite-list" id="rewriteList"></div>
    </div>

    <!-- Bottom bar (Apply all / Undo) -->
    <div class="bottom-bar hidden" id="bottomBar">
      <button class="btn btn-green" id="applyAllBtn">Apply all</button>
      <button class="btn btn-outline hidden" id="undoAllBtn">Undo all</button>
    </div>

    <!-- Settings overlay -->
    <div class="settings-panel hidden" id="settingsPanel">
      <h2>Settings</h2>
      <div class="input-group">
        <label>API Key</label>
        <div style="display:flex;gap:6px;">
          <input type="password" class="input" id="settingsKeyInput" placeholder="sk-ant-..." style="flex:1;" />
          <button class="btn btn-outline btn-small" id="toggleKeyVisibility">Show</button>
        </div>
      </div>
      <button class="btn btn-primary btn-small" id="updateKeyBtn" style="margin-bottom:12px;">Update key</button>
      <div class="settings-row">
        <span class="label">Rules cached</span>
        <span class="value" id="rulesCacheTime">Never</span>
      </div>
      <button class="btn btn-outline btn-small" id="refreshRulesBtn" style="margin-top:8px;margin-bottom:12px;">Refresh rules</button>
      <div class="settings-row">
        <span class="label">API Key</span>
        <button class="btn btn-outline btn-small" id="clearKeyBtn" style="border-color:#F87171;color:#F87171;">Clear key</button>
      </div>
      <button class="btn btn-outline" id="closeSettingsBtn" style="margin-top:16px;">Close</button>
    </div>
  </div>
  <script>/* __JS__ */</script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add figma-plugin/src/ui.html
git commit -m "feat: plugin UI HTML shell with all state containers"
```

---

### Task 6: UI logic (ui.ts)

**Files:**
- Create: `figma-plugin/src/ui.ts`

- [ ] **Step 1: Create ui.ts with full UI logic**

```ts
import Anthropic from "@anthropic-ai/sdk";
import type {
  TextNodeData,
  AssessmentResult,
  RewriteSuggestion,
  SandboxMessage,
  CachedRules,
  UIState,
} from "./types";

const RULES_URL =
  "https://raw.githubusercontent.com/gregorymm/humanize-text/main/skills/humanize-text/SKILL.md";
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const MODEL = "claude-sonnet-4-6";

// ---- State ----
let apiKey = "";
let currentState: UIState = "no-api-key";
let textNodes: TextNodeData[] = [];
let assessment: AssessmentResult | null = null;
let appliedOriginals: { id: string; text: string }[] = [];
let rulesContent = "";

// ---- DOM refs ----
const $ = (id: string) => document.getElementById(id)!;
const stateEls: Record<string, HTMLElement> = {};

function initDom() {
  stateEls["no-api-key"] = $("state-no-key");
  stateEls["ready"] = $("state-ready");
  stateEls["warning"] = $("state-warning");
  stateEls["loading"] = $("state-loading");
  stateEls["error"] = $("state-error");
  stateEls["results"] = $("state-results");
}

function setState(state: UIState) {
  currentState = state;
  // Hide all states
  for (const el of Object.values(stateEls)) {
    el.classList.add("hidden");
  }
  // Show target
  if (stateEls[state]) {
    stateEls[state].classList.remove("hidden");
  }
  // Bottom bar visibility
  $("bottomBar").classList.toggle(
    "hidden",
    state !== "results" && state !== "applied"
  );
}

// ---- Storage helpers (via postMessage to sandbox) ----
// Figma clientStorage is only accessible from sandbox, so we use postMessage
// For simplicity in v1, we store the API key in the UI's own localStorage-like mechanism
// Actually, Figma plugin UI iframes can use parent.postMessage to talk to sandbox
// But for clientStorage, we need the sandbox. Let's use a simpler approach:
// The UI stores the key in a global and asks sandbox to persist/retrieve via clientStorage.

// Simplified: we'll use the Figma plugin API's built-in storage notification pattern.
// On init, sandbox sends stored key. UI uses it.

// For v1, store API key in memory and re-enter on plugin reopen.
// A production version would use clientStorage via sandbox relay.

async function loadApiKey(): Promise<string> {
  return new Promise((resolve) => {
    // Ask sandbox for stored key
    parent.postMessage({ pluginMessage: { type: "get-api-key" } }, "*");
    // Will be resolved when sandbox responds
    const handler = (event: MessageEvent) => {
      const msg = event.data.pluginMessage;
      if (msg && msg.type === "api-key-value") {
        window.removeEventListener("message", handler);
        resolve(msg.key || "");
      }
    };
    window.addEventListener("message", handler);
    // Timeout fallback
    setTimeout(() => resolve(""), 500);
  });
}

function saveApiKey(key: string) {
  parent.postMessage(
    { pluginMessage: { type: "save-api-key", key } },
    "*"
  );
}

// ---- Rules fetching ----
async function fetchRules(): Promise<string> {
  // Check cache first
  const cached = localStorage.getItem("skill_rules");
  if (cached) {
    const parsed: CachedRules = JSON.parse(cached);
    if (Date.now() - parsed.fetchedAt < CACHE_MAX_AGE) {
      updateCacheDisplay(parsed.fetchedAt);
      return parsed.content;
    }
  }

  try {
    const resp = await fetch(RULES_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const content = await resp.text();
    const cacheEntry: CachedRules = { content, fetchedAt: Date.now() };
    localStorage.setItem("skill_rules", JSON.stringify(cacheEntry));
    updateCacheDisplay(cacheEntry.fetchedAt);
    return content;
  } catch (e) {
    // Fallback to stale cache
    if (cached) {
      const parsed: CachedRules = JSON.parse(cached);
      updateCacheDisplay(parsed.fetchedAt);
      return parsed.content;
    }
    throw new Error("Couldn't load assessment rules. No cached version available.");
  }
}

function updateCacheDisplay(timestamp: number) {
  const date = new Date(timestamp);
  $("rulesCacheTime").textContent = date.toLocaleDateString() + " " + date.toLocaleTimeString();
}

// ---- Claude API ----
function buildSystemPrompt(rules: string): string {
  return `You are a text assessment tool. Analyze the provided text nodes for AI writing patterns using the rules in this document.

${rules}

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
Return ONLY valid JSON. No markdown fencing, no explanation, no text before or after the JSON.`;
}

async function callClaude(nodes: TextNodeData[]): Promise<AssessmentResult> {
  const client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
  });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: buildSystemPrompt(rulesContent),
    messages: [
      {
        role: "user",
        content: JSON.stringify(
          nodes.map((n) => ({ id: n.id, name: n.name, text: n.text }))
        ),
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Try to extract JSON from the response (handle markdown fencing just in case)
  let jsonStr = text.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const result: AssessmentResult = JSON.parse(jsonStr);

  // Validate
  if (
    typeof result.humanScore !== "number" ||
    !Array.isArray(result.categories) ||
    !Array.isArray(result.rewrites)
  ) {
    throw new Error("Invalid response structure");
  }

  return result;
}

// ---- Rendering ----
function renderScorecard(result: AssessmentResult) {
  const score = result.humanScore;
  const colorClass = score >= 85 ? "green" : score >= 60 ? "yellow" : "red";

  $("scorePercent").textContent = `${score}%`;
  $("scorePercent").className = `score-percent ${colorClass}`;

  const fill = $("progressFill");
  fill.style.width = `${score}%`;
  fill.className = `progress-fill ${colorClass}`;

  const rows = $("categoryRows");
  rows.innerHTML = result.categories
    .map(
      (cat) => `
    <div class="category-row" data-category="${cat.name}">
      <span class="category-name">${cat.name}</span>
      <span class="category-score">${cat.score}/10</span>
    </div>
  `
    )
    .join("");
}

function renderRewrites(rewrites: RewriteSuggestion[]) {
  const list = $("rewriteList");

  if (rewrites.length === 0) {
    list.innerHTML = '<div class="empty-state">No issues found. Text looks human.</div>';
    $("bottomBar").classList.add("hidden");
    return;
  }

  list.innerHTML = rewrites
    .map(
      (r, i) => `
    <div class="rewrite-item" data-index="${i}" id="rewrite-${i}">
      <div class="rewrite-header">
        <a class="layer-name" data-node-id="${r.id}">${escapeHtml(findNodeName(r.id))}</a>
        <button class="btn btn-primary btn-small apply-single-btn" data-index="${i}">Apply</button>
      </div>
      <div class="rewrite-original">"${escapeHtml(truncate(r.original, 100))}"</div>
      <div class="rewrite-arrow">&#8594;</div>
      <div class="rewrite-suggested">"${escapeHtml(r.suggested)}"</div>
      <div class="rewrite-issue">${escapeHtml(r.issue)}</div>
    </div>
  `
    )
    .join("");

  $("applyAllBtn").textContent = `Apply all ${rewrites.length} rewrites`;
  $("applyAllBtn").classList.remove("hidden");
  $("undoAllBtn").classList.add("hidden");
}

function findNodeName(nodeId: string): string {
  const node = textNodes.find((n) => n.id === nodeId);
  return node ? node.name : nodeId;
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "..." : str;
}

function escapeHtml(str: string): string {
  const el = document.createElement("span");
  el.textContent = str;
  return el.innerHTML;
}

function estimateTokens(nodes: TextNodeData[]): number {
  const textChars = nodes.reduce((sum, n) => sum + n.text.length, 0);
  const systemPromptChars = rulesContent.length + 500; // overhead
  return Math.round((textChars + systemPromptChars) / 4);
}

// ---- Event handlers ----
function bindEvents() {
  // Save API key
  $("saveKeyBtn").addEventListener("click", () => {
    const key = ($("apiKeyInput") as HTMLInputElement).value.trim();
    if (!key) return;
    apiKey = key;
    saveApiKey(key);
    setState("ready");
  });

  // Assess button
  $("assessBtn").addEventListener("click", () => {
    parent.postMessage({ pluginMessage: { type: "assess" } }, "*");
    setState("loading");
    $("loadingText").textContent = "Extracting text layers...";
  });

  // Warning confirm/cancel
  $("confirmAssessBtn").addEventListener("click", () => {
    runAssessment();
  });

  $("cancelAssessBtn").addEventListener("click", () => {
    setState("ready");
  });

  // Retry on error
  $("retryBtn").addEventListener("click", () => {
    setState("ready");
  });

  // Apply all
  $("applyAllBtn").addEventListener("click", () => {
    if (!assessment) return;
    // Store originals for undo
    appliedOriginals = assessment.rewrites.map((r) => ({
      id: r.id,
      text: r.original,
    }));
    parent.postMessage(
      {
        pluginMessage: {
          type: "apply-all",
          rewrites: assessment.rewrites.map((r) => ({
            id: r.id,
            text: r.suggested,
          })),
        },
      },
      "*"
    );
  });

  // Undo all
  $("undoAllBtn").addEventListener("click", () => {
    parent.postMessage(
      {
        pluginMessage: {
          type: "undo-all",
          originals: appliedOriginals,
        },
      },
      "*"
    );
  });

  // Settings
  $("settingsBtn").addEventListener("click", () => {
    $("settingsPanel").classList.remove("hidden");
    ($("settingsKeyInput") as HTMLInputElement).value = apiKey;
  });

  $("closeSettingsBtn").addEventListener("click", () => {
    $("settingsPanel").classList.add("hidden");
  });

  $("updateKeyBtn").addEventListener("click", () => {
    const key = ($("settingsKeyInput") as HTMLInputElement).value.trim();
    if (!key) return;
    apiKey = key;
    saveApiKey(key);
    $("settingsPanel").classList.add("hidden");
  });

  $("clearKeyBtn").addEventListener("click", () => {
    apiKey = "";
    saveApiKey("");
    $("settingsPanel").classList.add("hidden");
    setState("no-api-key");
  });

  $("toggleKeyVisibility").addEventListener("click", () => {
    const input = $("settingsKeyInput") as HTMLInputElement;
    const btn = $("toggleKeyVisibility");
    if (input.type === "password") {
      input.type = "text";
      btn.textContent = "Hide";
    } else {
      input.type = "password";
      btn.textContent = "Show";
    }
  });

  $("refreshRulesBtn").addEventListener("click", async () => {
    localStorage.removeItem("skill_rules");
    try {
      rulesContent = await fetchRules();
    } catch (e) {
      // ignore, will show error on next assess
    }
  });

  // Delegate clicks on rewrite items
  $("rewriteList").addEventListener("click", (e) => {
    const target = e.target as HTMLElement;

    // Layer name click -> select node
    if (target.classList.contains("layer-name")) {
      const nodeId = target.dataset.nodeId;
      if (nodeId) {
        parent.postMessage(
          { pluginMessage: { type: "select-node", nodeId } },
          "*"
        );
      }
    }

    // Individual apply
    if (target.classList.contains("apply-single-btn")) {
      const idx = parseInt(target.dataset.index || "0");
      const rewrite = assessment?.rewrites[idx];
      if (!rewrite) return;
      // Store for undo
      if (!appliedOriginals.find((o) => o.id === rewrite.id)) {
        appliedOriginals.push({ id: rewrite.id, text: rewrite.original });
      }
      parent.postMessage(
        {
          pluginMessage: {
            type: "apply-rewrite",
            nodeId: rewrite.id,
            newText: rewrite.suggested,
          },
        },
        "*"
      );
      // Update button immediately
      target.outerHTML = '<span class="applied-check">&#10003;</span>';
    }
  });
}

// ---- Assessment flow ----
async function runAssessment() {
  setState("loading");
  $("loadingText").textContent = `Assessing ${textNodes.length} text layers...`;
  appliedOriginals = [];

  try {
    rulesContent = await fetchRules();
    assessment = await callClaude(textNodes);
    renderScorecard(assessment);
    renderRewrites(assessment.rewrites);
    setState("results");
  } catch (e: any) {
    let msg = "Something went wrong. Try again.";
    const errStr = e.message || String(e);
    if (errStr.includes("401") || errStr.includes("authentication")) {
      msg = "Invalid API key. Check console.anthropic.com";
    } else if (errStr.includes("429") || errStr.includes("rate")) {
      msg = "Rate limited by Anthropic. Wait a moment and try again.";
    } else if (errStr.includes("fetch") || errStr.includes("network") || errStr.includes("Failed")) {
      msg = "Can't reach the API. Check your connection.";
    } else if (errStr.includes("JSON") || errStr.includes("parse")) {
      msg = "Couldn't parse assessment results. Try again.";
    } else if (errStr.includes("rules")) {
      msg = errStr;
    }
    $("errorText").textContent = msg;
    setState("error");
  }
}

// ---- Messages from sandbox ----
window.addEventListener("message", (event) => {
  const msg: SandboxMessage = event.data.pluginMessage;
  if (!msg) return;

  if (msg.type === "text-nodes") {
    textNodes = msg.nodes;
    if (msg.totalCount === 0) {
      $("errorText").textContent = "No text layers found in selection or page.";
      setState("error");
      return;
    }
    if (msg.totalCount >= 50) {
      const tokens = estimateTokens(msg.nodes);
      $("warningText").textContent = `Found ${msg.totalCount} text layers. This will use approximately ${tokens.toLocaleString()} tokens. Continue?`;
      setState("warning");
      return;
    }
    runAssessment();
  }

  if (msg.type === "apply-result") {
    if (msg.applied > 0) {
      $("successBanner").classList.remove("hidden");
      $("successText").textContent = `${msg.applied} layer${msg.applied > 1 ? "s" : ""} updated`;
      if (msg.failed.length > 0) {
        $("successText").textContent += ` (${msg.failed.length} skipped)`;
      }
    }
    $("applyAllBtn").classList.add("hidden");
    $("undoAllBtn").classList.remove("hidden");
  }

  if (msg.type === "undo-result") {
    $("successBanner").classList.add("hidden");
    $("undoAllBtn").classList.add("hidden");
    $("applyAllBtn").classList.remove("hidden");
    appliedOriginals = [];
    // Re-render rewrite buttons
    if (assessment) {
      renderRewrites(assessment.rewrites);
    }
  }
});

// ---- Init ----
async function init() {
  initDom();
  bindEvents();

  // Load API key from sandbox storage
  apiKey = await loadApiKey();
  if (apiKey) {
    setState("ready");
  } else {
    setState("no-api-key");
  }
}

init();
```

- [ ] **Step 2: Add clientStorage relay to main.ts**

Add these message handlers to the `figma.ui.onmessage` callback in `figma-plugin/src/main.ts`, inside the existing handler function, after the `cancel` handler:

```ts
  if (msg.type === "get-api-key") {
    const key = await figma.clientStorage.getAsync("anthropic_api_key");
    figma.ui.postMessage({ type: "api-key-value", key: key || "" });
  }

  if (msg.type === "save-api-key") {
    await figma.clientStorage.setAsync("anthropic_api_key", (msg as any).key);
  }
```

Also update the UIMessage type in `types.ts` to include these:

```ts
export type UIMessage =
  | { type: "assess" }
  | { type: "assess-confirmed" }
  | { type: "apply-rewrite"; nodeId: string; newText: string }
  | { type: "apply-all"; rewrites: { id: string; text: string }[] }
  | { type: "undo-all"; originals: { id: string; text: string }[] }
  | { type: "select-node"; nodeId: string }
  | { type: "cancel" }
  | { type: "get-api-key" }
  | { type: "save-api-key"; key: string };
```

- [ ] **Step 3: Build and verify**

Run: `cd figma-plugin && npm run build`
Expected: "Build complete" with `dist/main.js` and `dist/ui.html` created

- [ ] **Step 4: Commit**

```bash
git add figma-plugin/src/ui.ts figma-plugin/src/main.ts figma-plugin/src/types.ts
git commit -m "feat: full UI logic with Claude API integration, scoring, and rewrite flow"
```

---

### Task 7: Build, test in Figma, and commit dist

- [ ] **Step 1: Build the plugin**

Run: `cd figma-plugin && npm run build`
Expected: `dist/main.js` and `dist/ui.html` exist

- [ ] **Step 2: Test in Figma**

1. Open Figma desktop app
2. Go to Plugins > Development > Import plugin from manifest
3. Select `figma-plugin/manifest.json`
4. Open a file with text layers
5. Run the plugin from Plugins > Development > Humanize Text
6. Verify: API key input screen appears
7. Enter an Anthropic API key
8. Verify: "Assess selected layers" button appears
9. Select some text layers and click Assess
10. Verify: scorecard + rewrites appear
11. Click "Apply" on one rewrite, verify text updates
12. Click "Undo all", verify text restores

- [ ] **Step 3: Commit everything**

```bash
git add figma-plugin/
git commit -m "feat: Humanize Text Figma plugin v1 complete"
```

- [ ] **Step 4: Push to GitHub**

```bash
git push origin main
```

---

### Task 8: Update README with Figma plugin section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add Figma plugin section to README**

Add after the "Usage" section:

```markdown
## Figma Plugin

Assess and rewrite text layers directly in Figma.

### Install

1. Download or clone this repo
2. In Figma desktop: Plugins > Development > Import plugin from manifest
3. Select `figma-plugin/manifest.json`

### Setup

1. Get an API key from [console.anthropic.com](https://console.anthropic.com)
2. Open the plugin and paste your key
3. Your key is stored locally and never leaves your machine

### How it works

1. Select text layers (or leave empty for whole page)
2. Click "Assess"
3. View scorecard and suggested rewrites
4. Click "Apply" per item or "Apply all"
5. "Undo all" to revert

Uses Claude Sonnet for assessment. You pay Anthropic directly per API call with your own key.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add Figma plugin installation and usage to README"
git push origin main
```
