import { redirect } from "next/navigation";

/** 新聞頁簽已移除，導向價值選股 */
export default function NewsRedirectPage() {
  redirect("/value");
}
