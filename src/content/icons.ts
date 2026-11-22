const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 発音ボタン用のスピーカーアイコン（線画 SVG）。色は currentColor に従う。
 * 絵文字（🔊）は OS ごとに見た目が変わり UI から浮くため、アイコンで統一する。
 */
export function createSpeakerIcon(size = 16): SVGSVGElement {
  return createLineIcon(size, [
    'M4 9.5h3.5L12 5.5v13l-4.5-4H4z', // スピーカー本体
    'M15.5 9a4.5 4.5 0 0 1 0 6', // 内側の音波
    'M18.5 6a8.5 8.5 0 0 1 0 12', // 外側の音波
  ]);
}

/** 履歴の消去ボタン用のゴミ箱アイコン（線画 SVG）。 */
export function createTrashIcon(size = 14): SVGSVGElement {
  return createLineIcon(size, [
    'M4 7h16', // ふたの線
    'M9 7V4.5h6V7', // 取っ手
    'M6 7l1 13h10l1-13', // 本体
    'M10 11v5', // 縦線（左）
    'M14 11v5', // 縦線（右）
  ]);
}

/** パネルを閉じるボタン用のバツ印アイコン（線画 SVG）。 */
export function createCloseIcon(size = 14): SVGSVGElement {
  return createLineIcon(size, ['M6 6l12 12', 'M18 6L6 18']);
}

/** 再生/一時停止ボタン用の再生アイコン（塗りつぶしの右向き三角）。 */
export function createPlayIcon(size = 16): SVGSVGElement {
  return createFilledIcon(size, ['M7 4.5v15l12.5-7.5z']);
}

/** 再生/一時停止ボタン用の一時停止アイコン（塗りつぶしの縦棒2本）。 */
export function createPauseIcon(size = 16): SVGSVGElement {
  return createFilledIcon(size, ['M6 4.5h4v15H6z', 'M14 4.5h4v15h-4z']);
}

/** 字幕リストの開閉ボタン用のリストアイコン（線画 SVG の横線3本）。 */
export function createListIcon(size = 16): SVGSVGElement {
  return createLineIcon(size, ['M5 7h14', 'M5 12h14', 'M5 17h14']);
}

/** 24x24 の塗りつぶしアイコンを作る共通処理。色は currentColor に従う。 */
function createFilledIcon(size: number, paths: string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

/** 24x24 の線画アイコンを作る共通処理。色は currentColor に従う。 */
function createLineIcon(size: number, paths: string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

/** アイコンだけの発音ボタン。className でポップアップごとのスタイルを当てる。 */
export function createSpeakerButton(className: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.title = '発音を再生';
  btn.setAttribute('aria-label', '発音を再生');
  btn.appendChild(createSpeakerIcon());
  return btn;
}
