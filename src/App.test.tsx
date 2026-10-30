import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

const comparePaths = vi.fn();
const pickPath = vi.fn();
const pathKind = vi.fn();
const confirmDiscard = vi.fn();
let closeGuard: () => Promise<boolean>;
let menuOpenSettings: () => void;
let dropHandler: (paths: string[], side: "left" | "right") => void;
vi.mock("./api", () => ({
  comparePaths: (...a: unknown[]) => comparePaths(...a),
  pickPath: (...a: unknown[]) => pickPath(...a),
  pathKind: (...a: unknown[]) => pathKind(...a),
  confirmDiscard: (...a: unknown[]) => confirmDiscard(...a),
  saveText: vi.fn().mockResolvedValue(undefined),
  diffText: vi.fn().mockResolvedValue([]),
}));
vi.mock("./lib/useTauriEvent", () => ({
  useTauriEvent: (name: string, h: () => void) => {
    if (name === "open-settings") menuOpenSettings = h;
  },
}));
vi.mock("./lib/useCloseGuard", () => ({
  useCloseGuard: (f: () => Promise<boolean>) => {
    closeGuard = f;
  },
}));
vi.mock("./lib/useDragDrop", () => ({
  useDragDrop: (h: typeof dropHandler) => {
    dropHandler = h;
  },
}));

import App from "./App";
import { DEFAULT_OPTIONS as OPTS } from "./types";

const textResult = {
  kind: "text",
  left_text: "a",
  right_text: "b",
  left_encoding: { name: "Shift_JIS", bom: false },
  right_encoding: { name: "UTF-8", bom: true },
  left_eol: "CRLF",
  right_eol: "LF",
  rows: [],
};
const dirResult = {
  kind: "directory",
  entries: [{ path: "f.txt", left: "file", right: "file", status: "modified" }],
};

// 1つ目: 種別を尋ねられるので選ぶ。2つ目: 1つ目と同じ種別のダイアログが自動で開く。
/** フォルダ同士の比較は dirResult、その中の f.txt を開いたときだけ child() の結果を返す */
const dirThen = (child: () => Promise<unknown>) => async (l: string | null, r: string | null) =>
  l && r && l.endsWith("/f.txt") ? child() : dirResult;

async function choose(label: string, path: string, directory = false) {
  pickPath.mockResolvedValueOnce(path);
  pathKind.mockResolvedValue(directory ? "directory" : "file");
  const firstPick = screen.queryAllByText(/未選択/).length === 2;
  fireEvent.click(screen.getByRole("button", { name: `${label}を選択` }));
  if (firstPick) fireEvent.click(await screen.findByText(directory ? "フォルダ" : "ファイル"));
  await screen.findByText(path);
}

