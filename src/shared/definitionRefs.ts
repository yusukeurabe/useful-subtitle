import type { DefinitionGroup } from './dictionary';

/** AI に渡す定義の候補（番号付き）。 */
export interface NumberedDefinition {
  /** 通し番号（1 から。品詞をまたいで振る）。 */
  n: number;
  /** その定義の見出しの品詞（"adjective" など）。 */
  pos: string;
  /** Cambridge の定義の原文。 */
  text: string;
}

/** 品詞ごとの定義に、品詞をまたいで 1 から通し番号を振る。 */
export function numberDefinitions(groups: DefinitionGroup[] | undefined): NumberedDefinition[] {
  const out: NumberedDefinition[] = [];
  for (const g of groups ?? []) {
    for (const text of g.defs) out.push({ n: out.length + 1, pos: g.pos, text });
  }
  return out;
}

/**
 * 縦棒の後ろが「[番号]」で始まる部分（全角の ｜ ［ ］ ・全角数字も可）。番号の後ろの書き足しも拾う。
 * [1, 3] や [1・3] のように複数の番号を並べたときは最初の番号を使う。
 */
const DEFINITION_REF = /\s*[|｜]\s*[[［]\s*([0-9０-９]+)[^\]］]*[\]］](.*)$/;

/** 全角数字を半角にして数値にする。 */
function toNumber(digits: string): number {
  return Number(digits.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)));
}

/**
 * AI の応答の「訳 | [番号]」を「訳 | Cambridge の原文」に置き換える。
 * 存在しない番号なら、番号の後ろに書き足された文があればそれを、無ければ英語の部分ごと取り除く。
 * 縦棒の後ろが番号で始まらない行（AI 自身の定義・説明の行）は変えない。
 */
export function resolveDefinitionRefs(raw: string, candidates: NumberedDefinition[]): string {
  if (candidates.length === 0) return raw;
  return raw
    .split(/\r?\n/)
    .map((line) => {
      const m = line.match(DEFINITION_REF);
      if (!m || m.index === undefined) return line;
      const head = line.slice(0, m.index);
      const found = candidates.find((c) => c.n === toNumber(m[1]));
      if (found) return `${head} | ${found.text}`;
      const rest = m[2].trim();
      return rest ? `${head} | ${rest}` : head;
    })
    .join('\n');
}
