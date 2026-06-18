import { getSettings, saveSettings } from '../shared/settings';
import { tokenizeLine } from '../shared/tokenize';
import { toTrueCase } from '../shared/truecase';
import { startCaptionObserver } from './captionObserver';
import { createOverlay, type Overlay } from './overlay';
import { createTranscriptPanel, type TranscriptPanel } from './transcriptPanel';
import { runLookup } from './interaction';
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

    const id = ++entryId;
    panel?.append({ id, english: text, videoTime: findVideo()?.currentTime ?? 0 });

    if (!settings.dualSubtitle) {
      overlay.setTranslation({ kind: 'none' });
      return;
    }
    overlay.setTranslation({ kind: 'loading' });
    void sendRequest({ type: 'translateLine', text }).then((res) => {
      if (res.ok) panel?.setTranslation(id, res.text);
      if (text !== currentText) return; // 既に次の行へ移っていれば字幕表示は破棄
      overlay.setTranslation(res.ok ? { kind: 'text', text: res.text } : { kind: 'none' });
    });
  });

  console.info('[Useful Subtitle] active on', location.hostname);
}

void main();
