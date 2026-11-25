/** 1 つの品詞とその一般訳。フレーズ・旧形式は pos=null。 */
export interface WordSense {
  /** Cambridge 式の品詞コード（"V[I/T]" / "N[C]" / "Adj." …）。フレーズ・旧形式は null。 */
  pos: string | null;
  /** その品詞の一般的な訳語（最大3つ・中黒区切り）。 */
  gloss: string;
  /** その品詞の英語の定義（英英辞典風の短い1文）。旧キャッシュ等で無ければ省略。 */
  definition?: string;
}

/** AI 解説レスポンスを「品詞ごとの訳(senses)」と「文脈依存の説明(explanation)」に分解した結果。 */
export interface ParsedExplanation {
  /** 品詞ごとの訳。0 件以上。 */
  senses: WordSense[];
  /** 文脈に沿った説明文。 */
  explanation: string;
}

/**
 * 「ラベル: 本文」の行（行頭の箇条書き記号は任意）。ラベルは最初のコロンまでの短い文字列。
 * 品詞かどうかはラベルを toPosCode にかけて判断する。
 */
const LABELED_LINE = /^\s*(?:[-・•]\s*|\*\s+)?([^:：|｜]{1,30}?)\s*[:：]\s*(.+?)\s*$/;
/** そのまま品詞コードとして受け付ける形（英字・. [ ] /）。 */
const POS_CODE = /^[A-Za-z][A-Za-z.[\]/]*$/;

/**
 * LLM は指示しても品詞を日本語名や英語の綴りで返すことがある（incremental で「形容詞:」が返り、
 * 行ごと捨てられて意味が空になった）。よく出る呼び方をプロンプトの品詞コードにそろえる。
 */
const POS_ALIASES: Record<string, string> = {
  名詞: 'N',
  可算名詞: 'N[C]',
  不可算名詞: 'N[U]',
  動詞: 'V',
  自動詞: 'V[I]',
  他動詞: 'V[T]',
  形容詞: 'Adj.',
  副詞: 'Adv.',
  代名詞: 'Pron.',
  前置詞: 'Prep.',
  接続詞: 'Conj.',
  限定詞: 'Det.',
  冠詞: 'Det.',
  間投詞: 'Int.',
  感動詞: 'Int.',
  noun: 'N',
  verb: 'V',
  adjective: 'Adj.',
  adverb: 'Adv.',
  pronoun: 'Pron.',
  preposition: 'Prep.',
  conjunction: 'Conj.',
  determiner: 'Det.',
  interjection: 'Int.',
};

