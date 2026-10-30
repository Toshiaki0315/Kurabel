import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/**
 * ドロップ位置が左右どちらの半分か。
 * macOS ではドロップ位置が論理座標で届くためそのまま使い、それ以外は物理座標としてスケール補正する。
 */
export function dropSide(x: number, width: number, isMac: boolean, dpr: number): "left" | "right" {
  const logicalX = isMac ? x : x / (dpr || 1);
  return logicalX < width / 2 ? "left" : "right";
}

/** ウィンドウへのファイルドロップを監視し、パスとドロップ側（左右）を通知する。 */
export function useDragDrop(onDrop: (paths: string[], side: "left" | "right") => void): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const isMac = /Mac/i.test(navigator.userAgent);
        const side = dropSide(event.payload.position.x, window.innerWidth, isMac, window.devicePixelRatio);
        onDrop(event.payload.paths, side);
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
