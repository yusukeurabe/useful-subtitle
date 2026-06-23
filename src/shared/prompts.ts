import type { ExplanationLanguage } from './types';

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

/**
 * 字幕一文（context）の中の語句（selection）の意味を解説するためのプロンプト。
 * 単語は品詞ごとの一般訳を、フレーズは単一の訳を求め、最後に文脈依存の説明を求める。
 */
export function buildExplanationPrompt(
  selection: string,
  context: string,
  language: ExplanationLanguage,
): PromptParts {
  const label = LANGUAGE_LABEL[language];
  return {
    system:
      'あなたは日本語話者の英語学習を助けるチューターです。' +
      '次の形式で出力してください（前置き・引用符・装飾は付けない）。\n' +
      '\n' +
      '【1単語のとき】品詞ごとに1行、必ず「品詞コード: 日本語訳」の形（半角コロンで区切る）。' +
      '日本語訳は最大3つ、中黒(・)区切り、文脈に依存しない代表訳にする。\n' +
      '品詞コードは次から1つ選ぶ（コードだけを出力し、括弧書きの日本語名は付けない）:\n' +
      '  N[C] N[U] N[C/U] V[I] V[T] V[I/T] Adj. Adv. Pron. Prep. Conj. Det. Int.\n' +
      '\n' +
      '【フレーズ・イディオムのとき】品詞行のかわりに「訳: 簡潔な日本語訳」を1行だけ出力する。\n' +
      '\n' +
      `【最後に必ず1行】「説明: ${label}で、文脈に沿った意味を簡潔に（2〜4文）」。` +
      'イディオム・句動詞・スラングならその点も補足する。\n' +
      '\n' +
      '出力例（1単語）:\n' +
      'V[I/T]: 走る・運営する\n' +
      'N[C]: 走り・走ること\n' +
      '説明: 文脈ではこう。\n' +
      '\n' +
      '出力例（フレーズ）:\n' +
      '訳: 幸運を祈る\n' +
      '説明: 舞台前のイディオム。',
    user: `文: "${context}"\nこの文の中の "${selection}" の意味を教えてください。`,
  };
}

/**
 * 字幕一文（sentence）まるごとの意味を解説するためのプロンプト。
 * 訳は全文の自然な和訳、説明はイディオム・句動詞・文法・ニュアンスを補足する。
 */
export function buildSentenceMeaningPrompt(
  sentence: string,
  language: ExplanationLanguage,
): PromptParts {
  const label = LANGUAGE_LABEL[language];
  return {
    system:
      'あなたは日本語話者の英語学習を助けるチューターです。' +
      '字幕の一文について、次の厳密な2行形式で出力してください（前置き・引用符・装飾は付けない）。\n' +
      '訳: 文全体の自然な日本語訳を1文で。語句に分割せず全文を訳す。\n' +
      `説明: ${label}で、文に含まれるイディオム・句動詞・文法・ニュアンスを簡潔に（2〜4文）。`,
    user: `次の英文の意味を教えてください:\n"${sentence}"`,
  };
}
