/**
 * Prime Video の「いま見ている作品」を見分ける純粋ロジック。
 *
 * 動画を切り替えたら字幕履歴を全消去したいが、Prime は広告・プレビュー用に複数の
 * <video> を持ち、生のメディアイベントは広告でも発火する。広告で履歴を誤って消さない
 * よう、「作品が本当に変わったか」を URL 由来の作品コードと本編の尺（duration）という
 * 2つの非破壊シグナルの論理和で判定する。どちらの取りこぼしも「消えないだけ」で、
 * 誤消去は構造的に起こさない。
 */

/**
 * URL から Prime の安定した作品コードを取り出す。取れなければ ''（空文字）。
 * クエリ・ref・ハッシュ等の揺れは含めない（同一作品内の URL 微変化で誤判定しない）。
 */
export function extractContentId(href: string): string {
  // 1) GTI（エピソード単位で最も精密）: amzn1.dv.gti.<token>
  const gti = href.match(/amzn1\.dv\.gti\.[A-Za-z0-9-]+/);
  if (gti) return gti[0];
  // 2) ASIN: /gp/video/detail/<id> | /detail/<id> | /dp/<id> のパス位置のトークン
  const asin = href.match(/\/(?:gp\/video\/detail|detail|dp)\/([A-Za-z0-9]{6,})/);
  if (asin) return asin[1];
  return '';
}

export interface TitleSwitchInput {
  /** extractContentId(location.href) の結果。取れなければ ''。 */
  id: string;
  /** 本編 video の duration（秒）。未ロードは NaN、ライブは Infinity でよい。 */
  durationRaw: number;
}

export interface TitleSwitchDetector {
  /** 作品が切り替わったと判定したら true（＝履歴を消すべき）。基準も更新する。 */
  check(input: TitleSwitchInput): boolean;
}

export interface TitleSwitchOptions {
  /** 本編とみなす最低尺（秒）。これ未満の duration は尺シグナルとして無視。既定 300。 */
  minTitleSeconds?: number;
  /** 尺が「変わった」とみなす差の閾値（秒）。微小ゆらぎを吸収。既定 1。 */
  durationToleranceSeconds?: number;
}

/**
 * 直近の作品コード・本編尺を保持し、「id 変化」または「尺が閾値以上の別値へ変化」で
 * 切替（true）と判定する。短尺（広告）・NaN・Infinity の尺は無視。初回は基準確立のみ。
 */
export function createTitleSwitchDetector(opts: TitleSwitchOptions = {}): TitleSwitchDetector {
  const minTitleSeconds = opts.minTitleSeconds ?? 300;
  const tol = opts.durationToleranceSeconds ?? 1;

  let lastId: string | null = null;
  let lastDuration: number | null = null;

  return {
    check({ id, durationRaw }: TitleSwitchInput): boolean {
      // 本編とみなせる尺だけを尺シグナルとして採用（広告・短尺・未ロードは除外）。
      const qualifies = Number.isFinite(durationRaw) && durationRaw >= minTitleSeconds;
      const effDur = qualifies ? durationRaw : null;

      const hasBaseline = lastId !== null || lastDuration !== null;
      const idChanged = id !== '' && lastId !== null && id !== lastId;
      const durChanged =
        effDur !== null && lastDuration !== null && Math.abs(effDur - lastDuration) > tol;
      const switched = hasBaseline && (idChanged || durChanged);

      // 基準更新: 空文字は良い基準を上書きしない／短尺・NaN は尺基準を上書きしない。
      if (id !== '') lastId = id;
      if (effDur !== null) lastDuration = effDur;

      return switched;
    },
  };
}
