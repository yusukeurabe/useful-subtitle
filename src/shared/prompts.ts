import { isSingleWord } from './dictionary';
import type { CaptionNeighbors, ExplanationLanguage } from './types';
import type { NumberedDefinition } from './definitionRefs';

export interface PromptParts {
  system: string;
  user: string;
}

/** 字幕一文を日本語に翻訳するためのプロンプト。 */
export function buildTranslationPrompt(line: string): PromptParts {
  return {
    system:
      'あなたはプロの字幕翻訳者です。英語の映像字幕を、自然で読みやすい日本語に翻訳します。' +
      '訳文のみを出力し、説明・引用符・余計な前置きは付けないでください。',
    user: `次の英語字幕を日本語に訳してください:\n${line}`,
  };
}

const LANGUAGE_LABEL: Record<ExplanationLanguage, string> = {
  ja: '日本語',
  en: 'English',
  both: '日本語と英語の両方',
};

/** 訳の行に添える英語の定義の書き方（単語・フレーズ共通）。解説の言語設定にかかわらず英語で書かせる。 */
const ENGLISH_DEFINITION_RULE =
  '英語の定義は、Cambridge など学習者向け英英辞典の定義文のような平易な英語で、' +
  '日本語訳と同じ意味を1つだけ、20語以内で書く（解説の言語設定にかかわらず英語）。\n';

/** 前後の字幕が1つでもあるか。無ければ従来どおり対象の字幕だけで問う。 */
function hasNeighbors(n: CaptionNeighbors | undefined): n is CaptionNeighbors {
  return Boolean(n && ((n.before?.length ?? 0) > 0 || (n.after?.length ?? 0) > 0));
}

/** 前後の字幕と対象の字幕を、出た順に1行ずつ並べる。 */
function formatCaptionSequence(target: string, n: CaptionNeighbors): string {
  return [
    ...(n.before ?? []).map((t) => `前の字幕: "${t}"`),
    `対象の字幕: "${target}"`,
    ...(n.after ?? []).map((t) => `次の字幕: "${t}"`),
  ].join('\n');
}

/** 字幕は文やフレーズの途中で切れることがある、という前提（前後の字幕を渡すときだけ付ける）。 */
const SPLIT_CAPTION_NOTE =
  '字幕は文やフレーズの途中で区切られ、次の字幕へ続くことがある。前後の字幕を参考として渡すので、' +
  '対象の字幕が前後の字幕と続いている場合は、つなげた文全体として意味を判断する。' +
  '前後の字幕が対象と関係なければ無視する。\n';

/**
 * 字幕一文（context）の中の語句（selection）の意味を解説するためのプロンプト。
 * 1単語かフレーズかは isSingleWord でクライアント側が判定し、LLM には片方の
 * 形式しか提示しない。両方の例を見せると、慣用句に強い単語（例: gauntlet）で
 * LLM が文脈に引きずられて「訳:」フォーマット（=pos=null）を返し、ポップアップの
 * 品詞列が空になる事故が起きるため。
 */
export function buildExplanationPrompt(
  selection: string,
  context: string,
  language: ExplanationLanguage,
  neighbors?: CaptionNeighbors,
  dictionaryPos?: string[],
  definitionCandidates?: NumberedDefinition[],
): PromptParts {
  const label = LANGUAGE_LABEL[language];
  const prompt = isSingleWord(selection)
    ? buildWordExplanationPrompt(selection, context, label, dictionaryPos, definitionCandidates)
    : buildPhraseExplanationPrompt(selection, context, label);
  if (!hasNeighbors(neighbors)) return prompt;
  // 文やフレーズが字幕をまたいでいると、対象の字幕だけでは意味を取り違える
  // （例: "I'm gonna take" / "a rain check on that." の take）。前後の字幕を並べて渡す。
  const kind = isSingleWord(selection) ? '単語' : 'フレーズ';
  return {
    system:
      prompt.system +
      '\n\n' +
      SPLIT_CAPTION_NOTE +
      `選択した${kind}が、字幕をまたいで続く句動詞・イディオム・フレーズの一部なら、` +
      (kind === 'フレーズ' ? '訳はそのフレーズ全体を踏まえた文脈上の意味にし、' : '') +
      '説明行でそのフレーズ全体（前後の字幕の語句を含めて）と文脈での意味を補足する。',
    user:
      `${formatCaptionSequence(context, neighbors)}\n` +
      `対象の字幕の中の${kind} "${selection}" の意味を教えてください。`,
  };
}

/**
 * 品詞は辞書に載っているものだけにさせる。AI は文脈に引っ張られ、"$30 trillion a year
 * incremental" の incremental（辞書では形容詞のみ）を名詞 N[C/U] として返した。
 * 辞書の品詞が取れたときはそれを渡し、取れないときも文脈から品詞を作らないよう指示する。
 */
function partOfSpeechRule(dictionaryPos: string[] | undefined): string {
  const base =
    '品詞は英英辞典に見出し語として載っている品詞だけにする。' +
    '文脈で別の品詞のように使われていても、辞書に無い品詞の行は作らず、その使われ方は説明行で補足する。\n';
  if (!dictionaryPos || dictionaryPos.length === 0) return base;
  return (
    base +
    `辞書に載っている品詞: ${dictionaryPos.join(', ')}\n` +
    'この品詞だけで品詞行を書き（それぞれ対応する品詞コードにする）、これ以外の品詞の行は出さない。\n'
  );
}

/**
 * 英語の定義を Cambridge の原文にするため、定義の候補を番号付きで渡し、番号だけを書かせる。
 * 番号はバックグラウンドで原文に差し替える（resolveDefinitionRefs）。候補が無ければ何も足さない。
 */
