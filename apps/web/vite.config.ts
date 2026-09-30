import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const cesiumDir = fileURLToPath(new URL('../../node_modules/cesium/Build/Cesium', import.meta.url));
const cesiumCopy = '../../node_modules/cesium/Build/Cesium';

const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
  '.wasm': 'application/wasm',
};

/**
 * CesiumJS loads workers (as ES modules), textures and widget CSS from CESIUM_BASE_URL at run time.
 * In development, serve them straight from node_modules (Vite would otherwise answer .js requests
 * under /cesium with the SPA fallback); production builds copy them with vite-plugin-static-copy.
 */
function cesiumDevServer(): Plugin {
  return {
    name: 'cesium-dev-server',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/cesium', (req, res, next) => {
        const rel = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]!)).replace(
          /^[/\\]+/,
          '',
        );
        const file = join(cesiumDir, rel);
        if (!file.startsWith(cesiumDir) || !existsSync(file) || !statSync(file).isFile())
          return next();
        res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  define: { CESIUM_BASE_URL: JSON.stringify('/cesium') },
  plugins: [
    cesiumDevServer(),
    viteStaticCopy({
      targets: [
        { src: `${cesiumCopy}/ThirdParty`, dest: 'cesium' },
        { src: `${cesiumCopy}/Workers`, dest: 'cesium' },
        { src: `${cesiumCopy}/Widgets`, dest: 'cesium' },
        { src: `${cesiumCopy}/Assets/Textures/NaturalEarthII`, dest: 'cesium/Assets/Textures' },
        { src: `${cesiumCopy}/Assets/Textures/SkyBox`, dest: 'cesium/Assets/Textures' },
        { src: `${cesiumCopy}/Assets/IAU2006_XYS`, dest: 'cesium/Assets' },
        { src: `${cesiumCopy}/Assets/Images`, dest: 'cesium/Assets' },
        { src: `${cesiumCopy}/Assets/approximateTerrainHeights.json`, dest: 'cesium/Assets' },
      ],
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 8000 },
});
