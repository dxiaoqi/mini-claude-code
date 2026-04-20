/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_MODEL_NAME: process.env.ARTIFACTS_LLM_MODEL || 'claude',
    NEXT_PUBLIC_DEBUG: process.env.ARTIFACTS_DEBUG || '',
    NEXT_PUBLIC_MINI_CLAUDE_URL: process.env.NEXT_PUBLIC_MINI_CLAUDE_URL || 'http://localhost:3001',
  },
  experimental: {
    serverComponentsExternalPackages: [],
  },
  // Allow server-side fetch to mini-claude-code backend
  async rewrites() {
    return []
  },
}

export default nextConfig
