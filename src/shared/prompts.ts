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
 * 文脈に沿った意味と、イディオム/句動詞などの補足を求める。
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
      '次の厳密な2行形式で出力してください（前置き・引用符・装飾は付けない）。\n' +
      '訳: 選択語句の一般的な日本語訳を最大3つ、中黒(・)区切りで。文脈に依存しない代表的な訳にする。\n' +
      `説明: ${label}で、文脈に沿った意味を簡潔に（2〜4文）。イディオム・句動詞・スラングならその点も補足する。`,
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
