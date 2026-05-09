type SiteConfig = {
  domain: string;
  adminUrl?: string;
};

const SITES = [
  { domain: "prohgrammer.com" },
  { domain: "mildprogramming.com" },
  { domain: "datadrivendevelopment.org" },
] as const satisfies readonly SiteConfig[];

const CHECK_TIMEOUT_MS = 8000;

export type SiteName = typeof SITES[number]["domain"];

export type SiteStatus = {
  site: SiteName;
  url: string;
  ok: boolean;
  status: number | null;
  statusText: string;
  latencyMs: number | null;
  checkedAt: string;
  error?: string;
};

type Fetcher = typeof fetch;
type Now = () => number;

type Env = {
  ACCESS_AUD?: string;
  ACCESS_JWKS_URL?: string;
  ACCESS_ISSUER?: string;
};

type AccessAuthConfig = {
  aud: string;
  jwksUrl: string;
  issuer: string;
  fetcher?: Fetcher;
  now?: () => number;
};

type Jwk = JsonWebKey & {
  kid?: string;
  alg?: string;
};

type Jwks = {
  keys: Jwk[];
};

type JwtHeader = {
  alg?: string;
  kid?: string;
};

type JwtPayload = {
  aud?: string | string[];
  iss?: string;
  exp?: number;
  nbf?: number;
};

export function getSites(): readonly SiteName[] {
  return SITES.map((site) => site.domain);
}

export async function checkSite(
  site: SiteName,
  fetcher: Fetcher = fetch,
  now: Now = () => performance.now(),
): Promise<SiteStatus> {
  const url = `https://${site}/`;
  const startedAt = now();

  try {
    const response = await fetcher(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      headers: {
        "cache-control": "no-cache",
      },
    });

    return {
      site,
      url,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText || statusTextFor(response.status),
      latencyMs: Math.max(0, Math.round(now() - startedAt)),
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      site,
      url,
      ok: false,
      status: null,
      statusText: "Request failed",
      latencyMs: null,
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function checkAllSites(
  fetcher: Fetcher = fetch,
): Promise<SiteStatus[]> {
  return Promise.all(SITES.map((site) => checkSite(site.domain, fetcher)));
}

export async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/status") {
    const results = await checkAllSites();
    return json({
      checkedAt: new Date().toISOString(),
      sites: results,
    });
  }

  if (url.pathname === "/health") {
    return new Response("ok\n", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    return new Response(renderDashboard(), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  return new Response("Not found\n", { status: 404 });
}

export async function handleAuthenticatedRequest(
  request: Request,
  config: AccessAuthConfig,
): Promise<Response> {
  const authorized = await validateAccessJwt(request, config);
  if (!authorized) {
    return new Response("Unauthorized\n", {
      status: 401,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  return handleRequest(request);
}

export function getAccessAuthConfig(env: Env): AccessAuthConfig | null {
  if (!env.ACCESS_AUD || !env.ACCESS_JWKS_URL || !env.ACCESS_ISSUER) {
    return null;
  }

  return {
    aud: env.ACCESS_AUD,
    jwksUrl: env.ACCESS_JWKS_URL,
    issuer: env.ACCESS_ISSUER,
  };
}

export async function validateAccessJwt(
  request: Request,
  config: AccessAuthConfig,
): Promise<boolean> {
  const token = getAccessToken(request);
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;

  try {
    const header = parseJwtPart<JwtHeader>(parts[0]);
    const payload = parseJwtPart<JwtPayload>(parts[1]);

    if (header.alg !== "RS256" || !header.kid) return false;
    if (payload.iss !== config.issuer) return false;
    if (!hasAudience(payload.aud, config.aud)) return false;

    const now = Math.floor((config.now?.() ?? Date.now()) / 1000);
    if (typeof payload.exp !== "number" || payload.exp <= now) return false;
    if (typeof payload.nbf === "number" && payload.nbf > now) return false;

    const jwk = await findJwk(header.kid, config);
    if (!jwk) return false;

    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );

    return crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64UrlDecode(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    return false;
  }
}

function json(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init?.headers,
    },
  });
}

function statusTextFor(status: number): string {
  if (status >= 200 && status < 300) return "OK";
  if (status >= 300 && status < 400) return "Redirect";
  if (status >= 400 && status < 500) return "Client error";
  if (status >= 500) return "Server error";
  return "Unknown";
}

function getAccessToken(request: Request): string | null {
  const headerToken = request.headers.get("Cf-Access-Jwt-Assertion");
  if (headerToken) return headerToken;

  const cookie = request.headers.get("Cookie");
  const match = cookie?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function parseJwtPart<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(part))) as T;
}

function base64UrlDecode(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - normalized.length % 4) % 4),
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer;
}

