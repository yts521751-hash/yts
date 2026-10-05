import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
};

/** 台股產業 K 線已下線；殘留連結一律回首頁（美股版同理回 /us） */
export default async function SectorRedirectPage(_props: Props) {
  redirect("/");
}
