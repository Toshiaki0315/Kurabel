import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** ウィンドウを閉じようとしたとき、confirmLeave が false を返したら閉じない。 */
export function useCloseGuard(confirmLeave: () => Promise<boolean>): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (!(await confirmLeave())) event.preventDefault();
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [confirmLeave]);
}
