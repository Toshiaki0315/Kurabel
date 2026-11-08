/** 編集欄（textarea）は CRLF を LF に正規化するので、状態は LF で持ち、保存時にファイル本来の改行へ戻す */
export const normalizeEol = (text: string) => text.replace(/\r\n/g, "\n");
export const eolOf = (text: string) => (text.includes("\r\n") ? "\r\n" : "\n");
export const withEol = (text: string, eol: string) => (eol === "\n" ? text : text.replace(/\n/g, eol));
