import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
};

/** 美股版已移除產業 K 線；殘留連結一律回美股首頁（不回台股 /） */
export default async function UsSectorRedirectPage(_props: Props) {
  redirect("/us");
}
