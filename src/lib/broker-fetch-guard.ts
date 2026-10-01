/** 換股後忽略舊請求的 setState（abort 與 code 雙重把關） */
export function shouldApplyBrokerFetch(
  requestCode: string,
  activeCode: string,
  aborted: boolean,
): boolean {
  return !aborted && requestCode === activeCode;
}
