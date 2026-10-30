import { render } from "@testing-library/react";
import { vi } from "vitest";

type Handler = (e: { payload: Record<string, unknown> }) => void;
let handler: Handler;
const unlisten = vi.fn();
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (h: Handler) => {
      handler = h;
      return Promise.resolve(unlisten);
    },
  }),
}));

import { useDragDrop } from "./useDragDrop";

function Probe({ cb }: { cb: (p: string[], s: "left" | "right") => void }) {
  useDragDrop(cb);
  return null;
}

describe("useDragDrop", () => {
  it("reports drops with the side under the cursor and ignores other events", async () => {
    const cb = vi.fn();
    const { unmount } = render(<Probe cb={cb} />);
    await Promise.resolve();
    Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
    handler({ payload: { type: "over", position: { x: 0, y: 0 } } });
    expect(cb).not.toHaveBeenCalled();
    handler({ payload: { type: "drop", paths: ["/a"], position: { x: 100, y: 0 } } });
    expect(cb).toHaveBeenLastCalledWith(["/a"], "left");
    handler({ payload: { type: "drop", paths: ["/b"], position: { x: 900, y: 0 } } });
    expect(cb).toHaveBeenLastCalledWith(["/b"], "right");
    unmount();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalled();
  });

  it("unlistens immediately when unmounted before registration resolves", async () => {
    unlisten.mockClear();
    const { unmount } = render(<Probe cb={vi.fn()} />);
    unmount();
    await Promise.resolve();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
