// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runLookup } from '../src/content/interaction';
import { createOverlay, type Overlay } from '../src/content/overlay';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/shared/messages', () => ({ sendRequest: request }));
let overlay: Overlay;
const pending: ((value: unknown) => void)[] = [];
const settings = { ...DEFAULT_SETTINGS, autoPauseOnClick: false };
const anchor = (): DOMRect => new DOMRect(100, 100, 50, 20);

beforeEach(() => {
  vi.stubGlobal('location', new URL('https://www.youtube.com/watch?v=first'));
  document.body.innerHTML = '<div id="movie_player"></div>';
  overlay = createOverlay({ onLookup() {}, onPlayAudio() {}, onSeek() {} }, { bottomPercent: 10, onBottomChange() {} });
  pending.length = 0;
  request.mockClear();
  request.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
});
afterEach(() => { overlay.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['open', 'close', 'render', 'clear', 'remount'])(
  'does not apply an older same-word lookup after popup %s and a new lookup', async (action) => {
    const old = runLookup(overlay, settings, 'word', 'Video A', anchor());
    if (action === 'close') overlay.hidePopup();
    if (action === 'render') overlay.renderLine('Video B', [], 0);
    if (action === 'clear') overlay.clearLine();
    if (action === 'remount') {
      document.body.innerHTML = '<div id="movie_player"></div>';
      overlay.syncMount();
    }
    const fresh = runLookup(overlay, settings, 'word', 'Video B', anchor());
    // 1 回の lookup で 辞書(lookupWord) → 単語解説 → 字幕一文の和訳 の順に 3 件送る。
    pending[3]({ ok: true, kind: 'word', ipa: 'new', audioUrl: 'new.mp3' });
    pending[4]({ ok: true, text: 'New explanation' });
    pending[5]({ ok: true, text: '訳: 新しい和訳\n説明: New sentence' });
    await fresh;
    await Promise.resolve();
    pending[0]({ ok: true, kind: 'word', ipa: 'old', audioUrl: 'old.mp3' });
    pending[1]({ ok: true, text: 'Old explanation' });
    pending[2]({ ok: true, text: '訳: 古い和訳\n説明: Old sentence' });
    await old;
    await Promise.resolve();
    const shadow = document.getElementById('useful-subtitle-overlay')!.shadowRoot!;
    expect(shadow.querySelector('.body')!.textContent).toContain('New explanation');
    expect(shadow.querySelector('.ipa')!.textContent).toContain('new');
    expect(shadow.querySelector('.sentence .s-trans')!.textContent).toBe('新しい和訳');
    expect(shadow.querySelector('.popup')!.textContent).not.toContain('Old explanation');
    expect(shadow.querySelector('.popup')!.textContent).not.toContain('古い和訳');
  },
);

it.each(['close', 'render', 'clear', 'remount', 'leave', 'destroy'])(
  'does not apply pending explanation or IPA after popup invalidation by %s', async (action) => {
    const meaning = vi.spyOn(overlay, 'setPopupMeaning');
    const word = vi.spyOn(overlay, 'setPopupWordInfo');
    const sentence = vi.spyOn(overlay, 'setPopupSentence');
    const lookup = runLookup(overlay, settings, 'word', 'Video A', anchor());
    if (action === 'close') overlay.hidePopup();
    if (action === 'render') overlay.renderLine('Next caption', [], 1);
    if (action === 'clear') overlay.clearLine();
    if (action === 'remount') {
      document.body.innerHTML = '<div id="movie_player"></div>';
      overlay.syncMount();
    }
    if (action === 'leave') {
      vi.stubGlobal('location', new URL('https://www.youtube.com/'));
      overlay.syncMount();
    }
    if (action === 'destroy') overlay.destroy();
    pending[0]({ ok: true, kind: 'word', ipa: 'old', audioUrl: 'old.mp3' });
    pending[1]({ ok: true, text: 'Old explanation' });
    pending[2]({ ok: true, text: '訳: 古い和訳' });
    await lookup;
    await Promise.resolve();
    expect(meaning).not.toHaveBeenCalled();
    expect(word).not.toHaveBeenCalled();
    // 取得中表示（null）だけで、結果は反映しない。
    expect(sentence.mock.calls).toEqual([[null]]);
  },
);

it('ポップアップ下段に、いま表示中の字幕一文の和訳と解説を出す（字幕一覧と同じ explainSentence）', async () => {
  const lookup = runLookup(overlay, settings, 'run', 'I run every day.', anchor());
  expect(request).toHaveBeenCalledWith({ type: 'explainSentence', text: 'I run every day.' });
  const shadow = document.getElementById('useful-subtitle-overlay')!.shadowRoot!;
  const section = shadow.querySelector<HTMLDivElement>('.popup .sentence')!;
  expect(section.hidden).toBe(false);
  expect(section.querySelector('.skeleton[aria-label="Thinking…"]')).not.toBeNull();
  pending[0]({ ok: true, kind: 'word', ipa: null, audioUrl: null });
  pending[1]({ ok: true, text: 'V[I]: 走る\n説明: 走ること' });
  pending[2]({ ok: true, text: '訳: 私は毎日走る。\n説明: 習慣を表す現在形。' });
  await lookup;
  await Promise.resolve();
  expect(section.querySelector('.s-label')!.textContent).toBe('和訳');
  expect(section.querySelector('.s-trans')!.textContent).toBe('私は毎日走る。');
  expect(section.querySelector('.s-expl')!.textContent).toBe('習慣を表す現在形。');
});

it('前後の字幕を、単語の解説と字幕一文の意味の両方に添える', () => {
  const neighbors = { after: ['a rain check on that.'] };
  void runLookup(overlay, settings, 'take', "I'm gonna take", anchor(), neighbors);
  expect(request).toHaveBeenCalledWith({ type: 'explainSelection', selection: 'take', context: "I'm gonna take", after: ['a rain check on that.'] });
  expect(request).toHaveBeenCalledWith({ type: 'explainSentence', text: "I'm gonna take", after: ['a rain check on that.'] });
});

it('字幕一文の取得に失敗したら下段にエラーを出す', async () => {
  const lookup = runLookup(overlay, settings, 'run', 'I run.', anchor());
  pending[0]({ ok: true, kind: 'word', ipa: null, audioUrl: null });
  pending[1]({ ok: true, text: 'V[I]: 走る' });
  pending[2]({ ok: false, error: '取得に失敗しました' });
  await lookup;
  await Promise.resolve();
  const shadow = document.getElementById('useful-subtitle-overlay')!.shadowRoot!;
  expect(shadow.querySelector('.popup .sentence .err')!.textContent).toBe('取得に失敗しました');
});

it('字幕一文が空なら和訳を頼まず下段も出さない', async () => {
  const lookup = runLookup(overlay, settings, 'run', '', anchor());
  expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'explainSentence' }));
  pending[0]({ ok: true, kind: 'word', ipa: null, audioUrl: null });
  pending[1]({ ok: true, text: 'V[I]: 走る' });
  await lookup;
  const shadow = document.getElementById('useful-subtitle-overlay')!.shadowRoot!;
  expect(shadow.querySelector<HTMLDivElement>('.popup .sentence')!.hidden).toBe(true);
});

