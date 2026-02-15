import { createClient, RedisClientType } from 'redis';

declare global {
  // eslint-disable-next-line no-var
  var __redisClient: RedisClientType | undefined;
}

let connectPromise: Promise<RedisClientType | null> | null = null;

const redisUrl = () => (process.env.REDIS_URL || '').trim();

export const getRedisKeyPrefix = (): string => {
  const raw = (process.env.REDIS_KEY_PREFIX || 'ros').trim();
  return raw || 'ros';
};

export const getRedisClient = async (): Promise<RedisClientType | null> => {
  const url = redisUrl();
  if (!url) {
    return null;
  }

  if (global.__redisClient?.isOpen) {
    return global.__redisClient;
  }

  if (connectPromise) {
    return connectPromise;
  }

  connectPromise = (async () => {
    try {
      const client = global.__redisClient || createClient({ url });
      global.__redisClient = client;

      client.on('error', (error) => {
        console.error('[redis] client error', error);
      });

      if (!client.isOpen) {
        await client.connect();
      }

      return client;
    } catch (error) {
      console.error('[redis] connect failed', error);
      return null;
    } finally {
      connectPromise = null;
    }
  })();

  return connectPromise;
};

export const withRedis = async <T>(
  label: string,
  action: (client: RedisClientType) => Promise<T>,
  fallback: T,
): Promise<T> => {
  const client = await getRedisClient();
  if (!client) {
    return fallback;
  }

  try {
    return await action(client);
  } catch (error) {
    console.error(`[redis:${label}] failed`, error);
    return fallback;
  }
};

export const isRedisEnabled = (): boolean => {
  return Boolean(redisUrl());
};
