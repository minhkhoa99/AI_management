import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IN_MEMORY_DATABASE_LOCATION, openSqliteDatabase } from './sqlite-connection';
import { SqliteTransactionRunner } from './transaction-runner';

describe('SqliteTransactionRunner', () => {
  let database: DatabaseSync;
  let transactionRunner: SqliteTransactionRunner;
  const insertNote = (body: string) =>
    database.prepare('INSERT INTO notes (body) VALUES (?)').run(body);
  const listNotes = () =>
    (
      database.prepare('SELECT body FROM notes ORDER BY rowid').all() as Array<{ body: string }>
    ).map((row) => row.body);

  beforeEach(() => {
    database = openSqliteDatabase(IN_MEMORY_DATABASE_LOCATION);
    database.exec('CREATE TABLE notes (body TEXT NOT NULL)');
    transactionRunner = new SqliteTransactionRunner(database);
  });

  afterEach(() => {
    database.close();
  });

  it('commits the work and returns its result', () => {
    const result = transactionRunner.runInTransaction(() => {
      insertNote('first');
      return 42;
    });

    expect(result).toBe(42);
    expect(listNotes()).toEqual(['first']);
  });

  it('rolls everything back and rethrows the original error', () => {
    const failure = new Error('boom');

    expect(() =>
      transactionRunner.runInTransaction(() => {
        insertNote('lost');
        throw failure;
      }),
    ).toThrow(failure);
    expect(listNotes()).toEqual([]);
  });

  it('supports nesting: an inner failure caught by the outer unit only undoes the inner work', () => {
    transactionRunner.runInTransaction(() => {
      insertNote('outer');
      expect(() =>
        transactionRunner.runInTransaction(() => {
          insertNote('inner');
          throw new Error('inner failed');
        }),
      ).toThrow('inner failed');
    });

    expect(listNotes()).toEqual(['outer']);
  });

  it('leaves no open transaction behind', () => {
    expect(() => transactionRunner.runInTransaction(() => insertNote('one'))).not.toThrow();
    expect(database.isTransaction).toBe(false);
  });
});
