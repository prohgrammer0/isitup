# isitup

A small Cloudflare Worker dashboard for checking site status.

## Sites

Edit `SITES` in `main.ts` to change the monitored sites. Add `adminUrl` when a
site should show an enabled WordPress admin button:

```ts
const SITES = [
  { domain: "example.com", adminUrl: "https://example.com/wp-admin/" },
  { domain: "static-site.example" },
] as const satisfies readonly SiteConfig[];
```

When `adminUrl` is not provided, the dashboard still shows the Admin Panel
button, but it is greyed out and not clickable.

## Local Development

Run the tests:

```sh
deno test
```

Run the dashboard locally:

```sh
deno task dev
```

Local development serves the dashboard without Cloudflare Access so the UI can
be tested without a real Access JWT.

## Cloudflare Access Setup

This Worker expects Cloudflare Access to protect the deployed route and
validates the Access JWT inside the Worker. Add these Worker variables in the
Cloudflare dashboard:

| Variable          | Value                                                              |
| ----------------- | ------------------------------------------------------------------ |
| `ACCESS_AUD`      | `cbd0eb163411996cc08960b16d863ec1c4aec6eff6ea013252b1539dbb7578af` |
| `ACCESS_JWKS_URL` | `https://rustyrohbot.cloudflareaccess.com/cdn-cgi/access/certs`    |
| `ACCESS_ISSUER`   | `https://rustyrohbot.cloudflareaccess.com`                         |

Dashboard path:

1. Open Cloudflare dashboard.
2. Go to **Workers & Pages**.
3. Select the `isitup` Worker.
4. Go to **Settings**.
5. Add the variables above under **Variables and Secrets**.
6. Deploy the Worker again.

If any of these variables are missing in production, the Worker returns
`500 Access auth is not configured` instead of serving the dashboard without JWT
validation.

## Deploy

```sh
deno task deploy
```
