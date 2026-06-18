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
      `あなたは日本語話者の英語学習を助けるチューターです。${label}で、簡潔に（2〜4文で）説明してください。` +
      'まず文脈に沿った意味を述べ、イディオム・句動詞・スラングであればその点も補足します。' +
      '余計な前置きは省き、説明本体のみを出力してください。',
    user: `文: "${context}"\nこの文の中の "${selection}" の意味を教えてください。`,
  };
}
