/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @slop/shared ships as workspace TS/CJS — transpile it into the bundle.
  transpilePackages: ["@slop/shared"],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
