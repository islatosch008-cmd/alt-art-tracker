// Reddit OAuth helper.
//
// Uses the script-app "client_credentials" flow: app credentials only, no
// user account needed. Read-only access. Token valid ~1 hour, cached in
// memory across Edge Function invocations within the same process.
//
// Without REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET the helper goes into
// dev mode: no network calls, returns synthetic mention counts so the UI
// flow can be exercised before Ian has Reddit Developer creds.

const CLIENT_ID = Deno.env.get('REDDIT_CLIENT_ID');
const CLIENT_SECRET = Deno.env.get('REDDIT_CLIENT_SECRET');
const USER_AGENT = 'alt-art-tracker/0.1 (Phase 1 beta)';

export const isLive = Boolean(CLIENT_ID && CLIENT_SECRET);

let cached: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const auth = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Reddit token ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cached.token;
}

// Count mentions of `query` in `subreddit` within the last 24h.
// Search returns up to 25 posts per page; we just need the count, so cap
// the query and use the listing meta where possible.
export async function countMentions(
  query: string,
  subreddit: string,
): Promise<number> {
  if (!isLive) {
    // Dev mode: small random count so UI flow has signal.
    return Math.floor(Math.random() * 4);
  }

  const token = await getToken();
  // restrict_sr=1 limits to the subreddit; t=day = last 24h; sort=new gets
  // listings ordered chronologically. limit=25 is the cheapest meaningful query.
  const params = new URLSearchParams({
    q: query,
    restrict_sr: '1',
    t: 'day',
    sort: 'new',
    limit: '25',
  });
  const url = `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/search?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT },
  });
  if (!res.ok) {
    console.warn(`Reddit search ${res.status} for ${subreddit}/${query}`);
    return 0;
  }
  const json = (await res.json()) as { data?: { children?: unknown[] } };
  return json.data?.children?.length ?? 0;
}
