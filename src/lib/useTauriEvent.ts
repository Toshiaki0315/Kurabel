import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

/** Rust 側（メニューなど）から emit されたイベントを購読する。 */
export function useTauriEvent(name: string, handler: () => void): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen(name, handler).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [name, handler]);
}
