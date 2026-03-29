export interface TextNodeData {
  id: string;
  name: string;
  text: string;
  layerPath: string;
}

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

export type SandboxMessage =
  | { type: "text-nodes"; nodes: TextNodeData[]; totalCount: number }
  | { type: "apply-result"; success: boolean; applied: number; failed: string[]; error?: string }
  | { type: "undo-result"; success: boolean; restored: number }
  | { type: "api-key-value"; key: string }
  | { type: "selection-changed"; hasSelection: boolean; count: number };

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

export type UIState =
  | "no-api-key"
  | "ready"
  | "warning"
  | "loading"
  | "results"
  | "applied"
  | "error";

export interface CachedRules {
  content: string;
  fetchedAt: number;
}