function hasAudience(actual: JwtPayload["aud"], expected: string): boolean {
  if (typeof actual === "string") return actual === expected;
  return Array.isArray(actual) && actual.includes(expected);
}

async function findJwk(
  kid: string,
  config: AccessAuthConfig,
): Promise<Jwk | undefined> {
  const response = await (config.fetcher ?? fetch)(config.jwksUrl);
  if (!response.ok) return undefined;

  const jwks = await response.json() as Jwks;
  return jwks.keys.find((key) => key.kid === kid && key.kty === "RSA");
}

function renderDashboard(): string {
  const siteRows = SITES.map((site) => {
    const adminButton = "adminUrl" in site
      ? `<a class="admin-link" href="${site.adminUrl}" target="_blank" rel="noopener noreferrer">Admin Panel</a>`
      : `<span class="admin-link disabled" aria-disabled="true">Admin Panel</span>`;

    return `<article class="site" data-site="${site.domain}">
      <div>
        <h2>${site.domain}</h2>
        <a href="https://${site.domain}/" target="_blank" rel="noopener noreferrer">https://${site.domain}/</a>
      </div>
      <div class="metrics">
        <span class="badge pending">Checking</span>
        <strong class="latency">-- ms</strong>
      </div>
      <dl>
        <div><dt>Status</dt><dd class="status">--</dd></div>
        <div><dt>Checked</dt><dd class="checked">--</dd></div>
      </dl>
      <div class="actions">${adminButton}</div>
    </article>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Site Status</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --surface: #ffffff;
      --text: #17202a;
      --muted: #64748b;
      --line: #d8dee9;
      --ok: #0f8a5f;
      --ok-bg: #dff6ea;
      --bad: #c6283e;
      --bad-bg: #ffe1e6;
      --warn: #9a5a00;
      --warn-bg: #fff0c7;
      --accent: #2563eb;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font: 16px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    main {
      width: min(1040px, calc(100% - 32px));
      margin: 0 auto;
      padding: 40px 0;
    }

    header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 24px;
    }

    h1 {
      margin: 0;
      font-size: clamp(2rem, 5vw, 4.25rem);
      line-height: 1;
      letter-spacing: 0;
    }

    .summary {
      margin: 10px 0 0;
      color: var(--muted);
    }

    button {
      min-height: 42px;
      border: 1px solid #1d4ed8;
      border-radius: 8px;
      background: var(--accent);
      color: #fff;
      font: inherit;
      font-weight: 700;
      padding: 0 16px;
      cursor: pointer;
      white-space: nowrap;
    }

    button:disabled {
      cursor: wait;
      opacity: 0.72;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
    }

    .site {
      min-height: 255px;
      display: grid;
      grid-template-rows: auto auto 1fr auto;
      gap: 22px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      padding: 20px;
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.07);
    }

    h2 {
      margin: 0 0 6px;
      font-size: 1.25rem;
      overflow-wrap: anywhere;
      letter-spacing: 0;
    }

    a {
      color: var(--muted);
      font-size: 0.92rem;
      text-decoration-color: transparent;
      overflow-wrap: anywhere;
    }

    a:hover { color: var(--accent); text-decoration-color: currentColor; }

    .metrics {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 32px;
      border-radius: 999px;
      padding: 0 12px;
      font-weight: 800;
      font-size: 0.85rem;
    }

    .badge.up { background: var(--ok-bg); color: var(--ok); }
    .badge.down { background: var(--bad-bg); color: var(--bad); }
    .badge.pending { background: var(--warn-bg); color: var(--warn); }

    .latency {
      font-size: 2.1rem;
      line-height: 1;
      letter-spacing: 0;
      white-space: nowrap;
    }

    dl {
      display: grid;
      gap: 10px;
      align-self: end;
      margin: 0;
    }

    dl div {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      border-top: 1px solid var(--line);
      padding-top: 10px;
    }

    dt {
      color: var(--muted);
      font-size: 0.85rem;
      font-weight: 700;
      text-transform: uppercase;
    }

    dd {
      margin: 0;
      text-align: right;
      overflow-wrap: anywhere;
    }

    .actions {
      display: flex;
      align-items: center;
    }

    .admin-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: 40px;
      border: 1px solid #1d4ed8;
      border-radius: 8px;
      background: var(--accent);
      color: #fff;
      font-size: 0.95rem;
      font-weight: 800;
      text-decoration: none;
      white-space: nowrap;
    }

    .admin-link:hover {
      color: #fff;
      text-decoration: none;
      background: #1d4ed8;
    }

    .admin-link.disabled {
      border-color: #cbd5e1;
      background: #e2e8f0;
      color: #64748b;
      cursor: not-allowed;
    }

    @media (max-width: 820px) {
      main { padding: 28px 0; }
      header { align-items: stretch; flex-direction: column; }
      button { width: 100%; }
      .grid { grid-template-columns: 1fr; }
      .site { min-height: 220px; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Site Status</h1>
        <p class="summary" id="summary">Checking three sites from this Cloudflare Worker.</p>
      </div>
      <button id="refresh" type="button">Refresh</button>
    </header>

    <section class="grid" aria-label="Monitored sites">
      ${siteRows}
    </section>
  </main>

  <script>
    const button = document.querySelector("#refresh");
    const summary = document.querySelector("#summary");

    function setPending() {
      document.querySelectorAll(".site").forEach((site) => {
        site.querySelector(".badge").className = "badge pending";
        site.querySelector(".badge").textContent = "Checking";
      });
    }

    function formatChecked(value) {
      return new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit"
      }).format(new Date(value));
    }

    async function refresh() {
      button.disabled = true;
      setPending();

      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        if (!response.ok) throw new Error("Status endpoint returned " + response.status);

        const payload = await response.json();
        let upCount = 0;

        for (const result of payload.sites) {
          const site = document.querySelector('[data-site="' + result.site + '"]');
          if (!site) continue;

          const badge = site.querySelector(".badge");
          badge.className = "badge " + (result.ok ? "up" : "down");
          badge.textContent = result.ok ? "Up" : "Down";
          site.querySelector(".latency").textContent = result.latencyMs === null ? "-- ms" : result.latencyMs + " ms";
          site.querySelector(".status").textContent = result.status === null
            ? (result.error || "Request failed")
            : result.status + " " + result.statusText;
          site.querySelector(".checked").textContent = formatChecked(result.checkedAt);
          if (result.ok) upCount++;
        }

        summary.textContent = upCount + " of " + payload.sites.length + " sites are up. Last checked " + formatChecked(payload.checkedAt) + ".";
      } catch (error) {
        summary.textContent = error instanceof Error ? error.message : "Unable to refresh site status.";
        document.querySelectorAll(".site").forEach((site) => {
          site.querySelector(".badge").className = "badge down";
          site.querySelector(".badge").textContent = "Error";
        });
      } finally {
        button.disabled = false;
      }
    }

    button.addEventListener("click", refresh);
    refresh();
  </script>
</body>
</html>`;
}

export default {
  fetch: (request: Request, env: Env) => {
    const config = getAccessAuthConfig(env);
    if (!config) {
      return new Response("Access auth is not configured\n", {
        status: 500,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    return handleAuthenticatedRequest(request, config);
  },
};

if (import.meta.main) {
  Deno.serve(handleRequest);
}
