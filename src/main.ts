import './style.css';
import { CaretmanEditor } from './editor';
import { defaultFilename, downloadTxt, TXT_MIME } from './download';
import { INTRO_DEMO_STORAGE_KEY } from './introDemo';
import { Autosaver, contentToHtml, loadSavedContent, shouldShowAutosaveNotice } from './autosave';
import { delay } from './utils';
import { Toast } from './toast';

/**
 * このファイルの役割(ざっくり):
 * ページが読み込まれた時に最初に実行される、いわば「起動処理」をまとめたファイル。
 * index.html内のボタンや表示エリアをJSから掴んで、それぞれに動作を紐付けている。
 * - CaretmanEditor(editor.ts)を作って本文の入力欄として起動する
 * - 前回の続きがあれば復元し、なければ初回デモを再生する
 * - 自動保存(autosave.ts)を仕込み、初回だけ案内トーストを出す
 * - ダウンロードボタン(PC)、共有/ダウンロードボタン(SP)にクリック時の動作を割り当てる
 * - 開発中だけ(npm run dev)デバッグパネルを読み込む
 * ここに書かれているのは「画面のどの部品が押されたら何をするか」の配線であり、
 * 実際の細かい処理(保存・ダウンロード等)はそれぞれ別ファイルの関数を呼び出しているだけ。
 */

/** id指定でDOM要素を取得するための小さなヘルパー。見つからなければ分かりやすいエラーで落とす */
function requireEl<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  return el as unknown as T;
}

const figureEl = requireEl<HTMLElement>('figure');
const svgEl = figureEl.querySelector('svg');
if (!svgEl) throw new Error('#figure 内に svg が見つかりません');

const editor = new CaretmanEditor({
  editor: requireEl('editor'),
  wrap: requireEl('wrap'),
  placeholder: requireEl('placeholder'),
  figure: figureEl,
  renderer: {
    svg: svgEl,
    cleanGroup: requireEl('clean-group'),
    roughGroup: requireEl('rough-group'),
    pHead: requireEl('p-head'),
    pBody: requireEl('p-body'),
    pArms: requireEl('p-arms'),
    pLegs: requireEl('p-legs'),
  },
});
editor.init();

const autosaver = new Autosaver(() => editor.getPlainText());
// 初回デモが打ち込んでいる文字は保存しない(途中で閉じると、次に開いた時にデモの文が本文として残ってしまうため)
editor.setOnTextChanged(() => {
  if (!editor.isIntroDemoActive()) autosaver.scheduleSave();
});

const toast = new Toast(requireEl('toast'));

// 自動保存の初回案内は、デモや最初の入力と被らないよう「ひと息ついたタイミング」まで待って出す
const NOTICE_MIN_DELAY_MS = 1200;

// 保存済みの内容があれば復元し、無ければ(かつ初回だけ)導入デモを再生する
void (async () => {
  const savedContent = loadSavedContent();
  if (savedContent) {
    editor.restoreContent(contentToHtml(savedContent));
    await delay(NOTICE_MIN_DELAY_MS);
  } else {
    const INTRO_DEMO_TEXT = 'いっしょに書いてこ〜！';
    let ranDemo = false;
    try {
      if (!localStorage.getItem(INTRO_DEMO_STORAGE_KEY)) {
        localStorage.setItem(INTRO_DEMO_STORAGE_KEY, '1');
        ranDemo = true;
        await editor.runIntroDemo(INTRO_DEMO_TEXT);
      }
    } catch {
      // プライベートブラウジング等でlocalStorageが使えない場合はデモをスキップする
    }
    if (!ranDemo) await delay(NOTICE_MIN_DELAY_MS);
  }

  if (shouldShowAutosaveNotice()) toast.show('入力内容はこのブラウザに自動保存されます');
})();

// 本文が空の時にボタンを押しても、空のファイルを渡すのではなく「書くとできること」を案内する
// (disabledにしないのは、押せない理由が伝わらず、押した時に案内を出すこともできなくなるため)
const EMPTY_DOWNLOAD_HINT = 'なにか書くと、.txtファイルでダウンロードできます';
const EMPTY_SHARE_HINT = 'なにか書くと、ほかのアプリへ共有できます';

