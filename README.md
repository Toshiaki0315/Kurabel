# クラベル (Kurabel)

Tauri v2 + Rust + TypeScript (React) で作られた、デスクトップ向けの Diff & Merge ツールです。
2つのファイル／フォルダを左右に並べて比較し、差分の確認・編集・マージ・保存ができます。

## 主な機能

- **入力**: ドラッグ＆ドロップ、またはフォルダアイコンのダイアログでファイル／フォルダを指定
  - 1つだけ開いた場合は、比較せずにそのまま閲覧できます（閲覧専用）
  - 各ペイン右端の ✕ で閉じる、「履歴」から最近の組み合わせを開き直す
- **テキスト比較**
  - 行番号つきの左右2ペイン表示、差分のハイライト（行単位／単語単位）
  - 空白の違い・大文字小文字の違いを無視するオプション
  - その場で編集でき、入力が止まると自動で再比較。`⌘S` / `Ctrl+S` でカーソルのあるペインを保存
  - 差分ブロックごとの「→」「←」で、反対側へ内容を反映（マージ）。`⌘Z` で元に戻せます
  - 前後の差分へジャンプ（`F7` / `Shift+F7`）、編集モードでは左右のスクロールが連動
- **文字コード**: UTF-8 / UTF-16（BOM対応）/ Shift_JIS / EUC-JP / ISO-2022-JP を自動判定し、保存時は元の文字コードで書き戻します。改行コード（LF / CRLF / CR / 混在）も表示します
- **バイナリ比較**: 16進ダンプ＋ASCII を並べて表示し、差分バイトをハイライト（読み取り専用）
- **フォルダ比較**: 追加・削除・変更をツリーで表示。開閉、状態での絞り込み、名前検索ができ、ファイルをクリックするとその比較画面へ移動します
- **安全面**: 未保存の変更があるまま別のファイルを開く・閉じる・ウィンドウを閉じるときは確認を表示

## 動作環境

- macOS（開発・動作確認はこちら）。Windows / Linux でもビルドできる構成です（Tauri v2）

## 開発環境の構築

### 必要なもの

| ツール | バージョン | 備考 |
| --- | --- | --- |
| Node.js | 20 以上 | npm を含む |
| Rust | stable | [rustup](https://rustup.rs/) で導入 |
| Tauri の前提パッケージ | - | 下記を参照 |
| cargo-llvm-cov | 任意 | Rust のカバレッジ測定用 |

**macOS**: Xcode Command Line Tools

```bash
xcode-select --install
```

**Linux (Debian/Ubuntu 系)**:

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

**Windows**: Microsoft C++ Build Tools と WebView2 ランタイム（詳細は [Tauri のドキュメント](https://v2.tauri.app/start/prerequisites/)）

カバレッジを測定する場合のみ:

```bash
rustup component add llvm-tools-preview
cargo install cargo-llvm-cov
```

### セットアップ

```bash
git clone https://github.com/Toshiaki0315/Kurabel.git
cd Kurabel
npm ci
```

## 開発用コマンド

`make` のターゲットで実行できます。

| コマンド | 内容 |
| --- | --- |
| `make dev` | Tauri アプリを開発モードで起動（初回は Rust のコンパイルに数分かかります） |
| `make web` | フロントエンドだけを Vite で起動（ブラウザ確認用。Tauri の機能は使えません） |
| `make test` | フロントエンド (Vitest) と Rust (`cargo test`) のテストを実行 |
| `make coverage` | カバレッジを測定（フロント・Rust とも 90% 以上が必須） |
| `make app` | リリースビルド |
| `make dmg` | macOS 用の DMG を作成 |

個別に実行する場合:

```bash
npm run test                 # フロントエンドのテスト
npm run coverage             # フロントエンドのカバレッジ
mkdir -p dist && cd src-tauri && cargo test   # Rust のテスト
```

## ビルド

```bash
make app     # 全プラットフォーム共通のリリースビルド
make dmg     # macOS の DMG
```

成果物は `src-tauri/target/release/bundle/` に出力されます。

> 現在、コード署名・公証（macOS）には対応していません。配布する場合は別途 Apple Developer の署名設定が必要です。

## 使い方

1. 左右のパス表示欄にファイル／フォルダをドラッグ＆ドロップするか、右端のフォルダアイコンから選びます
   - 1つ目は左、2つ目は右に入ります。両方埋まっている場合は、ドロップした位置のペインが置き換わります
2. 2つ揃うと自動で比較されます
   - **テキスト**: ツールバーの「編集」で編集モードに切り替えます。ハイライトと行番号は編集中も表示されます
   - **マージ**: 表示モードで、差分ブロックの中央にある「→」（左から右へ）「←」（右から左へ）を押します
   - **保存**: 変更したペインの「保存」ボタン、または `⌘S` / `Ctrl+S`
   - **フォルダ**: ツリーのファイル名をクリックするとファイル比較へ移動し、「← ディレクトリ比較に戻る」で戻ります
3. 「⚙ 設定」（メニューの「クラベル → 設定…」、`⌘,`）で、ハイライト方式と、比較時に無視する違いを変更できます

### キーボードショートカット

| キー | 動作 |
| --- | --- |
| `⌘S` / `Ctrl+S` | カーソルのあるペインを保存 |
| `⌘Z` / `⌘⇧Z`（`⌘Y` / `Ctrl+Y`） | 元に戻す / やり直す |
| `F7` / `Shift+F7` | 次の差分 / 前の差分へ移動 |
| `⌘,` | 設定を開く |

### 制限事項

- 読み込めるファイルサイズは1ファイル 4MB までです
- フォルダ比較は 50,000 エントリ・深さ 64 までで、シンボリックリンクは辿りません
- 文字コードの判定は推測で、手動で切り替える機能はまだありません
- 空白・大文字小文字の無視は、テキストファイルの比較にのみ適用されます

## 構成

```
src/            フロントエンド (React + TypeScript)
  components/   画面コンポーネント (テキスト/バイナリ/フォルダ比較、設定ダイアログ ほか)
  lib/          ロジック (マージ計算、ツリー構築、履歴・設定の保存 ほか)
src-tauri/      バックエンド (Rust + Tauri v2)
  src/textdiff.rs   テキスト差分（行/単語、比較オプション）
  src/textcodec.rs  文字コードの判定・変換
  src/binary.rs     16進ダンプ差分
  src/dirdiff.rs    フォルダ比較
  src/compare.rs    パスの判定と比較の振り分け、保存
  src/commands.rs   Tauri コマンド
docs/           開発用ドキュメント（タスク一覧 ほか）
```

## セキュリティ

- Tauri の権限は最小限（`src-tauri/capabilities/default.json`）にしています
- CSP を設定し、保存は既存の通常ファイルへの上書きのみで、新規作成はしません
- ファイルサイズ・エントリ数に上限を設けています

## CI

GitHub Actions で、フロントエンド・Rust のテストとカバレッジ（90% 以上）を検証しています（`.github/workflows/ci.yml`）。

## リポジトリ

[https://github.com/Toshiaki0315/Kurabel.git](https://github.com/Toshiaki0315/Kurabel.git)
