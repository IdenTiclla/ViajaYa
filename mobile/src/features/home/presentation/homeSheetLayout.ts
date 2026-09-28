/**
 * Snap points of the Home bottom sheet, from its measured content.
 *
 * Collapsed it shows up to the saved places; dragged up it reveals the rest
 * (recent destinations). The sheet never exceeds the available height.
 */
export function homeSheetLayout({
  collapsedContent,
  fullContent,
  maxHeight,
}: {
  /** Height from the sheet top to the end of the saved places section. */
  collapsedContent: number;
  /** Height of the whole content; equal to `collapsedContent` when there is nothing more. */
  fullContent: number;
  maxHeight: number;
}): { height: number; peek: number } {
  const height = Math.min(Math.max(collapsedContent, fullContent), maxHeight);
  return { height, peek: Math.min(collapsedContent, height) };
}
