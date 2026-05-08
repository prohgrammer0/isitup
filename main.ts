const SITES = [
  "prohgrammer.com",
  "mildprogramming.com",
  "datadrivendevelopment.org"
] as const;

const CHECK_TIMEOUT_MS = 8000;

export type SiteName = typeof SITES[number];

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

export function getSites(): readonly SiteName[] {
  return SITES;
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
  return Promise.all(SITES.map((site) => checkSite(site, fetcher)));
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

function renderDashboard(): string {
  const siteRows = SITES.map((site) =>
    `<article class="site" data-site="${site}">
      <div>
        <h2>${site}</h2>
        <a href="https://${site}/" target="_blank" rel="noreferrer">https://${site}/</a>
      </div>
      <div class="metrics">
        <span class="badge pending">Checking</span>
        <strong class="latency">-- ms</strong>
      </div>
      <dl>
        <div><dt>Status</dt><dd class="status">--</dd></div>
        <div><dt>Checked</dt><dd class="checked">--</dd></div>
      </dl>
    </article>`
  ).join("");

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
      grid-template-rows: auto auto 1fr;
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
  fetch: handleRequest,
};

if (import.meta.main) {
  Deno.serve(handleRequest);
}
