// 「初回デモをもう再生したか」をlocalStorageに記録する時のキー名。
// main.ts(本番の判定)とdebugPanel.ts(デモをリセットするボタン)の両方から参照するので、
// 表記ゆれが起きないようここに1つだけ定義している。
export const INTRO_DEMO_STORAGE_KEY = 'caretman.introDemoShown';
