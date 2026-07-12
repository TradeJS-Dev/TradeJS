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
};

export default nextConfig;
