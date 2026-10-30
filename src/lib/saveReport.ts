import { pickReportPath, writeReport } from "../api";

/** 保存先をダイアログで選んでレポートを書き出す。キャンセルなら false。失敗時は例外を投げる。 */
export async function saveReport(html: string, defaultName: string): Promise<boolean> {
  const path = await pickReportPath(defaultName);
  if (!path) return false;
  await writeReport(path, html);
  return true;
}
