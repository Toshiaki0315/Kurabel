import { formatDate, formatSize } from "./format";

describe("formatSize", () => {
  it("uses readable units", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(1023)).toBe("1023 B");
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(150 * 1024)).toBe("150 KB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatSize(3 * 1024 ** 3)).toBe("3.0 GB");
    expect(formatSize(5000 * 1024 ** 4)).toBe("5000 TB"); // 最大の単位で止める
  });

  it("is empty when there is no size", () => {
    expect(formatSize(null)).toBe("");
    expect(formatSize(undefined)).toBe("");
  });
});

describe("formatDate", () => {
  it("formats local time as YYYY-MM-DD HH:mm", () => {
    const d = new Date(2024, 0, 5, 9, 7, 30);
    expect(formatDate(d.getTime() / 1000)).toBe("2024-01-05 09:07");
  });

  it("is empty when there is no date", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
  });
});
