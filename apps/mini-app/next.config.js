/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Fix path aliases
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': __dirname,
    }
    return config
  },
}

module.exports = nextConfig
