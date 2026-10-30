import { render } from "@testing-library/react";
import { vi } from "vitest";

type Handler = (e: { preventDefault: () => void }) => Promise<void>;
let handler: Handler;
const unlisten = vi.fn();
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: (h: Handler) => {
      handler = h;
      return Promise.resolve(unlisten);
    },
  }),
}));

import { useCloseGuard } from "./useCloseGuard";

function Probe({ confirmLeave }: { confirmLeave: () => Promise<boolean> }) {
  useCloseGuard(confirmLeave);
  return null;
}

describe("useCloseGuard", () => {
  it("prevents closing unless leaving is confirmed", async () => {
    const confirmLeave = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { unmount } = render(<Probe confirmLeave={confirmLeave} />);
    await Promise.resolve();
    const prevent = vi.fn();
    await handler({ preventDefault: prevent });
    expect(prevent).toHaveBeenCalledTimes(1);
    await handler({ preventDefault: prevent });
    expect(prevent).toHaveBeenCalledTimes(1);
    unmount();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalled();
  });

  it("unlistens when unmounted before registration resolves", async () => {
    unlisten.mockClear();
    render(<Probe confirmLeave={vi.fn()} />).unmount();
    await Promise.resolve();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
