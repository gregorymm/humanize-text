import Anthropic from "@anthropic-ai/sdk";
import type {
  TextNodeData,
  AssessmentResult,
  CategoryScore,
  RewriteSuggestion,
  SandboxMessage,
  UIMessage,
  UIState,
  CachedRules,
} from "./types";
import { BUNDLED_RULES } from "./bundled-rules";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const RULES_URL =
  "https://raw.githubusercontent.com/gregorymm/humanize-text/main/skills/humanize-text/SKILL.md";
const RULES_CACHE_KEY = "humanize_rules_cache";
const RULES_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MODEL = "claude-sonnet-4-6";
const TOKEN_WARNING_THRESHOLD = 8000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let currentState: UIState = "no-api-key";
let apiKey = "";
let rulesContent = "";
let lastResult: AssessmentResult | null = null;
let textNodes: TextNodeData[] = [];
let originals: Map<string, string> = new Map(); // nodeId -> original text
let appliedSet: Set<string> = new Set(); // nodeIds that have been applied
let hasAppliedAny = false;

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const $ = (id: string) => document.getElementById(id)!;

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------
const stateContainers: Record<string, string> = {
  "no-api-key": "state-no-key",
  ready: "state-ready",
  warning: "state-warning",
  loading: "state-loading",
  results: "state-results",
  applied: "state-results", // reuse results view
  error: "state-error",
};

function setState(next: UIState) {
  currentState = next;

  // Hide all state containers
  for (const id of Object.values(stateContainers)) {
    $(id).classList.add("hidden");
  }

  // Show target
  const targetId = stateContainers[next];
  if (targetId) {
    $(targetId).classList.remove("hidden");
  }

  // Bottom bar visibility
  const bottomBar = $("bottomBar");
  if (next === "results" || next === "applied") {
    bottomBar.classList.remove("hidden");
  } else {
    bottomBar.classList.add("hidden");
  }

  // Apply/Undo button states
  if (next === "results") {
    $("applyAllBtn").classList.remove("hidden");
    if (hasAppliedAny) {
      $("undoAllBtn").classList.remove("hidden");
    } else {
      $("undoAllBtn").classList.add("hidden");
    }
  }
  if (next === "applied") {
    $("applyAllBtn").classList.add("hidden");
    $("undoAllBtn").classList.remove("hidden");
  }
}

// ---------------------------------------------------------------------------
// Sandbox messaging
// ---------------------------------------------------------------------------
function postToSandbox(msg: UIMessage) {
  parent.postMessage({ pluginMessage: msg }, "*");
}

// ---------------------------------------------------------------------------
// API key management
// ---------------------------------------------------------------------------
function loadApiKey(): Promise<string> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(""), 500);

    const handler = (e: MessageEvent) => {
      const msg = e.data?.pluginMessage as SandboxMessage | undefined;
      if (msg && msg.type === "api-key-value") {
        clearTimeout(timeout);
        window.removeEventListener("message", handler);
        resolve(msg.key);
      }
    };

    window.addEventListener("message", handler);
    postToSandbox({ type: "get-api-key" });
  });
}

function saveApiKey(key: string) {
  apiKey = key;
  postToSandbox({ type: "save-api-key", key });
}

function clearApiKey() {
  apiKey = "";
  postToSandbox({ type: "save-api-key", key: "" });
  setState("no-api-key");
  ($("apiKeyInput") as HTMLInputElement).value = "";
}

