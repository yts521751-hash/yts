import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 雲端／反向代理常以 127.0.0.1 連入，避免開發警告影響開頁
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
