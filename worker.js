import { onRequest as handleApiRequest } from "./functions/api/v1/[[path]].js";

// Cloudflare Workers target: reuse the same API handler used by Pages Functions.
// Static requests are served by the Workers Static Assets binding.
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApiRequest({
        request,
        env,
        waitUntil: (promise) => ctx.waitUntil(promise),
        runtimeName: "Cloudflare Workers",
      });
    }
    return env.ASSETS.fetch(request);
  },
};
