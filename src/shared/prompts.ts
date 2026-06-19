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
      '選択が1単語のとき: その語が一般に取りうる品詞ごとに1行ずつ出力する。' +
      '各行は「品詞コード: 日本語訳」。日本語訳は最大3つ、中黒(・)区切り、文脈に依存しない代表訳にする。\n' +
      '品詞コードは次の表記を使う: ' +
      'N[C](可算名詞) / N[U](不可算名詞) / N[C/U](可算・不可算) / ' +
      'V[I](自動詞) / V[T](他動詞) / V[I/T](自動詞・他動詞) / ' +
      'Adj.(形容詞) / Adv.(副詞) / Pron.(代名詞) / Prep.(前置詞) / ' +
      'Conj.(接続詞) / Det.(限定詞) / Int.(間投詞) など。\n' +
      '選択が複数語(フレーズ・イディオム)のとき: 品詞行のかわりに「訳: 簡潔な日本語訳」を1行だけ出力する。\n' +
      `最後に必ず次の行を加える。説明: ${label}で、文脈に沿った意味を簡潔に（2〜4文）。` +
      'イディオム・句動詞・スラングならその点も補足する。',
    user: `文: "${context}"\nこの文の中の "${selection}" の意味を教えてください。`,
  };
}
