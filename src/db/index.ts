export type DatabaseRuntime = {
  provider: 'sqlite';
  url: string;
};

export function createLocalDatabaseRuntime(url = 'local.sqlite'): DatabaseRuntime {
  return {
    provider: 'sqlite',
    url,
  };
}

export * from './schema.ts';
export * from './sqliteService.ts';
