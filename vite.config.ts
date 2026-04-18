import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

const LLM_PATH = '/api/llm';

function llmProxyPlugin(env: Record<string, string>): Plugin {
  const apiKey = env.DEEPSEEK_API_KEY ?? '';
  const model = env.DEEPSEEK_MODEL || 'deepseek-chat';
  const baseUrl = (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  const upstream = `${baseUrl}/chat/completions`;

  return {
    name: 'maze-trials-llm-proxy',
    configureServer(server) {
      server.middlewares.use(LLM_PATH, async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method Not Allowed');
          return;
        }
        if (!apiKey || apiKey === 'sk-replace-me') {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'DEEPSEEK_API_KEY missing in .env.local' }));
          return;
        }

        let raw = '';
        req.setEncoding('utf-8');
        req.on('data', (chunk) => { raw += chunk; });
        req.on('end', async () => {
          let body: Record<string, unknown>;
          try {
            body = raw ? JSON.parse(raw) : {};
          } catch {
            res.statusCode = 400;
            res.end('Invalid JSON body');
            return;
          }

          // Inject model if caller did not specify one.
          if (!body.model) body.model = model;

          const t0 = Date.now();
          try {
            const upstreamRes = await fetch(upstream, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
              },
              body: JSON.stringify(body),
            });
            const text = await upstreamRes.text();
            const dt = Date.now() - t0;
            const preview = text.replace(/\s+/g, ' ').slice(0, 140);
            console.log(`[llm-proxy] ${upstreamRes.status} ${dt}ms :: ${preview}`);
            res.statusCode = upstreamRes.status;
            res.setHeader('Content-Type', upstreamRes.headers.get('content-type') ?? 'application/json');
            res.end(text);
          } catch (err) {
            const dt = Date.now() - t0;
            console.log(`[llm-proxy] ERR ${dt}ms :: ${(err as Error).message}`);
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: `Upstream LLM error: ${(err as Error).message}` }));
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['DEEPSEEK_']);
  return {
    plugins: [llmProxyPlugin(env)],
  };
});