requireEl<HTMLButtonElement>('btn-dl').addEventListener('click', () => {
  const text = editor.getPlainText();
  if (!text.trim()) {
    toast.show(EMPTY_DOWNLOAD_HINT, 3000);
    return;
  }
  downloadTxt(text);
});

const SHARE_ICON_SVG = `<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M252.31-100Q222-100 201-121q-21-21-21-51.31v-375.38Q180-578 201-599q21-21 51.31-21h72.31q12.76 0 21.38 8.62 8.61 8.61 8.61 21.38T346-568.62q-8.62 8.62-21.38 8.62h-72.31q-4.62 0-8.46 3.85-3.85 3.84-3.85 8.46v375.38q0 4.62 3.85 8.46 3.84 3.85 8.46 3.85h455.38q4.62 0 8.46-3.85 3.85-3.84 3.85-8.46v-375.38q0-4.62-3.85-8.46-3.84-3.85-8.46-3.85h-72.31q-12.76 0-21.38-8.62-8.61-8.61-8.61-21.38t8.61-21.38q8.62-8.62 21.38-8.62h72.31Q738-620 759-599q21 21 21 51.31v375.38Q780-142 759-121q-21 21-51.31 21H252.31Zm206.31-238.62Q450-347.23 450-360v-411.23l-52.92 52.92q-8.93 8.93-20.89 8.81-11.96-.11-21.27-9.42-8.69-9.31-9-21.08-.3-11.77 9-21.07l99.77-99.77q5.62-5.62 11.85-7.93 6.23-2.3 13.46-2.3t13.46 2.3q6.23 2.31 11.85 7.93l99.77 99.77q8.3 8.3 8.5 20.57.19 12.27-8.5 21.58-9.31 9.31-21.39 9.31-12.07 0-21.38-9.31L510-771.23V-360q0 12.77-8.62 21.38Q492.77-330 480-330t-21.38-8.62Z"/></svg>`;

/** PCのChrome/Edge等もnavigator.shareを持つため、機能検出だけでなく実機かどうかも見て判定する */
function isMobileDevice(): boolean {
  const uaData = (navigator as unknown as { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData && typeof uaData.mobile === 'boolean') return uaData.mobile;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

{
  // SPで打ったテキストは、ファイルで欲しいというより他のアプリへ転記したいニーズの方が強いと想定し、
  // 実機のSPかつnavigator.share対応端末では、押したらすぐOS標準の共有シートで.txtを渡す(非対応ならダウンロード)。
  // fileだけを渡しているのは、textと同時に渡すと共有シート側の「コピー」でクリップボードに
  // 同じテキストが二重に入る不具合が確認できたため
  const spBtn = requireEl<HTMLButtonElement>('sp-dl-btn');
  const useShare = isMobileDevice() && Boolean(navigator.share);

  if (useShare) {
    spBtn.setAttribute('aria-label', '共有');
    spBtn.innerHTML = SHARE_ICON_SVG;
  }

  spBtn.addEventListener('click', () => {
    const text = editor.getPlainText();
    if (!text.trim()) {
      toast.show(useShare ? EMPTY_SHARE_HINT : EMPTY_DOWNLOAD_HINT, 3000);
      return;
    }
    if (!useShare) {
      downloadTxt(text);
      return;
    }
    const file = new File([text], defaultFilename(), { type: TXT_MIME });
    const shareData: ShareData = navigator.canShare?.({ files: [file] }) ? { files: [file] } : { text };
    navigator.share(shareData).catch(() => {
      // ユーザーがキャンセルした場合などは何もしない
    });
  });
}

// デバッグパネルは開発ビルド(npm run dev)でのみ生成する。import.meta.env.DEVは本番ビルドで
// 静的にfalseへ置き換わるため、この分岐ごとdebugPanel.ts/debug.cssは本番バンドルから除外される
if (import.meta.env.DEV) {
  void (async () => {
    const [{ DebugPanel }] = await Promise.all([import('./debugPanel'), import('./debug.css')]);
    new DebugPanel(editor);
  })();
}
