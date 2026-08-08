import type { ReactNode } from "react";
import "./board.css";

/**
 * The board owns its own chrome tokens (board.css) and is committed dark, so it
 * gets a layout of its own rather than pushing route-specific colours into the
 * global stylesheet. The `dark` class is applied on the shell itself, not here,
 * so the tokens travel with the element that uses them.
 */
export default function BoardLayout({ children }: { children: ReactNode }) {
  return children;
}
