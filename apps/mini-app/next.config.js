/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable standalone output for better deployment
  output: 'standalone',
  // Required for monorepo with shared packages
  transpilePackages: ['@jungschar/shared'],
}

module.exports = nextConfig
