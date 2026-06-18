/**
 * ALL CAPS の字幕を、簡易ルールで自然な大小文字へ整形する（ローカル・無料・即時）。
 * - 入力が大小文字混在（小文字を含む）なら、整形済みとみなして素通しする。
 * - ALL CAPS のときだけ：全体を小文字化 → 文頭/文末記号後を大文字化 → 一人称 I を大文字化。
 * 固有名詞（人名・地名など）は機械的に判定できないため小文字のままになる（既知の限界）。
 */
export function toTrueCase(line: string): string {
  if (!isAllCaps(line)) return line;
  let s = line.toLowerCase();
  // 文頭、および文末記号(. ! ?)の後の最初の英字を大文字化
  s = s.replace(/(^|[.!?]\s+)([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase());
  // 一人称 I（単独）と短縮形 I'm / I'll / I've / I'd の i を大文字化
  // （i の直後がアポストロフィでも単語境界になるため \bi\b で拾える）
  s = s.replace(/\bi\b/g, 'I');
  return s;
}

/** 英字を含み、その中に小文字が 1 つもなければ ALL CAPS とみなす。 */
function isAllCaps(line: string): boolean {
  let hasLetter = false;
  for (const ch of line) {
    if (ch >= 'a' && ch <= 'z') return false;
    if (ch >= 'A' && ch <= 'Z') hasLetter = true;
  }
  return hasLetter;
}
