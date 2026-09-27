/**
 * このファイルの役割(ざっくり):
 * 本文のテキストを.txtファイルとしてダウンロードさせる処理。
 * サーバーには何も送らず、ブラウザの中だけでファイルを組み立ててダウンロードさせている。
 */

export const TXT_MIME = 'text/plain;charset=utf-8';

/** 保存・共有するファイル名(untitled_日付.txt) */
export function defaultFilename(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `untitled_${y}${m}${d}.txt`;
}

export function downloadTxt(content: string): void {
  if (content.trim() === '') return; // 空文字を保存しようとするのを防ぐ
  // テキストを一旦「ファイルのようなもの(Blob)」に変換し、それを指す一時的なURLを作る
  const blob = new Blob([content], { type: TXT_MIME });
  const url = URL.createObjectURL(blob);
  // 見えないダウンロードリンクを作って即座にクリックさせる、というのがブラウザでファイルを
  // 保存させる時の定番のやり方
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultFilename();
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url); // 使い終わった一時URLは残さず解放する
}