const AUTH = { ok: false, code: 'AUTH', error: 'Claude Code で利用する Claude Pro アカウントにログインし直してください。' };
// ログインボタンは Claude サブスク接続のときだけ出す。
const sub = { ...settings, provider: 'claude-subscription' as const };
const popup = () => document.getElementById('useful-subtitle-overlay')!.shadowRoot!;
async function flush(): Promise<void> { for (let i = 0; i < 5; i++) await Promise.resolve(); }

it('AUTH エラーでログインボタンを出し、ログイン成功後に意味引きをやり直す', async () => {
  const lookup = runLookup(overlay, sub, 'word', 'Video A', anchor());
  pending[0]({ ok: true, kind: 'word', ipa: null, audioUrl: null });
  pending[1](AUTH);
  pending[2](AUTH);
  await lookup; await flush();
  const btn = popup().querySelector<HTMLButtonElement>('.body .popup-action')!;
  expect(btn.textContent).toBe('ブラウザでログイン');
  expect(popup().querySelector('.sentence .popup-action')).not.toBeNull();
  btn.click();
  expect(request).toHaveBeenLastCalledWith({ type: 'login' });
  const waiting = popup().querySelector<HTMLButtonElement>('.body .popup-action')!;
  expect(waiting.textContent).toBe('ブラウザでログインを完了してください…');
  expect(waiting.disabled).toBe(true);
  pending[3]({ ok: true, text: 'OK' });
  await flush();
  // やり直し: lookupWord / explainSelection / explainSentence をもう一度送る。
  expect(request.mock.calls.slice(4).map(([req]) => req.type)).toEqual(['lookupWord', 'explainSelection', 'explainSentence']);
  pending[4]({ ok: true, kind: 'word', ipa: null, audioUrl: null });
  pending[5]({ ok: true, text: 'Fresh explanation' });
  pending[6]({ ok: true, text: '訳: 新しい和訳' });
  await flush();
  expect(popup().querySelector('.body')!.textContent).toContain('Fresh explanation');
});

