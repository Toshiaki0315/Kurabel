.PHONY: dev app dmg test coverage

# 開発用サーバー起動
dev:
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
