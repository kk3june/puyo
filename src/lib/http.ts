import 'server-only';
export function sameOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  const expected = configured ? new URL(configured).origin : new URL(request.url).origin;
  return request.headers.get('origin') === expected;
}
export function siteOrigin(request: Request) {
  return new URL(process.env.NEXT_PUBLIC_SITE_URL || request.url).origin;
}
