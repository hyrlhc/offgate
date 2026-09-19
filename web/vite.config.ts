import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import signEntitlement from './api/sign-entitlement.js';

/**
 * Gelistirme sirasinda `/api/sign-entitlement` ucunu ayaga kaldirir.
 * Uretimde ayni handler Vercel serverless fonksiyonu olarak calisir.
 * Operator gizli anahtari her iki durumda da yalnizca sunucu tarafinda kalir.
 */
function devApi() {
  return {
    name: 'offgate-dev-api',
    configureServer(server: any) {
      server.middlewares.use('/api/sign-entitlement', async (req: any, res: any) => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c);
        req.body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
        res.status = (code: number) => { res.statusCode = code; return res; };
        res.json = (obj: unknown) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(obj));
        };
        await signEntitlement(req, res);
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    // Stellar SDK tarayicida Buffer ve stream bekliyor.
    nodePolyfills({ globals: { Buffer: true, global: true, process: true } }),
    devApi(),
  ],
  server: { host: true },
});
