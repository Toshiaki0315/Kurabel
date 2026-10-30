import { vi } from "vitest";

const pickReportPath = vi.fn();
const writeReport = vi.fn();
vi.mock("../api", () => ({
  pickReportPath: (...a: unknown[]) => pickReportPath(...a),
  writeReport: (...a: unknown[]) => writeReport(...a),
}));

import { saveReport } from "./saveReport";

describe("saveReport", () => {
  beforeEach(() => {
    pickReportPath.mockReset();
    writeReport.mockReset();
  });

  it("writes the report where the user chose", async () => {
    pickReportPath.mockResolvedValue("/out/r.html");
    writeReport.mockResolvedValue(undefined);
    expect(await saveReport("<p/>", "a.html")).toBe(true);
    expect(pickReportPath).toHaveBeenCalledWith("a.html");
    expect(writeReport).toHaveBeenCalledWith("/out/r.html", "<p/>");
  });

  it("returns false without writing when the dialog is cancelled", async () => {
    pickReportPath.mockResolvedValue(null);
    expect(await saveReport("<p/>", "a.html")).toBe(false);
    expect(writeReport).not.toHaveBeenCalled();
  });

  it("lets write failures propagate", async () => {
    pickReportPath.mockResolvedValue("/out/r.html");
    writeReport.mockRejectedValue(new Error("denied"));
    await expect(saveReport("<p/>", "a.html")).rejects.toThrow("denied");
  });
});