it('ログイン失敗でメッセージとボタンを出し直す', async () => {
  const lookup = runLookup(overlay, sub, 'word', 'Video A', anchor());
  pending[0]({ ok: true, kind: 'word', ipa: null, audioUrl: null });
  pending[1](AUTH);
  pending[2]({ ok: true, text: '訳: 和訳' });
  await lookup; await flush();
  popup().querySelector<HTMLButtonElement>('.body .popup-action')!.click();
  pending[3]({ ok: false, code: 'AUTH', error: 'ログインできませんでした。もう一度お試しください。' });
  await flush();
  expect(popup().querySelector('.body')!.textContent).toContain('ログインできませんでした。もう一度お試しください。');
  const again = popup().querySelector<HTMLButtonElement>('.body .popup-action')!;
  expect(again.textContent).toBe('ブラウザでログイン');
  expect(again.disabled).toBe(false);
  expect(request).toHaveBeenCalledTimes(4);
});

it('ログイン中にポップアップを閉じたら、成功してもやり直さない', async () => {
  const lookup = runLookup(overlay, sub, 'word', 'Video A', anchor());
  pending[0]({ ok: true, kind: 'word', ipa: null, audioUrl: null });
  pending[1](AUTH);
  pending[2](AUTH);
  await lookup; await flush();
  popup().querySelector<HTMLButtonElement>('.body .popup-action')!.click();
  overlay.hidePopup();
  pending[3]({ ok: true, text: 'OK' });
  await flush();
  expect(request).toHaveBeenCalledTimes(4);
});

it('AUTH 以外のエラーにはボタンを出さない', async () => {
  const lookup = runLookup(overlay, sub, 'word', 'Video A', anchor());
  pending[0]({ ok: true, kind: 'word', ipa: null, audioUrl: null });
  pending[1]({ ok: false, code: 'NETWORK', error: '接続が切れました' });
  pending[2]({ ok: false, code: 'NETWORK', error: '接続が切れました' });
  await lookup; await flush();
  expect(popup().querySelector('.popup-action')).toBeNull();
});

it('API キー接続（anthropic）の AUTH エラーにはログインボタンを出さない', async () => {
  const lookup = runLookup(overlay, settings, 'word', 'Video A', anchor());
  pending[0]({ ok: true, kind: 'word', ipa: null, audioUrl: null });
  pending[1]({ ok: false, code: 'AUTH', error: 'API キーが無効です。' });
  pending[2]({ ok: false, code: 'AUTH', error: 'API キーが無効です。' });
  await lookup; await flush();
  expect(popup().querySelector('.body')!.textContent).toContain('API キーが無効です。');
  expect(popup().querySelector('.popup-action')).toBeNull();
});

