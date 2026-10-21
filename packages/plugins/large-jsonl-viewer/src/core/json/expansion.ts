// Adapted from vscode-large-jsonl-viewer 9c90a874 (MIT); see THIRD_PARTY_NOTICES.
export function validExpandDepth(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= -1 && value <= 128;
}
export function expandDepth(value: unknown): number {
  return validExpandDepth(value) ? value : 2;
}
