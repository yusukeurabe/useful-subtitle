import { getSettings, saveSettings } from '../shared/settings';
import { tokenizeLine } from '../shared/tokenize';
import { startCaptionObserver } from './captionObserver';
import { createOverlay, type Overlay } from './overlay';
import { runLookup } from './interaction';
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

  // 直近の字幕。非同期の翻訳結果が古い行を上書きしないよう照合に使う。
  let currentText = '';

  startCaptionObserver((text) => {
    if (text === null) {
      currentText = '';
      overlay.clearLine();
      return;
    }
    currentText = text;
    overlay.renderLine(text, tokenizeLine(text));

    if (!settings.dualSubtitle) {
      overlay.setTranslation({ kind: 'none' });
      return;
    }
    overlay.setTranslation({ kind: 'loading' });
    void sendRequest({ type: 'translateLine', text }).then((res) => {
      if (text !== currentText) return; // 既に次の行へ移っていれば破棄
      overlay.setTranslation(res.ok ? { kind: 'text', text: res.text } : { kind: 'none' });
    });
  });

  console.info('[Useful Subtitle] active on', location.hostname);
}

void main();
