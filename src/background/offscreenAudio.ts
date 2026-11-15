/** offscreen ドキュメントの操作（テストで差し替え可能）。 */
export interface OffscreenApi {
  /** offscreen ドキュメントが今あるか。 */
  hasDocument: () => Promise<boolean>;
  /** offscreen ドキュメントを作る。既にあれば「single offscreen」エラーで reject し得る。 */
  createDocument: () => Promise<void>;
  /** offscreen に再生を依頼し、その応答（{ played, error? }）を返す。 */
  sendPlay: (url: string) => Promise<unknown>;
}

interface PlayResult {
  played: boolean;
  error?: string;
}

function isPlayResult(v: unknown): v is PlayResult {
  return typeof v === 'object' && v !== null && typeof (v as PlayResult).played === 'boolean';
}

function isNoReceiver(e: unknown): boolean {
  return /receiving end does not exist|message port closed/i.test(String(e));
}

/**
 * offscreen で音源を再生する関数を作る。
 *
 * AUDIO_PLAYBACK の offscreen は「音が鳴っていない状態が30秒続くと Chrome が自動で閉じる」。
 * 一度作ったら作成済みとみなす方式だと、30秒以上あけた2回目以降の再生は届け先が無く
 * 失敗していた（＝TTS にフォールバック）。そこで毎回存在を確かめ、無ければ作り直す。
 * 再生の成否は offscreen の応答で判断し、失敗なら例外にして呼び出し側の TTS に任せる。
 */
export function createOffscreenAudioPlayer(api: OffscreenApi): (url: string) => Promise<void> {
  let creating: Promise<void> | null = null;

  async function ensureDocument(): Promise<void> {
    if (await api.hasDocument()) return;
    if (!creating) {
      creating = api
        .createDocument()
        .catch((e: unknown) => {
          // 既に存在していれば成功扱い。
          if (!String(e).toLowerCase().includes('single offscreen')) throw e;
        })
        .finally(() => {
          creating = null;
        });
    }
    await creating;
  }

  return async (url: string): Promise<void> => {
    for (let attempt = 0; ; attempt++) {
      await ensureDocument();
      let res: unknown;
      try {
        res = await api.sendPlay(url);
      } catch (e) {
        // 存在確認の直後に閉じられた等で受信先が無い → 作り直して1回だけ再送。
        if (attempt === 0 && isNoReceiver(e)) continue;
        throw e;
      }
      if (isPlayResult(res) && res.played) return;
      throw new Error(isPlayResult(res) && res.error ? res.error : 'offscreen で再生できませんでした');
    }
  };
}