// ---------------------------------------------------------------------------
// Rules fetching with cache
// ---------------------------------------------------------------------------
function getCachedRules(): CachedRules | null {
  try {
    const raw = localStorage.getItem(RULES_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedRules;
  } catch {
    return null;
  }
}

function setCachedRules(content: string) {
  const cached: CachedRules = { content, fetchedAt: Date.now() };
  localStorage.setItem(RULES_CACHE_KEY, JSON.stringify(cached));
}

async function fetchRules(forceRefresh = false): Promise<string> {
  const cached = getCachedRules();

  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < RULES_TTL_MS) {
    return cached.content;
  }

  try {
    const resp = await fetch(RULES_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const content = await resp.text();
    setCachedRules(content);
    return content;
  } catch {
    // Fallback to stale cache, then bundled rules
    if (cached) return cached.content;
    return BUNDLED_RULES;
  }
}

function updateRulesCacheDisplay() {
  const cached = getCachedRules();
  const el = $("rulesCacheTime");
  if (cached) {
    const date = new Date(cached.fetchedAt);
    el.textContent = date.toLocaleString();
  } else {
    el.textContent = "Never";
  }
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------
function estimateTokens(nodes: TextNodeData[], systemPrompt: string): number {
  const totalChars = nodes.reduce((sum, n) => sum + n.text.length, 0);
  return Math.round((totalChars + systemPrompt.length) / 4);
}

// ---------------------------------------------------------------------------
// Claude API call
// ---------------------------------------------------------------------------
function buildSystemPrompt(rules: string): string {
  return `You are a text assessment tool. Analyze the provided text nodes for AI writing patterns using the rules in this document.

${rules}

Return a JSON object with this exact structure:
{
  "humanScore": <number 0-100>,
  "categories": [{"name": "<name>", "score": <1-10>, "flags": <count>}],
  "rewrites": [{"id": "<node id>", "original": "<text>", "suggested": "<rewrite>", "issue": "<description>"}]
}

Only include nodes that need changes in rewrites. Nodes scoring 9/10+ can be omitted.
Return ONLY valid JSON. No markdown fencing, no explanation.`;
}

async function callClaude(
  nodes: TextNodeData[],
  systemPrompt: string
): Promise<AssessmentResult> {
  const client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
  });

  const userMessage = JSON.stringify(
    nodes.map((n) => ({ id: n.id, name: n.name, text: n.text }))
  );

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text in Claude response");
  }

  let raw = textBlock.text.trim();
  // Strip markdown fencing if present
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    return JSON.parse(raw) as AssessmentResult;
  } catch {
    throw new Error("Could not parse Claude response as JSON. Try again.");
  }
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
function mapError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "Invalid API key. Check your key in Settings.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Rate limited. Wait a moment and try again.";
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Network error. Check your internet connection.";
  }
  if (err instanceof Anthropic.APIError) {
    return `API error (${err.status}): ${err.message}`;
  }
  if (err instanceof Error) {
    if (err.message.includes("parse")) return err.message;
    if (err.message.includes("rules")) return err.message;
    return err.message;
  }
  return "An unexpected error occurred. Try again.";
}

