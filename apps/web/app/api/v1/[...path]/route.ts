import { proxyToApi } from "../../../../lib/server/api-proxy";

// Every request goes to the API as it arrives: never cached, never prerendered.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = proxyToApi;
export const POST = proxyToApi;
export const PUT = proxyToApi;
export const PATCH = proxyToApi;
export const DELETE = proxyToApi;
