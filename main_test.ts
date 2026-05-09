import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  checkSite,
  getAccessAuthConfig,
  getSites,
  handleAuthenticatedRequest,
  handleRequest,
} from "./main.ts";
import worker from "./main.ts";

Deno.test("getSites returns the monitored domains", () => {
  assertEquals(getSites(), [
    "prohgrammer.com",
    "mildprogramming.com",
    "datadrivendevelopment.org",
  ]);
});

Deno.test("checkSite reports successful responses with latency", async () => {
  let now = 100;
  const fetcher = ((url: string | URL | Request) => {
    assertEquals(String(url), "https://prohgrammer.com/");
    now = 142;
    return Promise.resolve(
      new Response("ok", {
        status: 200,
        statusText: "OK",
      }),
    );
  }) as typeof fetch;

  const result = await checkSite("prohgrammer.com", fetcher, () => now);

  assertEquals(result.ok, true);
  assertEquals(result.status, 200);
  assertEquals(result.statusText, "OK");
  assertEquals(result.latencyMs, 42);
});

Deno.test("checkSite reports failed requests", async () => {
  const fetcher = (() => {
    throw new Error("connection refused");
  }) as typeof fetch;

  const result = await checkSite("mildprogramming.com", fetcher);

  assertEquals(result.ok, false);
  assertEquals(result.status, null);
  assertEquals(result.latencyMs, null);
  assertEquals(result.error, "connection refused");
});

Deno.test("handleRequest serves the dashboard", async () => {
  const response = await handleRequest(new Request("https://example.test/"));
  const html = await response.text();

  assertEquals(response.status, 200);
  assertStringIncludes(response.headers.get("content-type") ?? "", "text/html");
  assertStringIncludes(html, "Site Status");
  assertStringIncludes(html, "datadrivendevelopment.org");
  assertStringIncludes(html, "Admin Panel");
  assertStringIncludes(html, 'class="admin-link disabled"');
});

Deno.test("handleRequest serves health checks", async () => {
  const response = await handleRequest(
    new Request("https://example.test/health"),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ok\n");
});

Deno.test("handleAuthenticatedRequest rejects missing Access JWTs", async () => {
  const response = await handleAuthenticatedRequest(
    new Request("https://example.test/"),
    {
      aud: "test-aud",
      jwksUrl: "https://example.test/certs",
      issuer: "https://example.cloudflareaccess.com",
    },
  );

  assertEquals(response.status, 401);
  assertEquals(await response.text(), "Unauthorized\n");
});

Deno.test("getAccessAuthConfig returns null when env vars are missing", () => {
  assertEquals(getAccessAuthConfig({}), null);
});

Deno.test("getAccessAuthConfig reads Cloudflare Access env vars", () => {
  assertEquals(
    getAccessAuthConfig({
      ACCESS_AUD: "aud",
      ACCESS_JWKS_URL: "https://team.cloudflareaccess.com/cdn-cgi/access/certs",
      ACCESS_ISSUER: "https://team.cloudflareaccess.com",
    }),
    {
      aud: "aud",
      jwksUrl: "https://team.cloudflareaccess.com/cdn-cgi/access/certs",
      issuer: "https://team.cloudflareaccess.com",
    },
  );
});

Deno.test("deployed worker fails closed without Access env vars", async () => {
  const response = await worker.fetch(new Request("https://example.test/"), {});

  assertEquals(response.status, 500);
  assertEquals(await response.text(), "Access auth is not configured\n");
});
