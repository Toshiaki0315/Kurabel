import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** App 上部ツールバー内の差し込み先。未設定ならその場に描画する。 */
export const ToolbarSlotContext = createContext<HTMLElement | null>(null);

export function ToolbarPortal({ children }: { children: ReactNode }) {
  const slot = useContext(ToolbarSlotContext);
  return slot ? createPortal(children, slot) : <div className="bar">{children}</div>;
}
