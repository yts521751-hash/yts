import { redirect } from "next/navigation";

/** 美股版已移除產業均線掃描；殘留書籤導回美股首頁 */
export default function UsMaRedirectPage() {
  redirect("/us");
}