/** ラベルから装飾（**太字**・`コード`）と括弧書き（「Adj.（形容詞）」の（形容詞））を外す。 */
function cleanLabel(raw: string): string {
  return raw
    .replace(/[*_`]/g, '')
    .replace(/\s*[(（][^)）]*[)）]\s*/g, '')
    .trim();
}

/** ラベルを品詞コードにする。品詞と認められなければ null（訳:・例: などはここで弾く）。 */
function toPosCode(label: string): string | null {
  const alias = POS_ALIASES[label] ?? POS_ALIASES[label.toLowerCase()];
  if (alias) return alias;
  return POS_CODE.test(label) ? label : null;
}
/**
 * 行の途中に出てくる品詞コード＋コロン（プロンプトで指定したコードのみ）。
 * AI が考えた過程と品詞行を1行にまとめて返すことがある（distillation で
 * 「名詞として辞書にある品詞は noun のみ。…なので N[U]: 蒸留・要約 | …」）。
 */
const EMBEDDED_POS = /(?:N|V)\[[A-Za-z/]+\]\s*[:：]|(?:Adj|Adv|Pron|Prep|Conj|Det|Int)\.\s*[:：]/g;

/** 訳語は単語の羅列なので句点を含まない。含むなら AI が考えた過程の文なので訳語として扱わない。 */
function looksLikeSentence(gloss: string): boolean {
  return /[。．]/.test(gloss);
}

/**
 * 1 行を「品詞コード + 訳 (+ 英語の定義)」として読む。読めなければ null。
 * 行頭がラベルの通常の形に加え、考えた過程の後ろに品詞コードが続く行も、品詞コード以降だけを読む。
 */
function readPosLine(line: string): WordSense | null {
  const m = line.match(LABELED_LINE);
  if (m) {
    const pos = toPosCode(cleanLabel(m[1]));
    if (pos) {
      const { gloss, definition } = splitGlossAndDefinition(m[2]);
      if (gloss && !looksLikeSentence(gloss)) return definition ? { pos, gloss, definition } : { pos, gloss };
    }
  }
  // 行の途中の最後の品詞コードから読み直す（前にある考えた過程は捨てる）。
  const hits = [...line.matchAll(EMBEDDED_POS)];
  const last = hits[hits.length - 1];
  if (!last || last.index === undefined || last.index === 0) return null;
  return readPosLine(line.slice(last.index));
}

/** フレーズ・旧キャッシュ用の単一訳ラベル（訳: / 訳語:）。 */
const GLOSS_LINE = /^\s*訳(?:語)?\s*[:：]\s*(.+?)\s*$/;
/** 説明ラベル行（全角コロン可）。 */
const EXPL_LABEL = /^\s*説明\s*[:：]/;

/** 訳語の区切り（、 , ・ ／ /）を「・」に正規化し、最大3つに丸める。空なら ''。 */
function normalizeGloss(raw: string): string {
  return raw
    .split(/[、,・／/]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join('・');
}

/**
 * 「日本語訳 | English definition」を分ける。英語側は "/" を含みうるので、
 * 訳語の正規化（normalizeGloss）は日本語側だけにかける。定義が無ければ definition は付けない。
 */
function splitGlossAndDefinition(raw: string): { gloss: string; definition?: string } {
  const [ja, ...rest] = raw.split(/\s*[|｜]\s*/);
  const gloss = normalizeGloss(ja);
  const definition = rest.join(' ').trim();
  return definition ? { gloss, definition } : { gloss };
}

/**
 * AI の構造化レスポンスを分解する。
 * - 単語: 品詞ごとの行（"V[I/T]: 走る・運営する"）を senses に。
 * - フレーズ/旧キャッシュ: 品詞行が無く "訳:" があれば pos=null の 1 件にフォールバック。
 * - "説明:" 以降を explanation に。ラベルが一切無ければ全文を explanation とし、安全に劣化する。
 */
export function parseExplanation(raw: string): ParsedExplanation {
  const text = (raw ?? '').trim();
  if (!text) return { senses: [], explanation: '' };

  const lines = text.split('\n');
  const explIdx = lines.findIndex((l) => EXPL_LABEL.test(l));
  // 品詞・訳の探索は説明ラベルより前の行に限る（説明本文を訳として誤検出しない）。
  const headLines = explIdx >= 0 ? lines.slice(0, explIdx) : lines.slice();

  const senses: WordSense[] = [];
  const consumed = new Set<number>();

  headLines.forEach((line, i) => {
    const sense = readPosLine(line);
    if (!sense || !sense.pos) return;
    const { pos, gloss, definition } = sense;
    consumed.add(i);
    // LLM が同じ品詞行を繰り返すことがある（then で "Adv.: …" が2行出た）。
    // 同じ品詞は1行にまとめ、訳語は重複を除いて最大3つに丸める。英語の定義は最初のものを残す。
    const same = senses.find((s) => s.pos === pos);
    if (same) {
      same.gloss = normalizeGloss(`${same.gloss}・${gloss}`.split('・').filter((t, j, a) => a.indexOf(t) === j).join('・'));
      if (!same.definition && definition) same.definition = definition;
      return;
    }
    senses.push(definition ? { pos, gloss, definition } : { pos, gloss });
  });

  // 品詞行が 1 つも無いときだけ、フレーズ/旧形式の "訳:" を 1 件として拾う。
  if (senses.length === 0) {
    for (let i = 0; i < headLines.length; i++) {
      const m = headLines[i].match(GLOSS_LINE);
      if (!m) continue;
      const { gloss, definition } = splitGlossAndDefinition(m[1]);
      if (gloss) {
        senses.push(definition ? { pos: null, gloss, definition } : { pos: null, gloss });
        consumed.add(i);
      }
      break;
    }
  }

  // 最後の砦: 品詞も「訳:」も読めなくても、「訳 | 英語の定義」の形の行があれば意味として残す。
  // 想定外の品詞名（助動詞 など）でも、意味の欄が丸ごと消えるよりはラベルのまま出す方がよい。
  if (senses.length === 0) {
    const i = headLines.findIndex((l) => /[|｜]/.test(l));
    if (i >= 0) {
      const m = headLines[i].match(LABELED_LINE);
      const label = m ? cleanLabel(m[1]) : '';
      const body = m ? m[2] : headLines[i].replace(/^\s*(?:[-・•]\s*|\*\s+)?/, '');
      const { gloss, definition } = splitGlossAndDefinition(body);
      if (gloss && !looksLikeSentence(gloss)) {
        const pos = label && label.length <= 12 ? label : null;
        senses.push(definition ? { pos, gloss, definition } : { pos, gloss });
        consumed.add(i);
      }
    }
  }

  let explanation: string;
  if (explIdx >= 0) {
    const first = lines[explIdx].replace(/^\s*説明\s*[:：]\s*/, '');
    explanation = [first, ...lines.slice(explIdx + 1)].join('\n').trim();
  } else {
    explanation = headLines.filter((_, i) => !consumed.has(i)).join('\n').trim();
  }

  return { senses, explanation };
}

/** 文まるごとの意味を「和訳(全文)」と「解説」に分解した結果。 */
export interface SentenceMeaning {
  /** 文全体の日本語訳（丸めず全文を保持）。無ければ ''。 */
  translation: string;
  /** イディオム・文法などの解説。 */
  explanation: string;
}

/**
 * 文用の構造化レスポンス（「訳: …」「説明: …」）を分解する。
 * 単語用 parseExplanation と違い、訳は正規化・件数丸めをせず全文を保持する。
 * ラベルが無い場合は translation='' とし全文を explanation に（安全に劣化）。
 */
export function parseSentenceMeaning(raw: string): SentenceMeaning {
  const text = (raw ?? '').trim();
  if (!text) return { translation: '', explanation: '' };

  const transMatch = text.match(/^訳(?:語)?[ \t]*[:：][ \t]*(.+?)[ \t]*$/m);
  const explMatch = text.match(/^説明[ \t]*[:：]\s*([\s\S]+)$/m);

  const translation = transMatch ? transMatch[1].trim() : '';

  let explanation: string;
  if (explMatch) {
    explanation = explMatch[1].trim();
  } else if (transMatch) {
    explanation = text.replace(transMatch[0], '').trim();
  } else {
    explanation = text;
  }

  return { translation, explanation };
}
