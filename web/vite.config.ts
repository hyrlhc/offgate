import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import signEntitlement from './api/sign-entitlement.js';

/**
 * Gelistirme sunucusunun sunucu tarafi icin gizli degiskenleri yukler.
 *
 * Vite `.env` dosyalarini yalnizca `import.meta.env`e koyar ve VITE_ oneki
 * olmayanlari tarayiciya hic vermez — dolayisiyla `process.env.OPERATOR_SECRET`
 * bos kalir. Uretimde bu degeri Vercel veriyor; yerelde repo kokundeki `.env`
 * ile `web/.env.local` dosyalarindan okuyoruz. Kabuktan gelen deger onceliklidir.
 */
function loadServerEnv() {
  for (const file of ['../.env', '.env.local', '.env']) {
    let text: string;
    try {
      text = readFileSync(new URL(file, import.meta.url), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const value = m[2].trim().replace(/^["']|["']$/g, '');
      if (value && process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
  }
}
loadServerEnv();

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
