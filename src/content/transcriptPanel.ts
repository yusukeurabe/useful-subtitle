export interface TranscriptEntry {
  /** 行を一意に識別する連番（翻訳の後追い更新に使う）。 */
  id: number;
  /** 整形済み（truecase 適用後）の英文。 */
  english: string;
  /** この字幕が出た瞬間の動画再生位置（秒）。クリックで巻き戻す先。 */
  videoTime: number;
}

export interface TranscriptPanelCallbacks {
  /** 行クリックでその場面へシークする。 */
  onSeek: (videoTime: number) => void;
}

export interface TranscriptPanel {
  append(entry: TranscriptEntry): void;
  setTranslation(id: number, japanese: string): void;
  /** 動画の現在再生位置（秒）から、いま再生中の行を判定して .active を付け替える。 */
  updateActiveByTime(currentTime: number): void;
  destroy(): void;
}

const STYLES = `
.host {
  position: fixed; top: 0; right: 0; width: 320px; height: 100%;
  z-index: 2147483000; pointer-events: auto;
  font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
}
.panel {
  display: flex; flex-direction: column; height: 100%;
  background: rgba(20, 20, 20, 0.82); color: #f3f3f3;
  backdrop-filter: blur(2px);
}
.header {
  flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; font-size: 13px; font-weight: 700; border-bottom: 1px solid #444;
}
.header .x { cursor: pointer; color: #aaa; font-size: 16px; line-height: 1; }
.list { flex: 1 1 auto; overflow-y: auto; padding: 6px 0; }
.row {
  padding: 8px 12px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.06);
}
.row:hover { background: rgba(86, 156, 255, 0.18); }
.row.active {
  background: rgba(86, 156, 255, 0.14);
  box-shadow: inset 4px 0 0 #569cff;
}
.row .en { font-size: 13px; line-height: 1.4; }
.row .ja { font-size: 12px; line-height: 1.4; color: #ffe08a; margin-top: 2px; }
.reopen {
  position: fixed; top: 8px; right: 8px; z-index: 2147483000;
  background: rgba(20,20,20,0.82); color: #fff; border: 1px solid #555;
  border-radius: 6px; padding: 4px 8px; font-size: 12px; cursor: pointer;
  pointer-events: auto;
  font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
}
`;

export function createTranscriptPanel(cb: TranscriptPanelCallbacks): TranscriptPanel {
  const host = document.createElement('div');
  host.id = 'useful-subtitle-transcript';
  // 外側ホストにも最前面の z-index を置く。これが無いと再生本編で Prime Video の
  // プレイヤー（全面・高 z-index）に重なられ、履歴パネルが裏へ隠れてしまう。
  host.style.cssText = 'position:fixed;inset:0 0 0 auto;pointer-events:none;z-index:2147483000;';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);

  const panelHost = document.createElement('div');
  panelHost.className = 'host';
  const panel = document.createElement('div');
  panel.className = 'panel';
  const header = document.createElement('div');
  header.className = 'header';
  const title = document.createElement('span');
  title.textContent = '字幕の履歴';
  const closeX = document.createElement('span');
  closeX.className = 'x';
  closeX.textContent = '×';
  closeX.title = 'パネルを閉じる';
  header.append(title, closeX);
  const list = document.createElement('div');
  list.className = 'list';
  panel.append(header, list);
  panelHost.appendChild(panel);
  shadow.appendChild(panelHost);

  const reopen = document.createElement('button');
  reopen.className = 'reopen';
  reopen.textContent = '☰ 字幕履歴';
  reopen.style.display = 'none';
  shadow.appendChild(reopen);

  const setVisible = (visible: boolean): void => {
    panelHost.style.display = visible ? '' : 'none';
    reopen.style.display = visible ? 'none' : '';
  };
  closeX.addEventListener('click', () => setVisible(false));
  reopen.addEventListener('click', () => setVisible(true));

  const jaById = new Map<number, HTMLDivElement>();
  // 行と videoTime の対応を追加順に保持する（現在行判定に使う）。
  const rows: { videoTime: number; el: HTMLDivElement }[] = [];
  // いま .active が付いている行（無ければ null）。
  let activeRow: HTMLDivElement | null = null;
  // 再生時刻の読み取りと記録時刻のわずかなずれを吸収する許容誤差（秒）。
  const ACTIVE_EPSILON = 0.25;

  function append(entry: TranscriptEntry): void {
    const row = document.createElement('div');
    row.className = 'row';
    row.addEventListener('click', () => cb.onSeek(entry.videoTime));
    const en = document.createElement('div');
    en.className = 'en';
    en.textContent = entry.english;
    const ja = document.createElement('div');
    ja.className = 'ja';
    row.append(en, ja);
    list.appendChild(row);
    jaById.set(entry.id, ja);
    rows.push({ videoTime: entry.videoTime, el: row });
    list.scrollTop = list.scrollHeight;
  }

  function setTranslation(id: number, japanese: string): void {
    const ja = jaById.get(id);
    if (ja) ja.textContent = japanese;
  }

  function updateActiveByTime(currentTime: number): void {
    // 「videoTime <= currentTime（+許容誤差）を満たす行のうち videoTime 最大の行」を現在行とする。
    // タイが出たら後から追加された行（id が後）を優先する（>= で上書き）。
    let next: HTMLDivElement | null = null;
    let bestTime = -Infinity;
    for (const r of rows) {
      if (r.videoTime <= currentTime + ACTIVE_EPSILON && r.videoTime >= bestTime) {
        bestTime = r.videoTime;
        next = r.el;
      }
    }
    if (next === activeRow) return;
    activeRow?.classList.remove('active');
    next?.classList.add('active');
    activeRow = next;
  }

  // --- マウント & 全画面追従 ---
  // Prime Video は全画面時に「全画面要素とその子孫」しか描画しないため、
  // body 直下のままだと履歴パネルが見えなくなる。overlay と同じく全画面要素の
  // 中へ入れ直し、全画面の出入りに追従する。
  const attach = (): void => {
    const target = document.fullscreenElement ?? document.body;
    if (host.parentElement !== target) target.appendChild(host);
  };
  const onFullscreenChange = (): void => attach();

  function destroy(): void {
    document.removeEventListener('fullscreenchange', onFullscreenChange, true);
    host.remove();
    jaById.clear();
  }

  document.addEventListener('fullscreenchange', onFullscreenChange, true);
  attach();
  return { append, setTranslation, updateActiveByTime, destroy };
}