function definitionCandidatesRule(candidates: NumberedDefinition[] | undefined): string {
  if (!candidates || candidates.length === 0) return '';
  return (
    'Cambridge 辞書の英語の定義の候補:\n' +
    candidates.map((c) => `[${c.n}] (${c.pos}) ${c.text}`).join('\n') +
    '\n' +
    '英語の定義は、その品詞行の日本語訳と同じ意味の候補があれば、定義の文は書かずに番号だけを [番号] の形で書く' +
    '（例: Adj.: 増分の・追加の | [2]）。品詞の合わない候補は選ばない。' +
    '合う候補が無いときだけ、自分で英語の定義を書く。\n'
  );
}

function buildWordExplanationPrompt(
  selection: string,
  context: string,
  label: string,
  dictionaryPos?: string[],
  definitionCandidates?: NumberedDefinition[],
): PromptParts {
  return {
    system:
      'あなたは日本語話者の英語学習を助けるチューターです。' +
      '次の形式で出力してください（前置き・引用符・装飾は付けない）。\n' +
      '\n' +
      '選択は1単語です。文脈中で慣用句や句動詞の一部として使われていても、' +
      '単語そのものとしての品詞ごとに1行、必ず「品詞コード: 日本語訳 | 英語の定義」の形' +
      '（品詞コードの後は半角コロン、日本語訳と英語の定義の間は半角の縦棒 | で区切る）で出力する。\n' +
      '日本語訳は最大3つ、中黒(・)区切り、文脈に依存しない代表訳にする。\n' +
      ENGLISH_DEFINITION_RULE +
      '品詞コードは次から1つ選ぶ（コードだけを出力し、括弧書きの日本語名は付けない）:\n' +
      '  N[C] N[U] N[C/U] V[I] V[T] V[I/T] Adj. Adv. Pron. Prep. Conj. Det. Int.\n' +
      partOfSpeechRule(dictionaryPos) +
      definitionCandidatesRule(definitionCandidates) +
      '\n' +
      `【最後に必ず1行】「説明: ${label}で、文脈に沿った意味を簡潔に（2〜4文）」。` +
      '文脈で慣用句・句動詞・スラングとして使われていれば、その意味は説明行で補足する。\n' +
      '\n' +
      '出力例:\n' +
      'V[I/T]: 走る・運営する | to move your legs faster than when walking\n' +
      'N[C]: 走り・走ること | an act of running\n' +
      '説明: 文脈ではこう。',
    user: `文: "${context}"\nこの文の中の単語 "${selection}" の意味を教えてください。`,
  };
}

function buildPhraseExplanationPrompt(
  selection: string,
  context: string,
  label: string,
): PromptParts {
  return {
    system:
      'あなたは日本語話者の英語学習を助けるチューターです。' +
      '次の形式で出力してください（前置き・引用符・装飾は付けない）。\n' +
      '\n' +
      '選択はフレーズ・イディオムです。「訳: 簡潔な日本語訳 | 英語の定義」を1行だけ出力する' +
      '（日本語訳と英語の定義の間は半角の縦棒 | で区切る）。\n' +
      ENGLISH_DEFINITION_RULE +
      '\n' +
      `【最後に必ず1行】「説明: ${label}で、文脈に沿った意味を簡潔に（2〜4文）」。` +
      'イディオム・句動詞・スラングならその点も補足する。\n' +
      '\n' +
      '出力例:\n' +
      '訳: 幸運を祈る | used to wish someone good luck, especially before a performance\n' +
      '説明: 舞台前のイディオム。',
    user: `文: "${context}"\nこの文の中のフレーズ "${selection}" の意味を教えてください。`,
  };
}

/**
 * 字幕一文（sentence）まるごとの意味を解説するためのプロンプト。
 * 訳は全文の自然な和訳、説明はイディオム・句動詞・文法・ニュアンスを補足する。
 */
export function buildSentenceMeaningPrompt(
  sentence: string,
  language: ExplanationLanguage,
  neighbors?: CaptionNeighbors,
): PromptParts {
  const label = LANGUAGE_LABEL[language];
  if (hasNeighbors(neighbors)) {
    // 訳は対象の字幕の部分だけ（前後の字幕の内容は含めない）。ただし意味は前後を踏まえて決め、
    // 字幕をまたぐ文・フレーズのつながりは説明で補足する。
    return {
      system:
        'あなたは日本語話者の英語学習を助けるチューターです。' +
        '対象の字幕について、次の厳密な2行形式で出力してください（前置き・引用符・装飾は付けない）。\n' +
        '訳: 対象の字幕の部分だけを、前後の字幕を踏まえた正しい意味で自然な日本語に訳す。' +
        '前後の字幕の内容は訳に含めない。\n' +
        `説明: ${label}で、文に含まれるイディオム・句動詞・文法・ニュアンスを簡潔に（2〜4文）。` +
        '文やフレーズが前後の字幕にまたがっている場合は、どの語句と続いて全体でどういう意味になるかも補足する。\n' +
        '\n' +
        SPLIT_CAPTION_NOTE,
      user: `${formatCaptionSequence(sentence, neighbors)}\n対象の字幕の意味を教えてください。`,
    };
  }
  return {
    system:
      'あなたは日本語話者の英語学習を助けるチューターです。' +
      '字幕の一文について、次の厳密な2行形式で出力してください（前置き・引用符・装飾は付けない）。\n' +
      '訳: 文全体の自然な日本語訳を1文で。語句に分割せず全文を訳す。\n' +
      `説明: ${label}で、文に含まれるイディオム・句動詞・文法・ニュアンスを簡潔に（2〜4文）。`,
    user: `次の英文の意味を教えてください:\n"${sentence}"`,
  };
}
