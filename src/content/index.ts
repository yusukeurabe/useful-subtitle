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
import { sendRequest } from '../shared/messages';

async function main(): Promise<void> {
  const settings = await getSettings();
  if (!settings.enabled) return;

  let overlay!: Overlay;
  overlay = createOverlay(
    {
      onLookup: (selection, sentence, anchor) =>
        void runLookup(overlay, settings, selection, sentence, anchor),
      onPlayAudio: (selection, audioUrl) => void playPronunciation(selection, audioUrl),
    },
    {
      bottomPercent: settings.subtitleBottomPercent,
      onBottomChange: (percent) => void saveSettings({ subtitleBottomPercent: percent }),
    },
  );

  const panel: TranscriptPanel | null = settings.showTranscriptPanel
    ? createTranscriptPanel({ onSeek: seekVideo })
    : null;
  let entryId = 0;

  // 履歴への重複記録を防ぐ記録ポリシー。履歴クリックや再生バーで過去へ巻き戻して
  // 記録済み範囲を再生し直す間は記録せず、記録済み地点を追い越したら記録を再開する。
  const recorder = createTranscriptRecorder();
  if (panel) {
    // 動画の読み込み（エピソード切替など）を検知してフロンティアを初期化し、
    // 新しい動画を時刻 0 付近から記録できるようにする。メディアイベントはバブリング
    // しないため document のキャプチャ段で受ける。
    const resetRecorder = (): void => recorder.reset();
    for (const ev of ['loadstart', 'emptied', 'durationchange'] as const) {
      document.addEventListener(ev, resetRecorder, true);
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
    if (raw === null) {
      currentText = '';
      overlay.clearLine();
      return;
    }
    const text = settings.truecaseSubtitle ? toTrueCase(raw) : raw;
    currentText = text;
    overlay.renderLine(text, tokenizeLine(text));

    // 巻き戻して記録済み範囲を再生し直している間は履歴へ重複記録しない。
    // 画面上の字幕・翻訳（overlay）は再視聴中も従来どおり表示する。
    const videoTime = findVideo()?.currentTime ?? 0;
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
