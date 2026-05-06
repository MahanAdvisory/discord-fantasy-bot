export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  const payload = {
    ok: !error && Boolean(code),
    code,
    state,
    error,
    error_description: errorDescription,
    hint:
      code
        ? "Copy `code` and use it as YAHOO_AUTH_CODE with `npm run yahoo:exchange`."
        : "No code found in callback query string.",
  };

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
