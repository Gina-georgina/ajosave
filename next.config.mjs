/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle (`.next/standalone`) for the
  // production container: Next traces only the packages the server code
  // imports, instead of shipping the whole `node_modules`.
  output: "standalone",
  serverExternalPackages: ["@stellar/stellar-sdk"],
};

export default nextConfig;
