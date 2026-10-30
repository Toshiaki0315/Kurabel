import { render, screen } from "@testing-library/react";
import { OverviewPortal, OverviewSlotContext, ToolbarPortal, ToolbarSlotContext } from "./ToolbarSlot";

describe("ToolbarPortal", () => {
  it("renders inline without a slot", () => {
    const { container } = render(<ToolbarPortal>inline</ToolbarPortal>);
    expect(container).toContainElement(screen.getByText("inline"));
  });

  it("renders into the slot when provided", () => {
    const slot = document.createElement("div");
    document.body.appendChild(slot);
    const { container } = render(
      <ToolbarSlotContext.Provider value={slot}>
        <ToolbarPortal>in-slot</ToolbarPortal>
      </ToolbarSlotContext.Provider>,
    );
    expect(slot).toContainElement(screen.getByText("in-slot"));
    expect(container).not.toContainElement(screen.getByText("in-slot"));
    slot.remove();
  });
});

describe("OverviewPortal", () => {
  it("renders inline without a slot, and into the slot when provided", () => {
    const { container, unmount } = render(<OverviewPortal>ov-inline</OverviewPortal>);
    expect(container).toContainElement(screen.getByText("ov-inline"));
    unmount();
    const slot = document.createElement("div");
    document.body.appendChild(slot);
    const r = render(
      <OverviewSlotContext.Provider value={slot}>
        <OverviewPortal>ov-slot</OverviewPortal>
      </OverviewSlotContext.Provider>,
    );
    expect(slot).toContainElement(screen.getByText("ov-slot"));
    expect(r.container).not.toContainElement(screen.getByText("ov-slot"));
    slot.remove();
  });
});
