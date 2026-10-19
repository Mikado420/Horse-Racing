// 文字入力まわりの不具合対策（スマートフォン）
// - iOS Safari は文字の大きさが 16px 未満の入力欄にフォーカスすると画面を拡大する。
//   入力欄はすべて 16px 以上にしてある（styles.css の末尾）。ここではもう一つの症状を扱う。
// - キーボードを出すと、入力欄を見せるためにページ全体が上へずらされ、閉じた後もずれたまま残ることがある。
//   画面全体を固定の高さで作っている（ページ自体はスクロールしない）ので、閉じたら元の位置に戻す。

const FIELD = "input:not([type=range]):not([type=radio]):not([type=checkbox]):not([type=file]):not([type=button]), textarea, select";

function isField(el: Element | null): boolean {
  return !!el && el.matches(FIELD);
}

/** ページそのものはスクロールしない作りか（ずれが出ていたら、それはキーボードによるもの） */
function pageIsFixed(): boolean {
  const de = document.documentElement;
  return de.scrollHeight <= window.innerHeight + 2 || getComputedStyle(document.body).overflow === "hidden";
}

function restore() {
  if (isField(document.activeElement)) return;
  if (!pageIsFixed()) return;
  if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
}

export function initKeyboardFix(): void {
  if (typeof window === "undefined") return;
  document.addEventListener("focusout", (e) => {
    if (!isField(e.target as Element)) return;
    // 次の入力欄へ移っただけなら戻さない
    window.setTimeout(restore, 80);
  });
  // キーボードを閉じたことで見える範囲が戻ったとき（iOS ではフォーカスが外れないまま閉じることもある）
  window.visualViewport?.addEventListener("resize", () => {
    const vv = window.visualViewport!;
    if (vv.height >= window.innerHeight - 1) window.setTimeout(restore, 50);
  });
}
