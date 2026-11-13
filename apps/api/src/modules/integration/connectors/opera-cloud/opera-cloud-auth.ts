import { config } from "../../../../config.js";

type TokenCache = {
  accessToken: string;
  expiresAt: number;
};

let tokenCache: TokenCache | null = null;

export type OperaCloudCredentials = {
  clientId: string;
  clientSecret: string;
  enterpriseId: string;
  hostname: string;
};

export function getOperaCloudCredentials(): OperaCloudCredentials {
  const cfg = config();
  const clientId = cfg.OHIP_CLIENT_ID ?? "";
  const clientSecret = cfg.OHIP_CLIENT_SECRET ?? "";
  const enterpriseId = cfg.OHIP_ENTERPRISE_ID ?? "";
  const hostname = cfg.OHIP_HOSTNAME;

  return { clientId, clientSecret, enterpriseId, hostname };
}

export async function getOperaCloudToken(creds: OperaCloudCredentials): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.accessToken;
  }

  const tokenUrl = `${creds.hostname}/oauth/v1/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: creds.clientId,
    client_secret: creds.clientSecret
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OHIP auth failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000
  };

  return tokenCache.accessToken;
}

export function clearTokenCache() {
  tokenCache = null;
}
