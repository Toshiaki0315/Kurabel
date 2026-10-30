import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

const comparePaths = vi.fn();
const pickPath = vi.fn();
let dropHandler: (paths: string[], side: "left" | "right") => void;
vi.mock("./api", () => ({
  comparePaths: (...a: unknown[]) => comparePaths(...a),
  pickPath: (...a: unknown[]) => pickPath(...a),
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

async function choose(label: string, path: string, directory = false) {
  pickPath.mockResolvedValueOnce(path);
  fireEvent.click(screen.getByText(`${label}の${directory ? "フォルダ" : "ファイル"}…`));
  await screen.findByText(path);
}

describe("App", () => {
  beforeEach(() => {
    comparePaths.mockReset();
    pickPath.mockReset();
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
    expect(await screen.findByText("再比較")).toBeInTheDocument();
  });

  it("ignores a cancelled dialog", async () => {
    pickPath.mockResolvedValueOnce(null);
    render(<App />);
    fireEvent.click(screen.getByText("左のファイル…"));
    await waitFor(() => expect(pickPath).toHaveBeenCalled());
    expect(screen.getAllByText(/未選択/)).toHaveLength(2);
  });

  it("renders binary results and passes the selected mode", async () => {
    comparePaths.mockResolvedValue({ kind: "binary", left_size: 1, right_size: 1, rows: [] });
    render(<App />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "word" } });
    await choose("左", "/l.bin");
    await choose("右", "/r.bin");
    expect(await screen.findByText(/バイナリ比較/)).toBeInTheDocument();
    expect(comparePaths).toHaveBeenCalledWith("/l.bin", "/r.bin", "word");
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
    act(() => dropHandler(["/c"], "right"));
    await screen.findByText("/c");
    expect(screen.getByText("/a")).toBeInTheDocument();
    act(() => dropHandler(["/d"], "left"));
    await screen.findByText("/d");
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
