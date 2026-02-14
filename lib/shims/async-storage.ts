const asyncStorage = {
  getItem: async (_key: string): Promise<string | null> => null,
  setItem: async (_key: string, _value: string): Promise<void> => undefined,
  removeItem: async (_key: string): Promise<void> => undefined,
  clear: async (): Promise<void> => undefined,
  getAllKeys: async (): Promise<string[]> => [],
  multiGet: async (_keys: string[]): Promise<Array<[string, string | null]>> => [],
  multiSet: async (_keyValuePairs: Array<[string, string]>): Promise<void> => undefined,
  multiRemove: async (_keys: string[]): Promise<void> => undefined,
};

export const {
  getItem,
  setItem,
  removeItem,
  clear,
  getAllKeys,
  multiGet,
  multiSet,
  multiRemove,
} = asyncStorage;

export default asyncStorage;