describe("App", () => {
  beforeEach(() => {
    comparePaths.mockReset();
    pickPath.mockReset();
    pathKind.mockReset();
    confirmDiscard.mockReset();
    localStorage.clear();
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
    await waitFor(() => expect(comparePaths).toHaveBeenCalledWith("/l.txt", "/r.txt", "line", OPTS));
    expect(await screen.findByText("編集")).toBeInTheDocument();
    expect(screen.getByText("Shift_JIS / CRLF")).toBeInTheDocument();
    expect(screen.getByText("UTF-8 (BOM) / LF")).toBeInTheDocument();
  });

  it("ignores a cancelled dialog", async () => {
    pickPath.mockResolvedValueOnce(null);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "左を選択" }));
    fireEvent.click(await screen.findByText("ファイル"));
    await waitFor(() => expect(pickPath).toHaveBeenCalledWith(false));
    expect(screen.getAllByText(/未選択/)).toHaveLength(2);
  });

  it("renders binary results and passes the selected mode", async () => {
    comparePaths.mockResolvedValue({ kind: "binary", left_size: 185955, right_size: 30833, rows: [] });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    fireEvent.click(screen.getByLabelText("単語単位"));
    fireEvent.click(screen.getByText("閉じる"));
    await choose("左", "/l.bin");
    await choose("右", "/r.bin");
    expect(await screen.findByText(/バイナリ比較/)).toBeInTheDocument();
    expect(screen.getByText("185955 バイト")).toBeInTheDocument();
    expect(screen.getByText("30833 バイト")).toBeInTheDocument();
    expect(comparePaths).toHaveBeenCalledWith("/l.bin", "/r.bin", "word", OPTS);
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
    await act(async () => dropHandler(["/a", "/b"], "left"));
    await screen.findByText("/a");
    expect(screen.getByText("/b")).toBeInTheDocument();
    await act(async () => dropHandler(["/c"], "left"));
    await screen.findByText("/c");
    expect(screen.getByText("/b")).toBeInTheDocument();
    expect(screen.queryByText("/a")).toBeNull();
  });

  it("opens a file from the directory view and returns", async () => {
    comparePaths.mockImplementation(dirThen(async () => textResult));
    render(<App />);
    await choose("左", "/L", true);
    await choose("右", "/R", true);
    fireEvent.click((await screen.findAllByText("f.txt"))[0]);
    await waitFor(() => expect(comparePaths).toHaveBeenLastCalledWith("/L/f.txt", "/R/f.txt", "line", OPTS));
    expect(await screen.findByText("← ディレクトリ比較に戻る")).toBeInTheDocument();
    fireEvent.click(screen.getByText("← ディレクトリ比較に戻る"));
    expect(await screen.findByLabelText("表示する差分")).toBeInTheDocument();
  });

  it("shows an error when opening a child file fails", async () => {
    comparePaths.mockImplementation(dirThen(() => Promise.reject("too big")));
    render(<App />);
    await choose("左", "/L", true);
    await choose("右", "/R", true);
    fireEvent.click((await screen.findAllByText("f.txt"))[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("too big");
  });

  it("passes the compare options and re-diffs on toggle", async () => {
    comparePaths.mockResolvedValue(textResult);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    fireEvent.click(screen.getByLabelText("空白の違い"));
    fireEvent.click(screen.getByLabelText("大文字小文字の違い"));
    fireEvent.click(screen.getByText("閉じる"));
    await choose("左", "/l.txt");
    await choose("右", "/r.txt");
    await waitFor(() =>
      expect(comparePaths).toHaveBeenCalledWith("/l.txt", "/r.txt", "line", { ignore_whitespace: true, ignore_case: true }),
    );
    // 設定はダイアログを開き直しても保持され、保存される
    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    expect(screen.getByLabelText("空白の違い")).toBeChecked();
    fireEvent.click(screen.getByLabelText("空白の違い"));
    expect(screen.getByLabelText("空白の違い")).not.toBeChecked();
    expect(JSON.parse(localStorage.getItem("kurabel.settings")!).options.ignore_whitespace).toBe(false);
  });

  it("opens the settings dialog from the menu bar event and closes it with Escape", () => {
    render(<App />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => menuOpenSettings());
    expect(screen.getByRole("dialog", { name: "設定" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("restores saved settings on startup", () => {
    localStorage.setItem("kurabel.settings", JSON.stringify({ mode: "word", options: { ignore_whitespace: false, ignore_case: true } }));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    expect(screen.getByLabelText("単語単位")).toBeChecked();
    expect(screen.getByLabelText("大文字小文字の違い")).toBeChecked();
  });

  describe("unsaved changes", () => {
    async function openDirty() {
      // 実際のバックエンドと同様に、呼び出しごとに新しい結果オブジェクトを返す
      comparePaths.mockImplementation(async () => ({ ...textResult }));
      render(<App />);
      await choose("左", "/l.txt");
      await choose("右", "/r.txt");
      fireEvent.click(await screen.findByText("編集"));
      fireEvent.change(screen.getByLabelText("左のテキスト"), { target: { value: "edited" } });
    }

    it("asks before dropping new files and keeps the current ones when declined", async () => {
      await openDirty();
      confirmDiscard.mockResolvedValueOnce(false);
      await act(async () => dropHandler(["/x.txt", "/y.txt"], "left"));
      expect(confirmDiscard).toHaveBeenCalledTimes(1);
      expect(screen.getByText("/l.txt")).toBeInTheDocument();
      confirmDiscard.mockResolvedValueOnce(true);
      await act(async () => dropHandler(["/x.txt", "/y.txt"], "left"));
      expect(await screen.findByText("/x.txt")).toBeInTheDocument();
    });

    it("asks before opening the picker, and the guard is released after discarding", async () => {
      await openDirty();
      pickPath.mockClear(); // 最初の選択で呼ばれた分を除く
      confirmDiscard.mockResolvedValueOnce(false);
      fireEvent.click(screen.getByRole("button", { name: "左を選択" }));
      await waitFor(() => expect(confirmDiscard).toHaveBeenCalled());
      expect(pickPath).not.toHaveBeenCalled();
      confirmDiscard.mockResolvedValueOnce(true);
      pathKind.mockResolvedValue("file");
      pickPath.mockResolvedValueOnce("/new.txt");
      fireEvent.click(screen.getByRole("button", { name: "左を選択" }));
      await screen.findByText("/new.txt");
      // 古い編集内容が破棄され、新しい比較に置き換わるまで待つ
      await waitFor(() => expect(screen.queryByText("未保存の変更あり")).toBeNull());
      // 破棄後は編集中でなくなるので、確認なしで操作できる
      confirmDiscard.mockClear();
      pickPath.mockResolvedValueOnce("/newer.txt");
      fireEvent.click(screen.getByRole("button", { name: "左を選択" }));
      await screen.findByText("/newer.txt");
      expect(confirmDiscard).not.toHaveBeenCalled();
    });

    it("guards closing the window only while there are unsaved changes", async () => {
      comparePaths.mockResolvedValue(textResult);
      render(<App />);
      expect(await closeGuard()).toBe(true);
      expect(confirmDiscard).not.toHaveBeenCalled();
      await choose("左", "/l.txt");
      await choose("右", "/r.txt");
      fireEvent.click(await screen.findByText("編集"));
      fireEvent.change(screen.getByLabelText("左のテキスト"), { target: { value: "edited" } });
      confirmDiscard.mockResolvedValueOnce(false);
      expect(await closeGuard()).toBe(false);
    });

    it("asks before leaving a file opened from a directory comparison", async () => {
      comparePaths.mockImplementation(dirThen(async () => textResult));
      render(<App />);
      await choose("左", "/L", true);
      await choose("右", "/R", true);
      fireEvent.click((await screen.findAllByText("f.txt"))[0]);
      fireEvent.click(await screen.findByText("編集"));
      fireEvent.change(screen.getByLabelText("左のテキスト"), { target: { value: "edited" } });
      confirmDiscard.mockResolvedValueOnce(false);
      fireEvent.click(screen.getByText("← ディレクトリ比較に戻る"));
      await waitFor(() => expect(confirmDiscard).toHaveBeenCalled());
      expect(screen.getByText("← ディレクトリ比較に戻る")).toBeInTheDocument();
      confirmDiscard.mockResolvedValueOnce(true);
      fireEvent.click(screen.getByText("← ディレクトリ比較に戻る"));
      expect(await screen.findByLabelText("表示する差分")).toBeInTheDocument();
    });
  });

  describe("history", () => {
    it("records compared pairs and reopens one from the history", async () => {
      comparePaths.mockResolvedValue(textResult);
      render(<App />);
      await choose("左", "/dir/a.txt");
      await choose("右", "/dir/b.txt");
      await screen.findByText("編集");
      const select = screen.getByLabelText("履歴");
      expect(screen.getByText("a.txt ⇄ b.txt")).toBeInTheDocument();
      await act(async () => dropHandler(["/c.txt", "/d.txt"], "left"));
      await screen.findByText("/c.txt");
      fireEvent.change(select, { target: { value: "1" } }); // 2番目 = 最初の組
      await screen.findByText("/dir/a.txt");
      fireEvent.change(select, { target: { value: "9" } }); // 存在しない項目は無視
      expect(screen.getByText("/dir/a.txt")).toBeInTheDocument();
    });
  });

  describe("closing a pane", () => {
    it("clears only that side; the remaining file stays visible on its own", async () => {
      comparePaths.mockImplementation(async () => ({ ...textResult }));
      render(<App />);
      expect(screen.getByRole("button", { name: "左を閉じる" })).toBeDisabled();
      await choose("左", "/l.txt");
      await choose("右", "/r.txt");
      await screen.findByText("編集");
      fireEvent.click(screen.getByRole("button", { name: "左を閉じる" }));
      await waitFor(() => expect(screen.queryByText("/l.txt")).toBeNull());
      expect(screen.getByText("/r.txt")).toBeInTheDocument();
      await waitFor(() => expect(comparePaths).toHaveBeenLastCalledWith(null, "/r.txt", "line", OPTS));
      expect(await screen.findByText("UTF-8 (BOM) / LF")).toBeInTheDocument();
      expect(screen.queryByText("編集")).toBeNull(); // 1つだけなら閲覧専用
      // 閉じた側に新しいファイルを開き直せる
      await choose("左", "/new.txt");
      await waitFor(() => expect(comparePaths).toHaveBeenLastCalledWith("/new.txt", "/r.txt", "line", OPTS));
      // 両方閉じると案内に戻る
      fireEvent.click(screen.getByRole("button", { name: "左を閉じる" }));
      await waitFor(() => expect(screen.queryByText("/new.txt")).toBeNull());
      fireEvent.click(screen.getByRole("button", { name: "右を閉じる" }));
      expect(await screen.findByText(/ドロップしてください/)).toBeInTheDocument();
    });

    it("asks before closing a pane with unsaved changes", async () => {
      comparePaths.mockImplementation(async () => ({ ...textResult }));
      render(<App />);
      await choose("左", "/l.txt");
      await choose("右", "/r.txt");
      fireEvent.click(await screen.findByText("編集"));
      fireEvent.change(screen.getByLabelText("左のテキスト"), { target: { value: "edited" } });
      confirmDiscard.mockResolvedValueOnce(false);
      fireEvent.click(screen.getByRole("button", { name: "右を閉じる" }));
      await waitFor(() => expect(confirmDiscard).toHaveBeenCalled());
      expect(screen.getByText("/r.txt")).toBeInTheDocument();
      confirmDiscard.mockResolvedValueOnce(true);
      fireEvent.click(screen.getByRole("button", { name: "右を閉じる" }));
      await waitFor(() => expect(screen.queryByText("/r.txt")).toBeNull());
    });

    it("dismisses a pending file/folder choice when closing or dropping", async () => {
      comparePaths.mockImplementation(async () => ({ ...textResult }));
      render(<App />);
      await act(async () => dropHandler(["/l.txt"], "left"));
      await screen.findByText("/l.txt");
      fireEvent.click(screen.getByRole("button", { name: "左を選択" }));
      expect(await screen.findByText("ファイル")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "左を閉じる" }));
      await waitFor(() => expect(screen.queryByText("/l.txt")).toBeNull());
      expect(screen.queryByText("ファイル")).toBeNull();
      // ドロップでも選択表示は消える
      fireEvent.click(screen.getByRole("button", { name: "左を選択" }));
      expect(await screen.findByText("ファイル")).toBeInTheDocument();
      await act(async () => dropHandler(["/x.txt"], "left"));
      await waitFor(() => expect(screen.queryByText("ファイル")).toBeNull());
    });
  });

  describe("a single opened file", () => {
    it("is only displayed: no comparison controls, editing or saving", async () => {
      comparePaths.mockResolvedValue(textResult);
      render(<App />);
      await act(async () => dropHandler(["/only.txt"], "right"));
      // 空いている左が先に埋まる
      await waitFor(() => expect(comparePaths).toHaveBeenCalledWith("/only.txt", null, "line", OPTS));
      expect(await screen.findByText("Shift_JIS / CRLF")).toBeInTheDocument();
      expect(screen.queryByText("UTF-8 (BOM) / LF")).toBeNull(); // 空の右側には文字コードを出さない
      for (const label of ["編集", "差分", "保存"]) expect(screen.queryByText(new RegExp(label))).toBeNull();
      // 履歴には2つ揃ったときだけ記録する
      expect(screen.queryByText(/⇄/)).toBeNull();
    });
  });
});
