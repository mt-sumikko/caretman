/**
 * このファイルの役割(ざっくり):
 * 本文のテキストを.txt/.mdファイルとしてダウンロードさせる処理。
 * サーバーには何も送らず、ブラウザの中だけでファイルを組み立ててダウンロードさせている。
 */

export function defaultFilename(ext: string): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `untitled_${y}${m}${d}.${ext}`;
}

export function downloadText(content: string, ext: string, mime: string): void {
  if (content.trim() === '') return; // 空文字を保存しようとするのを防ぐ
  // テキストを一旦「ファイルのようなもの(Blob)」に変換し、それを指す一時的なURLを作る
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  // 見えないダウンロードリンクを作って即座にクリックさせる、というのがブラウザでファイルを
  // 保存させる時の定番のやり方
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultFilename(ext);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url); // 使い終わった一時URLは残さず解放する
}
