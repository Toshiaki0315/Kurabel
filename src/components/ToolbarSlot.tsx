import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** App 上部ツールバー内の差し込み先。未設定ならその場に描画する。 */
export const ToolbarSlotContext = createContext<HTMLElement | null>(null);

export function ToolbarPortal({ children }: { children: ReactNode }) {
  const slot = useContext(ToolbarSlotContext);
  return slot ? createPortal(children, slot) : <div className="bar">{children}</div>;
}

/** 画面右端の細い帯（差分位置バー）の差し込み先。 */
export const OverviewSlotContext = createContext<HTMLElement | null>(null);

export function OverviewPortal({ children }: { children: ReactNode }) {
  const slot = useContext(OverviewSlotContext);
  return slot ? createPortal(children, slot) : <>{children}</>;
}
