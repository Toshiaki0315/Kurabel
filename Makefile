.PHONY: dev web app dmg test coverage

# 開発起動 (Tauriアプリ。Viteはbeforeを経由して自動起動)
dev:
	mkdir -p dist
	npm run tauri dev

# フロントエンドのみ (ブラウザ確認用。Tauri APIは使えない)
web:
	npm run dev

# アプリケーションのビルド
app:
	npm run build
	npm run tauri build

# DMGのビルド (macOS)
dmg:
	npm run tauri build -- --bundles dmg

# テスト実行
test:
	npm run test
	mkdir -p dist
	cd src-tauri && cargo test

# カバレッジ測定
coverage:
	npm run coverage
	mkdir -p dist
	cd src-tauri && cargo llvm-cov --all-features --workspace --ignore-filename-regex '(main|lib)\.rs' --fail-under-lines 90
