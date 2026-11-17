export type CodeEditorShortcut = "run" | "stop" | "undo" | "redo";

interface CodeEditorShortcutInput {
  altKey: boolean;
  code: string;
  ctrlKey: boolean;
  isComposing: boolean;
  key: string;
  metaKey: boolean;
    shiftKey?: boolean;
}

export function getCodeEditorShortcut({
  altKey,
  code,
  ctrlKey,
  isComposing,
  key,
  metaKey,
    shiftKey = false,
}: CodeEditorShortcutInput): CodeEditorShortcut | null {
  if (altKey || isComposing || (!ctrlKey && !metaKey)) return null;
    if (key.toLowerCase() === "z" || code === "KeyZ") return shiftKey ? "redo" : "undo";
    if (ctrlKey && !metaKey && (key.toLowerCase() === "y" || code === "KeyY")) return "redo";
  if (key === "Enter") return "run";
  if (key === "." || code === "Period") return "stop";
  return null;
}
