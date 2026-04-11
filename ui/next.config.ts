import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',          // 生成静态文件到 out/，供 mini-claude-code 内嵌
  trailingSlash: true,       // 路径末尾加 /，兼容静态服务器
  images: { unoptimized: true }, // 静态导出不支持 Image Optimization
};

export default nextConfig;
