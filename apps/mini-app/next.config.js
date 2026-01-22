/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for monorepo with shared packages
  transpilePackages: ['@jungschar/shared'],

  webpack: (config) => {
    // Fix path aliases in monorepo
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': __dirname,
    }
    return config
  },
}

module.exports = nextConfig
