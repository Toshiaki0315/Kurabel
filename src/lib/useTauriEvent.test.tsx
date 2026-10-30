import { render } from "@testing-library/react";
import { vi } from "vitest";

let emit: () => void;
const unlisten = vi.fn();
const listen = vi.fn((_name: string, h: () => void) => {
  emit = h;
  return Promise.resolve(unlisten);
});
vi.mock("@tauri-apps/api/event", () => ({ listen: (n: string, h: () => void) => listen(n, h) }));

import { useTauriEvent } from "./useTauriEvent";

function Probe({ cb }: { cb: () => void }) {
  useTauriEvent("open-settings", cb);
  return null;
}

describe("useTauriEvent", () => {
  it("subscribes by name, forwards events and unsubscribes", async () => {
    const cb = vi.fn();
    const { unmount } = render(<Probe cb={cb} />);
    await Promise.resolve();
    expect(listen).toHaveBeenCalledWith("open-settings", cb);
    emit();
    expect(cb).toHaveBeenCalledTimes(1);
    unmount();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalled();
  });

  it("unsubscribes immediately when unmounted before registration resolves", async () => {
    unlisten.mockClear();
    render(<Probe cb={vi.fn()} />).unmount();
    await Promise.resolve();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
