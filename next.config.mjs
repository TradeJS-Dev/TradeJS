/** @type {import('next').NextConfig} */

const nextConfig = {
  // webpack(config) {
  //   config.module.parser = {
  //     ...config.module.parser,
  //     javascript: { ...config.module.parser?.javascript, dataUrlCondition: { maxSize: 1024 } }, // 1KB
  //   };
  //   return config;
  // },
  experimental: {
    optimizePackageImports: ['@chakra-ui/react'],
  },
  async redirects() {
    return [
      {
        source: '/routes/dashboard/:symbol/:interval',
        destination: '/routes/dashboard/bybit/:symbol/:interval',
        permanent: false,
      },
      {
        source: '/api/kline/:symbol/:interval',
        destination: '/api/kline/bybit/:symbol/:interval',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