it('ログイン応答が AUTH/CANCELED 以外（拡張の再読み込みなど）ならボタンを出し直さない', async () => {
  const lookup = runLookup(overlay, sub, 'word', 'Video A', anchor());
  pending[0]({ ok: true, kind: 'word', ipa: null, audioUrl: null });
  pending[1](AUTH);
  pending[2]({ ok: true, text: '訳: 和訳' });
  await lookup; await flush();
  popup().querySelector<HTMLButtonElement>('.body .popup-action')!.click();
  pending[3]({ ok: false, code: 'CONTEXT_INVALIDATED', error: '拡張機能が再読み込みされました。ページを再読み込みしてください。' });
  await flush();
  expect(popup().querySelector('.body')!.textContent).toContain('拡張機能が再読み込みされました。');
  expect(popup().querySelector('.popup-action')).toBeNull();
});

it('ログインが取り消された（CANCELED）ならボタンを出し直す', async () => {
  const lookup = runLookup(overlay, sub, 'word', 'Video A', anchor());
  pending[0]({ ok: true, kind: 'word', ipa: null, audioUrl: null });
  pending[1](AUTH);
  pending[2]({ ok: true, text: '訳: 和訳' });
  await lookup; await flush();
  popup().querySelector<HTMLButtonElement>('.body .popup-action')!.click();
  pending[3]({ ok: false, code: 'CANCELED', error: '設定・ページ・字幕の変更により処理を取り消しました。' });
  await flush();
  expect(popup().querySelector('.body')!.textContent).toContain('処理を取り消しました。');
  const again = popup().querySelector<HTMLButtonElement>('.body .popup-action')!;
  expect(again.textContent).toBe('ブラウザでログイン');
  expect(again.disabled).toBe(false);
});

it('上段と下段の両方にボタンがあるとき、1 回押すと両方が待機表示になりログイン依頼は 1 回だけ', async () => {
  const lookup = runLookup(overlay, sub, 'word', 'Video A', anchor());
  pending[0]({ ok: true, kind: 'word', ipa: null, audioUrl: null });
  pending[1](AUTH);
  pending[2]({ ...AUTH, error: '下段のエラー' });
  await lookup; await flush();
  popup().querySelector<HTMLButtonElement>('.body .popup-action')!.click();
  const top = popup().querySelector<HTMLButtonElement>('.body .popup-action')!;
  const bottom = popup().querySelector<HTMLButtonElement>('.sentence .popup-action')!;
  for (const btn of [top, bottom]) {
    expect(btn.textContent).toBe('ブラウザでログインを完了してください…');
    expect(btn.disabled).toBe(true);
  }
  // 各段は自分のエラー文を保つ。
  expect(popup().querySelector('.sentence')!.textContent).toContain('下段のエラー');
  expect(request.mock.calls.filter(([req]) => req.type === 'login')).toHaveLength(1);
  pending[3]({ ok: true, text: 'OK' });
  await flush();
  expect(request.mock.calls.slice(4).map(([req]) => req.type)).toEqual(['lookupWord', 'explainSelection', 'explainSentence']);
});

it('両方にボタンがあるときログインに失敗したら、両方にエラーとボタンを出し直す', async () => {
  const lookup = runLookup(overlay, sub, 'word', 'Video A', anchor());
  pending[0]({ ok: true, kind: 'word', ipa: null, audioUrl: null });
  pending[1](AUTH);
  pending[2](AUTH);
  await lookup; await flush();
  popup().querySelector<HTMLButtonElement>('.sentence .popup-action')!.click();
  pending[3]({ ok: false, code: 'AUTH', error: 'ログインできませんでした。もう一度お試しください。' });
  await flush();
  for (const sel of ['.body', '.sentence']) {
    expect(popup().querySelector(sel)!.textContent).toContain('ログインできませんでした。もう一度お試しください。');
    const btn = popup().querySelector<HTMLButtonElement>(`${sel} .popup-action`)!;
    expect(btn.textContent).toBe('ブラウザでログイン');
    expect(btn.disabled).toBe(false);
  }
  expect(request).toHaveBeenCalledTimes(4);
});
