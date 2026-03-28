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

async function applyRewrite(nodeId: string, newText: string): Promise<boolean> {
  const node = figma.getNodeById(nodeId);
  if (!node || node.type !== "TEXT") return false;
  const textNode = node as TextNode;
  const segments = textNode.getStyledTextSegments(["fontName", "fontSize", "fontWeight", "italic", "textDecoration", "letterSpacing", "lineHeight", "fills"]);

  if (segments.length <= 1) {
    const fontName = textNode.fontName;
    if (fontName === figma.mixed) {
      await figma.loadFontAsync(segments[0].fontName);
    } else {
      await figma.loadFontAsync(fontName);
    }
    textNode.characters = newText;
    return true;
  }

  const uniqueFonts = new Set<string>();
  for (const seg of segments) { uniqueFonts.add(JSON.stringify(seg.fontName)); }
  for (const fontStr of uniqueFonts) { await figma.loadFontAsync(JSON.parse(fontStr)); }

  const totalLen = textNode.characters.length;
  const styleRanges = segments.map((seg) => ({
    startRatio: seg.start / totalLen, endRatio: seg.end / totalLen,
    fontName: seg.fontName, fontSize: seg.fontSize, fills: seg.fills,
  }));

  textNode.characters = newText;
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
    figma.ui.postMessage({ type: "text-nodes", nodes, totalCount: nodes.length });
  }
  if (msg.type === "apply-rewrite") {
    const success = await applyRewrite(msg.nodeId, msg.newText);
    figma.ui.postMessage({ type: "apply-result", success, applied: success ? 1 : 0, failed: success ? [] : [msg.nodeId] });
  }
  if (msg.type === "apply-all") {
    let applied = 0; const failed: string[] = [];
    for (const rewrite of msg.rewrites) {
      const ok = await applyRewrite(rewrite.id, rewrite.text);
      if (ok) applied++; else failed.push(rewrite.id);
    }
    if (applied > 0) {
      const firstNode = figma.getNodeById(msg.rewrites[0].id);
      if (firstNode) figma.viewport.scrollAndZoomIntoView([firstNode]);
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
  if (msg.type === "cancel") { figma.closePlugin(); }
  if (msg.type === "get-api-key") {
    const key = await figma.clientStorage.getAsync("anthropic_api_key");
    figma.ui.postMessage({ type: "api-key-value", key: key || "" });
  }
  if (msg.type === "save-api-key") {
    await figma.clientStorage.setAsync("anthropic_api_key", (msg as any).key);
  }
};