function showError(err: unknown) {
  $("errorText").textContent = mapError(err);
  setState("error");
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function scoreColor(score: number): string {
  if (score >= 85) return "green";
  if (score >= 60) return "yellow";
  return "red";
}

function renderScorecard(result: AssessmentResult) {
  const color = scoreColor(result.humanScore);

  const scoreEl = $("scorePercent");
  scoreEl.textContent = `${result.humanScore}%`;
  scoreEl.className = `score-percent ${color}`;

  const fillEl = $("progressFill");
  fillEl.style.width = `${result.humanScore}%`;
  fillEl.className = `progress-fill ${color}`;

  const rowsEl = $("categoryRows");
  rowsEl.innerHTML = "";
  for (const cat of result.categories) {
    const row = document.createElement("div");
    row.className = "category-row";
    row.innerHTML = `
      <span class="category-name">${escapeHtml(cat.name)}</span>
      <span class="category-score">${cat.score}/10${cat.flags > 0 ? ` (${cat.flags} flags)` : ""}</span>
    `;
    rowsEl.appendChild(row);
  }
}

function renderRewrites(rewrites: RewriteSuggestion[]) {
  const listEl = $("rewriteList");
  listEl.innerHTML = "";

  if (rewrites.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No rewrites needed — this text looks human.</div>';
    return;
  }

  for (const rw of rewrites) {
    const item = document.createElement("div");
    item.className = "rewrite-item";
    item.dataset.nodeId = rw.id;

    const isApplied = appliedSet.has(rw.id);
    const node = textNodes.find((n) => n.id === rw.id);
    const layerName = node ? node.name : rw.id;

    item.innerHTML = `
      <div class="rewrite-header">
        <a class="layer-name" data-select-node="${rw.id}">${escapeHtml(layerName)}</a>
        ${
          isApplied
            ? '<span class="applied-check">&#10003;</span>'
            : `<button class="btn btn-outline btn-small" data-apply-single="${rw.id}">Apply</button>`
        }
      </div>
      <div class="rewrite-original">${escapeHtml(rw.original)}</div>
      <div class="rewrite-arrow">&#8595;</div>
      <div class="rewrite-suggested">${escapeHtml(rw.suggested)}</div>
      <div class="rewrite-issue">${escapeHtml(rw.issue)}</div>
    `;
    listEl.appendChild(item);
  }
}

function renderResults(result: AssessmentResult) {
  lastResult = result;
  renderScorecard(result);
  renderRewrites(result.rewrites);
  $("successBanner").classList.add("hidden");
  setState("results");
}

function showSuccess(text: string) {
  $("successText").textContent = text;
  $("successBanner").classList.remove("hidden");
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Assessment flow
// ---------------------------------------------------------------------------
async function startAssessment() {
  setState("loading");
  $("loadingText").textContent = "Scanning text layers...";

  // Request text nodes from sandbox
  postToSandbox({ type: "assess" });
}

async function handleTextNodes(nodes: TextNodeData[], totalCount: number) {
  textNodes = nodes;

  if (nodes.length === 0) {
    $("errorText").textContent = "No text layers found. Select some layers and try again.";
    setState("error");
    return;
  }

  try {
    // Fetch rules
    $("loadingText").textContent = "Loading rules...";
    rulesContent = await fetchRules();
    updateRulesCacheDisplay();

    const systemPrompt = buildSystemPrompt(rulesContent);
    const estimated = estimateTokens(nodes, systemPrompt);

    // Show warning if large
    if (estimated > TOKEN_WARNING_THRESHOLD) {
      $("warningText").textContent = `This will send ~${estimated.toLocaleString()} tokens (${nodes.length} text layers). Continue?`;
      setState("warning");
      return;
    }

    await runAssessment(nodes, systemPrompt);
  } catch (err) {
    showError(err);
  }
}

async function runAssessment(nodes: TextNodeData[], systemPrompt?: string) {
  setState("loading");
  $("loadingText").textContent = "Analyzing with Claude...";

  try {
    if (!systemPrompt) {
      rulesContent = await fetchRules();
      systemPrompt = buildSystemPrompt(rulesContent);
    }

    // Reset applied state for new assessment
    appliedSet.clear();
    originals.clear();
    hasAppliedAny = false;

    // Store originals
    for (const node of nodes) {
      originals.set(node.id, node.text);
    }

    const result = await callClaude(nodes, systemPrompt);
    renderResults(result);
  } catch (err) {
    showError(err);
  }
}

// ---------------------------------------------------------------------------
// Apply / Undo
// ---------------------------------------------------------------------------
function applySingle(nodeId: string) {
  if (!lastResult) return;
  const rw = lastResult.rewrites.find((r) => r.id === nodeId);
  if (!rw) return;

  postToSandbox({ type: "apply-rewrite", nodeId: rw.id, newText: rw.suggested });
  appliedSet.add(nodeId);
  hasAppliedAny = true;
  renderRewrites(lastResult.rewrites);
  $("undoAllBtn").classList.remove("hidden");
}

function applyAll() {
  if (!lastResult) return;
  const unapplied = lastResult.rewrites.filter((r) => !appliedSet.has(r.id));
  if (unapplied.length === 0) return;

  postToSandbox({
    type: "apply-all",
    rewrites: unapplied.map((r) => ({ id: r.id, text: r.suggested })),
  });

  for (const rw of unapplied) {
    appliedSet.add(rw.id);
  }
  hasAppliedAny = true;
}

function undoAll() {
  if (originals.size === 0) return;
  postToSandbox({
    type: "undo-all",
    originals: Array.from(originals.entries()).map(([id, text]) => ({ id, text })),
  });
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------
function setupEventListeners() {
  // Save key (initial setup)
  $("saveKeyBtn").addEventListener("click", () => {
    const input = $("apiKeyInput") as HTMLInputElement;
    const key = input.value.trim();
    if (!key) return;
    saveApiKey(key);
    setState("ready");
  });

  // Assess button
  $("assessBtn").addEventListener("click", () => {
    startAssessment();
  });

  // Warning confirm/cancel
  $("confirmAssessBtn").addEventListener("click", async () => {
    const systemPrompt = buildSystemPrompt(rulesContent);
    await runAssessment(textNodes, systemPrompt);
  });

  $("cancelAssessBtn").addEventListener("click", () => {
    setState("ready");
  });

  // Retry
  $("retryBtn").addEventListener("click", () => {
    startAssessment();
  });

  // Apply all
  $("applyAllBtn").addEventListener("click", () => {
    applyAll();
  });

  // Undo all
  $("undoAllBtn").addEventListener("click", () => {
    undoAll();
  });

  // Delegated click handlers for rewrite list
  $("rewriteList").addEventListener("click", (e) => {
    const target = e.target as HTMLElement;

    // Select node
    const selectAttr = target.dataset.selectNode || target.closest("[data-select-node]")?.getAttribute("data-select-node");
    if (selectAttr) {
      postToSandbox({ type: "select-node", nodeId: selectAttr });
      return;
    }

    // Apply single
    const applyAttr = target.dataset.applySingle || target.closest("[data-apply-single]")?.getAttribute("data-apply-single");
    if (applyAttr) {
      applySingle(applyAttr);
    }
  });

  // Settings
  $("settingsBtn").addEventListener("click", () => {
    ($("settingsKeyInput") as HTMLInputElement).value = apiKey;
    updateRulesCacheDisplay();
    $("settingsPanel").classList.remove("hidden");
  });

  $("closeSettingsBtn").addEventListener("click", () => {
    $("settingsPanel").classList.add("hidden");
  });

  $("updateKeyBtn").addEventListener("click", () => {
    const input = $("settingsKeyInput") as HTMLInputElement;
    const key = input.value.trim();
    if (!key) return;
    saveApiKey(key);
    $("settingsPanel").classList.add("hidden");
    if (currentState === "no-api-key") {
      setState("ready");
    }
  });

  $("clearKeyBtn").addEventListener("click", () => {
    clearApiKey();
    $("settingsPanel").classList.add("hidden");
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
    try {
      rulesContent = await fetchRules(true);
      updateRulesCacheDisplay();
    } catch (err) {
      // Silently fall back
    }
  });
}

// ---------------------------------------------------------------------------
// Messages from sandbox
// ---------------------------------------------------------------------------
function handleSandboxMessage(msg: SandboxMessage) {
  switch (msg.type) {
    case "api-key-value":
      // Handled by loadApiKey promise; this handles subsequent updates
      break;

    case "text-nodes":
      handleTextNodes(msg.nodes, msg.totalCount);
      break;

    case "apply-result":
      if (msg.success && lastResult) {
        const applied = msg.applied;
        if (applied === lastResult.rewrites.length || appliedSet.size === lastResult.rewrites.length) {
          renderRewrites(lastResult.rewrites);
          setState("applied");
          showSuccess(`Applied ${applied} rewrite${applied !== 1 ? "s" : ""}`);
        } else {
          renderRewrites(lastResult.rewrites);
          if (msg.failed.length > 0) {
            showSuccess(`Applied ${applied}, ${msg.failed.length} failed`);
          } else {
            showSuccess(`Applied ${applied} rewrite${applied !== 1 ? "s" : ""}`);
          }
        }
      }
      break;

    case "undo-result":
      if (msg.success) {
        appliedSet.clear();
        hasAppliedAny = false;
        if (lastResult) {
          renderRewrites(lastResult.rewrites);
        }
        setState("results");
        showSuccess(`Restored ${msg.restored} layer${msg.restored !== 1 ? "s" : ""}`);
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function init() {
  setupEventListeners();

  window.addEventListener("message", (e) => {
    const msg = e.data?.pluginMessage as SandboxMessage | undefined;
    if (msg) handleSandboxMessage(msg);
  });

  // Load API key from sandbox storage
  const storedKey = await loadApiKey();
  if (storedKey) {
    apiKey = storedKey;
    setState("ready");
  } else {
    setState("no-api-key");
  }
}

init();
