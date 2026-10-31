import { isYouTube, isYouTubeAd } from './site';
import { getSettings, saveSettings } from '../shared/settings';
import { tokenizeLine } from '../shared/tokenize';
import { toTrueCase } from '../shared/truecase';
import { startCaptionObserver } from './captionObserver';
import { createOverlay, type Overlay } from './overlay';
import { createTranscriptPanel, type TranscriptPanel } from './transcriptPanel';
import { createTranscriptRecorder, createRollingTranscriptRecorder } from './transcriptRecorder';
import { runLookup } from './interaction';
import { playPronunciation } from './audio';
import { findVideo, seekVideo } from './videoControl';
import { extractContentId, createTitleSwitchDetector } from './contentIdentity';
import { sendRequest } from '../shared/messages';
import { parseExplanation, parseSentenceMeaning } from '../shared/explanation';

async function main(): Promise<void> {
  const settings = await getSettings();
  if (!settings.enabled) return;
  const youtube = isYouTube();
  let generation = 0;
  const notifyContextChanged = (): void => {
    try {
      void chrome.runtime.sendMessage({ type: 'contextChanged' }).catch(() => {});
    } catch { /* 拡張の再読み込み後は次の通常要求で再読み込みを案内する。 */ }
  };
  let historyGeneration = 0;
  let lineVersion = 0;
  let translationTimer: ReturnType<typeof setTimeout> | undefined;
  let translationQueuedAt = 0;
  const cancelTranslation = (): void => {
    clearTimeout(translationTimer);
    translationTimer = undefined;
  };

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
  const rollingRecorder = createRollingTranscriptRecorder();

  // 履歴パネル。消去ボタン（onClearHistory）は履歴の全消去＋記録位置の初期化を束ねる。
  // 押下後に再生された字幕からまた記録が始まる。panel 自身を参照するので let で先に宣言する。
  let panel: TranscriptPanel | null = null;
  const clearHistory = (): void => {
    historyGeneration++;
    panel?.clear();
    recorder.reset();
    rollingRecorder.reset();
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
  panel?.setVisible(!youtube);
  let entryId = 0;
  // Prime は作品コード＋本編の尺、YouTube は動画 ID のみで切り替えを判定する。
  const titleSwitch = createTitleSwitchDetector({ useDuration: !youtube });

  // 作品が本当に切り替わったときだけ履歴を全消去し、記録位置も初期化する。
  const maybeResetForNewTitle = (): void => {
    const switched = titleSwitch.check({
      id: extractContentId(location.href),
      durationRaw: findVideo()?.duration ?? NaN,
    });
    if (switched) {
      generation++;
      notifyContextChanged();
      clearHistory();
      cancelTranslation();
      overlay.clearLine();
    }
  };

  if (panel && !youtube) {
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
    const syncActiveRow = (): void => {
      const video = findVideo();
      if (video) panel.updateActiveByTime(video.currentTime);
    };
    for (const ev of ['timeupdate', 'seeked'] as const) {
      document.addEventListener(ev, syncActiveRow, true);
    }
    if (youtube) document.addEventListener('seeking', () => rollingRecorder.breakSequence(), true);
  }

  // 広告復帰直後に同じ字幕を履歴へ二重記録しないため、直近の字幕を保持する。
  let currentText = '';
  let beforeAdText = '';
  let wasAd = false;
  let previousId = '';
  let wasActive = true;

  startCaptionObserver((raw, context) => {
    overlay.syncMount();
    panel?.setVisible(context.active && !context.isAd);
    // ページ離脱・広告開始でも進行中の翻訳を無効化する。履歴は動画 ID 変更時だけ消す。
    if (youtube && ((wasActive && !context.active) || (!wasAd && context.isAd))) {
      generation++;
      notifyContextChanged();
      rollingRecorder.breakSequence();
    }
    if (context.contentId !== previousId) beforeAdText = '';
    else if (context.isAd && !wasAd) beforeAdText = currentText;
    wasAd = context.isAd;
    wasActive = context.active;
    previousId = context.contentId;
    const version = ++lineVersion;
    // 記録の前に作品切替を判定する。切り替わっていれば履歴を空にしてから進むので、
    // 新作品の最初の字幕が履歴の先頭行になる。
    maybeResetForNewTitle();
    if (raw === null) {
      cancelTranslation();
      currentText = '';
      overlay.clearLine();
      return;
    }
    const text = settings.truecaseSubtitle ? toTrueCase(raw) : raw;
    const resumedText = beforeAdText;
    beforeAdText = '';
    currentText = text;
    // 字幕が現れた瞬間の動画位置を一度だけ読み、overlay の▶（字幕の頭から再生）と
    // 履歴記録の両方で同じ値を使う（クリック先がブレないように）。
    const videoTime = findVideo()?.currentTime ?? 0;
    overlay.renderLine(text, tokenizeLine(text), videoTime);

    // 巻き戻して記録済み範囲を再生し直している間は履歴へ重複記録しない。
    // 画面上の字幕・翻訳（overlay）は再視聴中も従来どおり表示する。
    const entry = !panel || text === resumedText ? null
      : youtube ? rollingRecorder.record(text, videoTime)
        : recorder.shouldRecord(videoTime) ? { id: ++entryId, english: text, videoTime } : null;
    const recordedId = entry?.id ?? null;
    if (entry) {
      panel?.append(entry);
      // 追加した行を即座にアクティブにする（timeupdate を待たずに反映）。
      panel?.updateActiveByTime(videoTime);
    }

    if (!settings.dualSubtitle) {
      overlay.setTranslation({ kind: 'none' });
      return;
    }
    overlay.setTranslation({ kind: 'loading' });
    const requestGeneration = generation;
    const requestHistoryGeneration = historyGeneration;
    const contentId = context.contentId;
    const validSession = (): boolean => requestGeneration === generation && (
      !youtube || (!isYouTubeAd() && contentId === extractContentId(location.href))
    );
    const translate = (): void => {
      translationTimer = undefined;
      if (!validSession() || version !== lineVersion) return;
      void sendRequest({ type: 'translateLine', text }).then((res) => {
        if (!validSession()) return;
        if (res.ok && recordedId !== null && requestHistoryGeneration === historyGeneration) {
          panel?.setTranslation(recordedId, res.text, text);
        }
        if (version !== lineVersion) return;
        overlay.setTranslation(res.ok
          ? { kind: 'text', text: res.text }
          : res.code === 'RATE_LIMIT'
            ? { kind: 'text', text: res.error }
            : { kind: 'none' });
      });
    };
    if (youtube) {
      // ローリング字幕は即時表示し、翻訳だけ350msまとめる。連続更新でも1.5秒で送る。
      if (translationTimer === undefined) translationQueuedAt = Date.now();
      clearTimeout(translationTimer);
      translationTimer = setTimeout(translate, Math.max(0, Math.min(350, 1500 - (Date.now() - translationQueuedAt))));
    } else {
      translate();
    }
  });

  console.info('[Useful Subtitle] active on', location.hostname);
}

void main();
