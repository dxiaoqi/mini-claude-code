/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone mode: creates a self-contained server in .next/standalone/
  // that can run without installing node_modules separately.
  // Used by `npm run build:web` to package the UI for npm distribution.
  output: 'standalone',

  env: {
    NEXT_PUBLIC_MODEL_NAME: process.env.ARTIFACTS_LLM_MODEL || 'claude',
    NEXT_PUBLIC_DEBUG: process.env.ARTIFACTS_DEBUG || '',
    NEXT_PUBLIC_LUMI_URL: process.env.NEXT_PUBLIC_LUMI_URL || 'http://localhost:3001',
  },

  experimental: {
    serverComponentsExternalPackages: [],
  },
}

export default nextConfig
