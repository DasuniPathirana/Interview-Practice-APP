/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  webpack: (config, { isServer }) => {
    config.externals = [...(config.externals || []), 'better-sqlite3'];

    if (isServer) {
      config.externals.push('ffmpeg-static');
    }

    config.resolve.alias = {
      ...config.resolve.alias,
      'sharp$': false,
      'onnxruntime-node$': false,
    };

    return config;
  },
  experimental: {
    serverComponentsExternalPackages: ['@xenova/transformers', 'wavefile', 'ffmpeg-static'],
  },
};

module.exports = nextConfig;
