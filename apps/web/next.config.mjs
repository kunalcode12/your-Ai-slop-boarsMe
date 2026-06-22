/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // NOTE: @slop/shared is pre-built to plain CommonJS (packages/shared/dist), so
  // it's consumed as a normal dependency. Do NOT add it to transpilePackages —
  // that makes the dev React-Refresh loader inject `import.meta` into the CJS
  // file and crashes with "Cannot use 'import.meta' outside a module".
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
