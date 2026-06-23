/** @type {import('next').NextConfig} */
const nextConfig = {
  // OFF on purpose: StrictMode double-invokes effects in dev, which tears down and
  // recreates the single Socket.IO connection ("WebSocket is closed before the
  // connection is established") and can drop the first events on a fresh socket.
  // A realtime socket wants one stable connection, so we don't double-mount it.
  reactStrictMode: false,
  // NOTE: @slop/shared is pre-built to plain CommonJS (packages/shared/dist), so
  // it's consumed as a normal dependency. Do NOT add it to transpilePackages —
  // that makes the dev React-Refresh loader inject `import.meta` into the CJS
  // file and crashes with "Cannot use 'import.meta' outside a module".
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
