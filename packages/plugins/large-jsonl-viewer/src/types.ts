/** Public, browser-safe protocol vocabulary. */
export type IndexState =
  | 'indexing'
  | 'paused'
  | 'cancelled'
  | 'saving'
  | 'complete'
  | 'changed'
  | 'error';
export interface Progress {
  state: IndexState;
  size: number;
  scannedBytes: number;
  lines: number;
  initialReady: number;
  speed: number;
  elapsedMs: number;
  etaSeconds?: number;
  restored: boolean;
  warning?: string;
  error?: string;
}
export type JsonKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
export interface OutlineNode {
  id: string;
  parent?: string;
  key: string;
  kind: JsonKind;
  depth: number;
  start: number;
  end: number;
  line: number;
  column: number;
  count?: number;
  preview?: string;
}
export interface FoldRange {
  start: number;
  end: number;
  depth: number;
}
export interface NormalRecord {
  mode: 'normal';
  raw: string;
  formatted: string;
  valid: boolean;
  bom: boolean;
  outline: OutlineNode[];
  folds: FoldRange[];
  issues: { message: string; line: number; column: number }[];
  outlineTruncated: boolean;
  encodingError?: boolean;
}
export interface LargeNode {
  id: string;
  key: string;
  kind: JsonKind;
  start: number;
  end: number;
  count?: number;
  preview: string;
}
export interface LargePage {
  mode: 'large';
  root: LargeNode;
  children: LargeNode[];
  skip: number;
  total: number;
  scannedBytes: number;
  size: number;
  valid: boolean;
  done: boolean;
  error?: string;
}
export interface TextWindow {
  text: string;
  offset: number;
  next: number;
  total: number;
}
export interface ViewSnapshot {
  viewerId: string;
  epoch: string;
  generation: number;
  version: string;
  absolutePath: string;
  progress: Progress;
  recordLimitBytes: number;
}
export interface RecordResult {
  requestId: number;
  generation: number;
  line: number;
  token: string;
  bytes: number;
  record: NormalRecord | LargePage;
}
export interface ExportChunk {
  offset: number;
  data: Uint8Array<ArrayBuffer>;
  eof: boolean;
}
export type IndexAction = 'pause' | 'resume' | 'cancel';
