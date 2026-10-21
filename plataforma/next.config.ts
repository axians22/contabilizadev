import type { NextConfig } from "next";
import { REDIRECIONAMENTOS } from "./lib/redirecionamentos";

const nextConfig: NextConfig = {
  // O núcleo é TypeScript puro (sem build): o Next compila junto com a plataforma.
  transpilePackages: ["@contabilizadev/nucleo"],
  // O validador dos esquemas do eSocial (Parte 7) carrega um .wasm do próprio pacote: fica fora do empacotamento.
  serverExternalPackages: ["xmllint-wasm"],
  devIndicators: false,
  redirects: async () => REDIRECIONAMENTOS,
};

export default nextConfig;
