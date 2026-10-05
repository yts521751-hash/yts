import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** 台股產業 K 線 API 已下線（頁面／導覽入口已移除；均線掃描改讀本機 lib） */
export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: "產業 K 線功能已下線",
      gone: true,
    },
    { status: 410 },
  );
}
