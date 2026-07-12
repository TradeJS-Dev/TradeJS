/** @type {import('next').NextConfig} */

const nextConfig = {
  // webpack(config) {
  //   config.module.parser = {
  //     ...config.module.parser,
  //     javascript: { ...config.module.parser?.javascript, dataUrlCondition: { maxSize: 1024 } }, // 1KB
  //   };
  //   return config;
  // },
  serverExternalPackages: ['@tradejs/node', 'ts-node', 'tsconfig-paths'],
  experimental: {
    externalDir: true,
    optimizePackageImports: ['@chakra-ui/react'],
  },
  async redirects() {
    return [
      {
        source: '/routes/dashboard/:symbol/:interval',
        destination: '/routes/dashboard/bybit/crypto/:symbol/:interval',
        permanent: false,
      },
      {
        source: '/api/kline/:symbol/:interval',
        destination: '/api/kline/bybit/crypto/:symbol/:interval',
        permanent: false,
      },
      {
        source: '/routes/dashboard/:provider/:symbol/:interval',
        destination: '/routes/dashboard/:provider/crypto/:symbol/:interval',
        permanent: false,
      },
      {
        source: '/api/kline/:provider/:symbol/:interval',
        destination: '/api/kline/:provider/crypto/:symbol/:interval',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
