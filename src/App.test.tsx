import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

const comparePaths = vi.fn();
const pickPath = vi.fn();
const pathKind = vi.fn();
let dropHandler: (paths: string[], side: "left" | "right") => void;
vi.mock("./api", () => ({
  comparePaths: (...a: unknown[]) => comparePaths(...a),
  pickPath: (...a: unknown[]) => pickPath(...a),
  pathKind: (...a: unknown[]) => pathKind(...a),
  diffText: vi.fn().mockResolvedValue([]),
}));
vi.mock("./lib/useDragDrop", () => ({
  useDragDrop: (h: typeof dropHandler) => {
    dropHandler = h;
  },
}));

import App from "./App";

const textResult = { kind: "text", left_text: "a", right_text: "b", rows: [] };
const dirResult = {
  kind: "directory",
  entries: [{ path: "f.txt", left: "file", right: "file", status: "modified" }],
};

// 1つ目: 種別を尋ねられるので選ぶ。2つ目: 1つ目と同じ種別のダイアログが自動で開く。
async function choose(label: string, path: string, directory = false) {
  pickPath.mockResolvedValueOnce(path);
  pathKind.mockResolvedValue(directory ? "directory" : "file");
  fireEvent.click(screen.getByRole("button", { name: `${label}を選択` }));
  const ask = screen.queryByText(directory ? "フォルダ" : "ファイル");
  if (ask) fireEvent.click(ask);
  await screen.findByText(path);
}

describe("App", () => {
  beforeEach(() => {
    comparePaths.mockReset();
    pickPath.mockReset();
    pathKind.mockReset();
  });

  it("starts with guidance", () => {
    render(<App />);
    expect(screen.getByText(/ドロップしてください/)).toBeInTheDocument();
  });

  it("compares two picked text files", async () => {
    comparePaths.mockResolvedValue(textResult);
    render(<App />);
    await choose("左", "/l.txt");
    await choose("右", "/r.txt");
    await waitFor(() => expect(comparePaths).toHaveBeenCalledWith("/l.txt", "/r.txt", "line"));
    expect(await screen.findByText("編集")).toBeInTheDocument();
  });

  it("ignores a cancelled dialog", async () => {
    pickPath.mockResolvedValueOnce(null);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "左を選択" }));
    fireEvent.click(screen.getByText("ファイル"));
    await waitFor(() => expect(pickPath).toHaveBeenCalledWith(false));
    expect(screen.getAllByText(/未選択/)).toHaveLength(2);
  });

  it("renders binary results and passes the selected mode", async () => {
    comparePaths.mockResolvedValue({ kind: "binary", left_size: 185955, right_size: 30833, rows: [] });
    render(<App />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "word" } });
    await choose("左", "/l.bin");
    await choose("右", "/r.bin");
    expect(await screen.findByText(/バイナリ比較/)).toBeInTheDocument();
    expect(screen.getByText("185955 バイト")).toBeInTheDocument();
    expect(screen.getByText("30833 バイト")).toBeInTheDocument();
    expect(comparePaths).toHaveBeenCalledWith("/l.bin", "/r.bin", "word");
  });

  it("opens a dialog of the same kind as the other side", async () => {
    comparePaths.mockResolvedValue(dirResult);
    render(<App />);
    await choose("左", "/L", true);
    pickPath.mockResolvedValueOnce("/R");
    fireEvent.click(screen.getByRole("button", { name: "右を選択" }));
    await waitFor(() => expect(pickPath).toHaveBeenLastCalledWith(true));
  });

  it("reports an error when the other side's kind cannot be read", async () => {
    comparePaths.mockResolvedValue(textResult);
    render(<App />);
    await choose("左", "/gone");
    pathKind.mockRejectedValue("missing");
    fireEvent.click(screen.getByRole("button", { name: "右を選択" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("missing");
  });

  it("shows backend errors", async () => {
    comparePaths.mockRejectedValue("bad paths");
    render(<App />);
    await choose("左", "/l");
    await choose("右", "/r");
    expect(await screen.findByRole("alert")).toHaveTextContent("bad paths");
  });

  it("drops: two paths fill both sides, one path fills the dropped side", async () => {
    comparePaths.mockResolvedValue(textResult);
    render(<App />);
    act(() => dropHandler(["/a", "/b"], "left"));
    await screen.findByText("/a");
    expect(screen.getByText("/b")).toBeInTheDocument();
    act(() => dropHandler(["/c"], "left"));
    await screen.findByText("/c");
    expect(screen.getByText("/b")).toBeInTheDocument();
    expect(screen.queryByText("/a")).toBeNull();
  });

  it("opens a file from the directory view and returns", async () => {
    comparePaths.mockResolvedValueOnce(dirResult).mockResolvedValueOnce(textResult);
    render(<App />);
    await choose("左", "/L", true);
    await choose("右", "/R", true);
    fireEvent.click((await screen.findAllByText("f.txt"))[0]);
    await waitFor(() => expect(comparePaths).toHaveBeenLastCalledWith("/L/f.txt", "/R/f.txt", "line"));
    expect(await screen.findByText("← ディレクトリ比較に戻る")).toBeInTheDocument();
    fireEvent.click(screen.getByText("← ディレクトリ比較に戻る"));
    expect(await screen.findByText("差分のみ表示")).toBeInTheDocument();
  });

  it("shows an error when opening a child file fails", async () => {
    comparePaths.mockResolvedValueOnce(dirResult).mockRejectedValueOnce("too big");
    render(<App />);
    await choose("左", "/L", true);
    await choose("右", "/R", true);
    fireEvent.click((await screen.findAllByText("f.txt"))[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("too big");
  });
});
