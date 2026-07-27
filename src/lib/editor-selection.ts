import type { TextSelection } from "./collaborative-text.ts";

/**
 * A controlled textarea may briefly move its DOM selection to the end when
 * React writes a new value. A selection already queued for that same commit is
 * the logical position and must take precedence over that transient DOM state.
 */
export function resolveEditorSelection(
  pending: TextSelection | null,
  focused: TextSelection | null,
  remembered: TextSelection,
): TextSelection {
  return pending ?? focused ?? remembered;
}
