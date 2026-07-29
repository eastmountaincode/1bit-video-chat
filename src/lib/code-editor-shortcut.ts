export type CodeEditorShortcut = "run" | "stop";

interface CodeEditorShortcutInput {
  altKey: boolean;
  code: string;
  ctrlKey: boolean;
  isComposing: boolean;
  key: string;
  metaKey: boolean;
}

export function getCodeEditorShortcut({
  altKey,
  code,
  ctrlKey,
  isComposing,
  key,
  metaKey,
}: CodeEditorShortcutInput): CodeEditorShortcut | null {
  if (altKey || isComposing || (!ctrlKey && !metaKey)) return null;
  if (key === "Enter") return "run";
  if (key === "." || code === "Period") return "stop";
  return null;
}
