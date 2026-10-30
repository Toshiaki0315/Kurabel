import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/** ウィンドウへのファイルドロップを監視し、パスとドロップ側（左右）を通知する。 */
export function useDragDrop(onDrop: (paths: string[], side: "left" | "right") => void): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const x = event.payload.position.x / (window.devicePixelRatio || 1);
        onDrop(event.payload.paths, x < window.innerWidth / 2 ? "left" : "right");
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [onDrop]);
}
