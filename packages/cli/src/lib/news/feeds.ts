import {
  makePublication,
  type PublicationRead,
  type SocialWatchlist,
} from './publications';

type Fetch = typeof fetch;
type Result = PublicationRead | null;
type Secrets = {
  xToken?: string;
  redditToken?: string;
  redditUserAgent?: string;
};

async function request(
  fetcher: Fetch,
  url: string,
  headers?: Record<string, string>,
) {
  const response = await fetcher(url, {
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

function pressField(item: string, key: string) {
  const value =
    new RegExp(`<${key}>([\\s\\S]*?)</${key}>`, 'i').exec(item)?.[1] ?? '';
  return value
    .replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '')
    .trim()
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

type RedditChild = {
  kind: string;
  data?: {
    id: string;
    author: string;
    author_fullname?: string;
    subreddit: string;
    permalink?: string;
    link_id?: string;
    created_utc: number;
    title?: string;
    body?: string;
    selftext?: string;
    over_18?: boolean;
  };
};

function redditPublication(
  child: RedditChild,
  handle: string,
  named: boolean,
  observed: number,
) {
  const p = child.data;
  if (
    !p ||
    !p.author ||
    p.author === '[deleted]' ||
    p.over_18 ||
    (named
      ? p.author.toLowerCase() !== handle.toLowerCase()
      : p.subreddit?.toLowerCase() !== handle.toLowerCase()) ||
    !/^[a-z0-9]+$/i.test(p.id)
  )
    return null;
  const comment = child.kind === 't1' && named;
  if (child.kind !== 't3' && !comment) return null;
  const fallback =
    comment && /^t3_[a-z0-9]+$/i.test(p.link_id ?? '')
      ? `/comments/${p.link_id!.slice(3)}/_/${p.id}/`
      : null;
  const path = p.permalink?.startsWith('/r/') ? p.permalink : fallback;
  const text = comment
    ? p.body
    : p.selftext
      ? `${p.selftext}\n${p.title ?? ''}`
      : p.title;
  if (!path || !text || text === '[removed]' || text === '[deleted]')
    return null;
  return makePublication(
    {
      provider: 'reddit',
      id: `${child.kind}_${p.id}`,
      url: 'https://www.reddit.com' + path,
      time: p.created_utc * 1000,
      text,
      author: p.author,
      authorId: p.author_fullname,
      community: p.subreddit,
      authority: named ? 'watchlist' : 'community',
      type: named ? 'social.opinion' : 'social.discussion',
    },
    observed,
  );
}

export async function collectPublications(
  watch: SocialWatchlist,
  secrets: Secrets,
  fetcher: Fetch = fetch,
  clock: () => number = Date.now,
) {
  const sources: Array<{
    source: string;
    read?: () => Promise<Result[]>;
    unavailable?: string;
  }> = [];
  const pressFeeds = [
    [
      'fed-press',
      'Federal Reserve Board',
      'https://www.federalreserve.gov/feeds/press_all.xml',
      'www.federalreserve.gov',
    ],
    [
      'ecb',
      'European Central Bank',
      'https://www.ecb.europa.eu/rss/press.html',
      'www.ecb.europa.eu',
    ],
    [
      'boe',
      'Bank of England',
      'https://www.bankofengland.co.uk/rss/news',
      'www.bankofengland.co.uk',
    ],
    [
      'bea',
      'Bureau of Economic Analysis',
      'https://apps.bea.gov/rss/rss.xml',
      'www.bea.gov',
    ],
  ] as const;
  for (const [provider, author, endpoint, domain] of pressFeeds) {
    sources.push({
      source: provider,
      async read() {
        const xml = await (await request(fetcher, endpoint)).text();
        if (!/<rss\b/.test(xml)) throw new Error('Invalid official RSS');
        const observed = clock();
        return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
          .slice(0, 20)
          .map(([, item]) => {
            const url = pressField(item, 'link');
            if (!url.startsWith(`https://${domain}/`)) return null;
            return makePublication(
              {
                provider,
                id: url,
                url,
                time: Date.parse(pressField(item, 'pubDate')),
                text: pressField(item, 'title'),
                category: pressField(item, 'category'),
                author,
                authority: 'official',
                type: 'official.statement',
              },
              observed,
            );
          });
      },
    });
  }
  sources.push({
    source: 'bybit',
    async read() {
      const data = await (
        await request(
          fetcher,
          'https://api.bybit.kz/v5/announcements/index?locale=en-US&limit=20',
        )
      ).json();
      if (data.retCode !== 0 || !Array.isArray(data.result?.list))
        throw new Error('Invalid Bybit response');
      const observed = clock();
      return data.result.list.flatMap(
        (item: {
          url: string;
          title: string;
          publishTime: number;
          type?: { key?: string };
        }) => {
          if (
            !item.url?.startsWith('https://announcements.bybit.com/') ||
            !item.title ||
            item.type?.key === 'latest_activities'
          )
            return [];
          return [
            makePublication(
              {
                provider: 'bybit',
                id: item.url,
                url: item.url,
                time: item.publishTime,
                text: item.title,
                author: 'Bybit',
                authority: 'official',
                type: 'venue.announcement',
                category: item.type?.key,
              },
              observed,
            ),
          ];
        },
      );
    },
  });
  for (const author of watch.x) {
    const source = `x:${author}`;
    if (!secrets.xToken) {
      sources.push({ source, unavailable: 'NEWS_X_BEARER_TOKEN missing' });
      continue;
    }
    sources.push({
      source,
      async read() {
        const headers = { Authorization: `Bearer ${secrets.xToken}` };
        const profile = await (
          await request(
            fetcher,
            `https://api.x.com/2/users/by/username/${author}`,
            headers,
          )
        ).json();
        const id = profile.data?.id;
        if (
          typeof id !== 'string' ||
          !/^\d+$/.test(id) ||
          profile.data?.username?.toLowerCase() !== author.toLowerCase()
        )
          throw new Error('X author unavailable');
        const posts = await (
          await request(
            fetcher,
            `https://api.x.com/2/users/${id}/tweets?max_results=10&exclude=retweets,replies&tweet.fields=created_at,author_id`,
            headers,
          )
        ).json();
        if (!Array.isArray(posts.data) && posts.meta?.result_count !== 0)
          throw new Error('Invalid X timeline');
        const observed = clock();
        return (posts.data ?? []).map(
          (post: {
            id: string;
            author_id: string;
            text: string;
            created_at: string;
          }) =>
            post.author_id === id &&
            /^\d+$/.test(post.id) &&
            typeof post.text === 'string'
              ? makePublication(
                  {
                    provider: 'x',
                    id: post.id,
                    url: `https://x.com/${author}/status/${post.id}`,
                    time: Date.parse(post.created_at),
                    text: post.text,
                    author,
                    authorId: id,
                    authority: 'watchlist',
                    type: 'social.opinion',
                  },
                  observed,
                )
              : null,
        );
      },
    });
  }
  const redditFeeds = [
    ...watch.redditUsers.flatMap((handle) => [
      { handle, kind: 'user', endpoint: 'submitted' },
      { handle, kind: 'user', endpoint: 'comments' },
    ]),
    ...watch.redditCommunities.map((handle) => ({
      handle,
      kind: 'r',
      endpoint: 'new',
    })),
  ];
  for (const { handle, kind, endpoint } of redditFeeds) {
    const source = `reddit:${kind}/${handle}/${endpoint}`;
    if (!secrets.redditToken || !secrets.redditUserAgent) {
      sources.push({
        source,
        unavailable:
          'NEWS_REDDIT_ACCESS_TOKEN or NEWS_REDDIT_USER_AGENT missing',
      });
      continue;
    }
    sources.push({
      source,
      async read() {
        const result = await (
          await request(
            fetcher,
            `https://oauth.reddit.com/${kind}/${handle}/${endpoint}?limit=20&sort=new&raw_json=1`,
            {
              Authorization: `Bearer ${secrets.redditToken}`,
              'User-Agent': secrets.redditUserAgent!,
            },
          )
        ).json();
        if (!Array.isArray(result.data?.children))
          throw new Error('Invalid Reddit listing');
        const observed = clock();
        return result.data.children.map((child: RedditChild) =>
          redditPublication(child, handle, kind === 'user', observed),
        );
      },
    });
  }
  const publications = new Map<string, PublicationRead>();
  const status = [];
  // Keep request concurrency low across account lists and preserve author
  // attribution when the same Reddit post also appears in a community feed.
  for (const feed of sources) {
    if (!feed.read) {
      status.push({
        source: feed.source,
        status: 'unavailable',
        reason: feed.unavailable,
      });
      continue;
    }
    try {
      const rows = (await feed.read()).filter(
        (r): r is PublicationRead => r !== null,
      );
      for (const row of rows) {
        const key = `${row.event.provider}:${row.event.eventId}`;
        if (!publications.has(key)) publications.set(key, row);
      }
      status.push({
        source: feed.source,
        status: 'available',
        count: rows.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      status.push({
        source: feed.source,
        status: 'failed',
        reason: /^(HTTP \d+|Invalid |X author)/.test(message)
          ? message
          : 'request failed',
      });
    }
  }
  return { publications: [...publications.values()], status };
}
