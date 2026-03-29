import type { TextNodeData, UIMessage } from "./types";

figma.showUI(__html__, { width: 340, height: 560, themeColors: true });

function extractTextNodes(nodes: readonly SceneNode[]): TextNodeData[] {
  const result: TextNodeData[] = [];
  function walk(node: SceneNode, path: string) {
    if (node.type === "TEXT") {
      result.push({ id: node.id, name: node.name, text: node.characters, layerPath: path });
    }
    if ("children" in node) {
      for (const child of node.children) {
        walk(child, path ? `${path} > ${node.name}` : node.name);
      }
    }
  }
  for (const node of nodes) { walk(node, ""); }
  return result;
}

function getTextNodes(): TextNodeData[] {
  const selection = figma.currentPage.selection;
  if (selection.length > 0) return extractTextNodes(selection);
  return extractTextNodes(figma.currentPage.children);
}

async function applyRewrite(nodeId: string, newText: string): Promise<{ success: boolean; error?: string }> {
  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) return { success: false, error: `Node ${nodeId} not found` };
    if (node.type !== "TEXT") return { success: false, error: `Node ${nodeId} is not a text layer` };

    const textNode = node as TextNode;

    // Load all fonts used in this text node
    const segments = textNode.getStyledTextSegments(["fontName"]);
    const uniqueFonts = new Map<string, FontName>();
    for (const seg of segments) {
      const key = JSON.stringify(seg.fontName);
      if (!uniqueFonts.has(key)) uniqueFonts.set(key, seg.fontName);
    }

    for (const font of uniqueFonts.values()) {
      await figma.loadFontAsync(font);
    }

    // Set the text
    textNode.characters = newText;
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message || String(e) };
  }
}

// Track last known selection to detect changes
let lastSelectionIds: string[] = [];

function checkSelectionChange() {
  const currentIds = figma.currentPage.selection.map(n => n.id).sort();
  const changed = currentIds.length !== lastSelectionIds.length ||
    currentIds.some((id, i) => id !== lastSelectionIds[i]);

  if (changed) {
    lastSelectionIds = currentIds;
    figma.ui.postMessage({ type: "selection-changed", hasSelection: currentIds.length > 0, count: currentIds.length });
  }
}

// Listen for selection changes
figma.on("selectionchange", checkSelectionChange);

figma.ui.onmessage = async (msg: UIMessage) => {
  if (msg.type === "assess" || msg.type === "assess-confirmed") {
    const nodes = getTextNodes();
    lastSelectionIds = figma.currentPage.selection.map(n => n.id).sort();
    figma.ui.postMessage({ type: "text-nodes", nodes, totalCount: nodes.length });
  }

  if (msg.type === "apply-rewrite") {
    const result = await applyRewrite(msg.nodeId, msg.newText);
    figma.ui.postMessage({
      type: "apply-result",
      success: result.success,
      applied: result.success ? 1 : 0,
      failed: result.success ? [] : [msg.nodeId],
      error: result.error,
    });
  }

  if (msg.type === "apply-all") {
    let applied = 0;
    const failed: string[] = [];
    const errors: string[] = [];
    for (const rewrite of msg.rewrites) {
      const result = await applyRewrite(rewrite.id, rewrite.text);
      if (result.success) {
        applied++;
      } else {
        failed.push(rewrite.id);
        if (result.error) errors.push(result.error);
      }
    }
    if (applied > 0) {
      const firstNode = await figma.getNodeByIdAsync(msg.rewrites[0].id);
      if (firstNode) figma.viewport.scrollAndZoomIntoView([firstNode]);
    }
    figma.ui.postMessage({
      type: "apply-result",
      success: applied > 0,
      applied,
      failed,
      error: errors.length > 0 ? errors.join("; ") : undefined,
    });
  }

  if (msg.type === "undo-all") {
    let restored = 0;
    for (const orig of msg.originals) {
      const result = await applyRewrite(orig.id, orig.text);
      if (result.success) restored++;
    }
    figma.ui.postMessage({ type: "undo-result", success: true, restored });
  }

  if (msg.type === "select-node") {
    const node = await figma.getNodeByIdAsync(msg.nodeId);
    if (node && "type" in node) {
      figma.currentPage.selection = [node as SceneNode];
      figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
    }
  }

  if (msg.type === "cancel") { figma.closePlugin(); }

  if (msg.type === "get-api-key") {
    const key = await figma.clientStorage.getAsync("anthropic_api_key");
    figma.ui.postMessage({ type: "api-key-value", key: key || "" });
  }

  if (msg.type === "save-api-key") {
    await figma.clientStorage.setAsync("anthropic_api_key", (msg as any).key);
  }
};
