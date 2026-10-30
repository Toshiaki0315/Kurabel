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

import { dropSide, useDragDrop } from "./useDragDrop";

function Probe({ cb }: { cb: (p: string[], s: "left" | "right") => void }) {
  useDragDrop(cb);
  return null;
}

describe("dropSide", () => {
  it("uses the position as-is on macOS (logical coordinates)", () => {
    expect(dropSide(700, 1000, true, 2)).toBe("right");
    expect(dropSide(300, 1000, true, 2)).toBe("left");
  });
  it("scales physical coordinates elsewhere", () => {
    expect(dropSide(1400, 1000, false, 2)).toBe("right");
    expect(dropSide(600, 1000, false, 2)).toBe("left");
    expect(dropSide(600, 1000, false, 0)).toBe("right");
  });
});

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
