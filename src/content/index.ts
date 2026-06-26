import { getSettings, saveSettings } from '../shared/settings';
import { tokenizeLine } from '../shared/tokenize';
import { toTrueCase } from '../shared/truecase';
import { startCaptionObserver } from './captionObserver';
import { createOverlay, type Overlay } from './overlay';
import { createTranscriptPanel, type TranscriptPanel } from './transcriptPanel';
import { createTranscriptRecorder } from './transcriptRecorder';
import { runLookup } from './interaction';
import { playPronunciation } from './audio';
import { findVideo, seekVideo } from './videoControl';
import { extractContentId, createTitleSwitchDetector } from './contentIdentity';
import { sendRequest } from '../shared/messages';
import { parseExplanation, parseSentenceMeaning } from '../shared/explanation';

async function main(): Promise<void> {
  const settings = await getSettings();
  if (!settings.enabled) return;

  let overlay!: Overlay;
  overlay = createOverlay(
    {
      onLookup: (selection, sentence, anchor) =>
        void runLookup(overlay, settings, selection, sentence, anchor),
      onPlayAudio: (selection, audioUrl) => void playPronunciation(selection, audioUrl),
      onSeek: seekVideo,
    },
    {
      bottomPercent: settings.subtitleBottomPercent,
      onBottomChange: (percent) => void saveSettings({ subtitleBottomPercent: percent }),
    },
  );

  // 履歴への重複記録を防ぐ記録ポリシー。履歴クリックや再生バーで過去へ巻き戻して
  // 記録済み範囲を再生し直す間は記録せず、記録済み地点を追い越したら記録を再開する。
  // 消去ボタンより先に宣言しておく（onClearHistory から参照するため）。
  const recorder = createTranscriptRecorder();

  // 履歴パネル。消去ボタン（onClearHistory）は履歴の全消去＋記録位置の初期化を束ねる。
  // 押下後に再生された字幕からまた記録が始まる。panel 自身を参照するので let で先に宣言する。
  let panel: TranscriptPanel | null = null;
  const clearHistory = (): void => {
    panel?.clear();
    recorder.reset();
  };
  panel = settings.showTranscriptPanel
    ? createTranscriptPanel({
        onSeek: seekVideo,
        onExplainWord: async (word, sentence) => {
          const res = await sendRequest({
            type: 'explainSelection',
            selection: word,
            context: sentence,
          });
          if (!res.ok) return { ok: false, error: res.error };
          const { senses, explanation } = parseExplanation(res.text);
          return { ok: true, senses, explanation };
        },
        onExplain: async (sentence) => {
          const res = await sendRequest({ type: 'explainSentence', text: sentence });
          if (!res.ok) return { ok: false, error: res.error };
          const { translation, explanation } = parseSentenceMeaning(res.text);
          return { ok: true, translation, explanation };
        },
        onClearHistory: clearHistory,
      })
    : null;
  let entryId = 0;
  // 別作品・別エピソードへの切り替えを見分ける検出器（URL の作品コード＋本編の尺）。
  // 広告では発火しない（id も本編の尺も変わらない）ので、広告で履歴を誤って消さない。
  const titleSwitch = createTitleSwitchDetector();

  // 作品が本当に切り替わったときだけ履歴を全消去し、記録位置も初期化する。
  const maybeResetForNewTitle = (): void => {
    if (!panel) return;
    const switched = titleSwitch.check({
      id: extractContentId(location.href),
      durationRaw: findVideo()?.duration ?? NaN,
    });
    if (switched) {
      panel.clear();
      recorder.reset();
    }
  };

  if (panel) {
    // 動画の読み込み（エピソード切替など）を検知。フロンティアは従来どおり常に初期化し
    // （新しい動画を時刻 0 付近から記録できるように）、加えて作品が本当に変わったかを
    // 判定して履歴を全消去する。メディアイベントはバブリングしないため document の
    // キャプチャ段で受ける。
    const handleMediaLoad = (): void => {
      recorder.reset();
      maybeResetForNewTitle();
    };
    for (const ev of ['loadstart', 'emptied', 'durationchange'] as const) {
      document.addEventListener(ev, handleMediaLoad, true);
    }
  }

  if (panel) {
    // 再生位置の変化を監視して履歴のアクティブ行を更新する。メディアイベントは
    // バブリングしないため document のキャプチャ段で受ける（広告での video 差し替えにも耐える）。
    const syncActiveRow = (): void => panel.updateActiveByTime(findVideo()?.currentTime ?? 0);
    for (const ev of ['timeupdate', 'seeked'] as const) {
      document.addEventListener(ev, syncActiveRow, true);
    }
  }

  // 直近の字幕。非同期の翻訳結果が古い行を上書きしないよう照合に使う。
  let currentText = '';

  startCaptionObserver((raw) => {
    // 記録の前に作品切替を判定する。切り替わっていれば履歴を空にしてから進むので、
    // 新作品の最初の字幕が履歴の先頭行になる。
    maybeResetForNewTitle();
    if (raw === null) {
      currentText = '';
      overlay.clearLine();
      return;
    }
    const text = settings.truecaseSubtitle ? toTrueCase(raw) : raw;
    currentText = text;
    // 字幕が現れた瞬間の動画位置を一度だけ読み、overlay の▶（字幕の頭から再生）と
    // 履歴記録の両方で同じ値を使う（クリック先がブレないように）。
    const videoTime = findVideo()?.currentTime ?? 0;
    overlay.renderLine(text, tokenizeLine(text), videoTime);

    // 巻き戻して記録済み範囲を再生し直している間は履歴へ重複記録しない。
    // 画面上の字幕・翻訳（overlay）は再視聴中も従来どおり表示する。
    const recordedId = panel && recorder.shouldRecord(videoTime) ? ++entryId : null;
    if (recordedId !== null) {
      panel?.append({ id: recordedId, english: text, videoTime });
      // 追加した行を即座にアクティブにする（timeupdate を待たずに反映）。
      panel?.updateActiveByTime(videoTime);
    }

    if (!settings.dualSubtitle) {
      overlay.setTranslation({ kind: 'none' });
      return;
    }
    overlay.setTranslation({ kind: 'loading' });
    void sendRequest({ type: 'translateLine', text }).then((res) => {
      if (res.ok && recordedId !== null) panel?.setTranslation(recordedId, res.text);
      if (text !== currentText) return; // 既に次の行へ移っていれば字幕表示は破棄
      overlay.setTranslation(res.ok ? { kind: 'text', text: res.text } : { kind: 'none' });
    });
  });

  console.info('[Useful Subtitle] active on', location.hostname);
}

void main();
