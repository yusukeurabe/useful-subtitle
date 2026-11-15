const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 発音ボタン用のスピーカーアイコン（線画 SVG）。色は currentColor に従う。
 * 絵文字（🔊）は OS ごとに見た目が変わり UI から浮くため、アイコンで統一する。
 */
export function createSpeakerIcon(size = 16): SVGSVGElement {
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
  for (const d of [
    'M4 9.5h3.5L12 5.5v13l-4.5-4H4z', // スピーカー本体
    'M15.5 9a4.5 4.5 0 0 1 0 6', // 内側の音波
    'M18.5 6a8.5 8.5 0 0 1 0 12', // 外側の音波
  ]) {
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
