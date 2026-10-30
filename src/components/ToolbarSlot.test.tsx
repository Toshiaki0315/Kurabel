import { render, screen } from "@testing-library/react";
import { ToolbarPortal, ToolbarSlotContext } from "./ToolbarSlot";

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
