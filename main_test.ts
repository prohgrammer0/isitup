import { assertEquals, assertStringIncludes } from "@std/assert";
import { checkSite, getSites, handleRequest } from "./main.ts";

Deno.test("getSites returns the monitored domains", () => {
  assertEquals(getSites(), [
    "prohgrammer.com",
    "mildprogramming.com",
    "datadrivendevelopment.com",
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
  assertStringIncludes(html, "datadrivendevelopment.com");
});

Deno.test("handleRequest serves health checks", async () => {
  const response = await handleRequest(
    new Request("https://example.test/health"),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ok\n");
});
