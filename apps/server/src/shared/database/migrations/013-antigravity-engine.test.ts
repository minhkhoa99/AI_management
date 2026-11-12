import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyPendingMigrations } from '../migration-runner';
import { IN_MEMORY_DATABASE_LOCATION, openSqliteDatabase } from '../sqlite-connection';
import { ALL_MIGRATIONS } from './index';

describe('migration 013 antigravity engine', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = openSqliteDatabase(IN_MEMORY_DATABASE_LOCATION);
    applyPendingMigrations(
      database,
      ALL_MIGRATIONS.filter((migration) => migration.version < 13),
    );
    database.exec(`
      INSERT INTO departments (id, name, color) VALUES ('dev', 'Dev', '#3B82F6');
      INSERT INTO provider_connections (id, name, format, base_url)
        VALUES ('conn', 'Local', 'openai', 'http://127.0.0.1:1234');
      INSERT INTO agents (id, name, role, provider, model, access_level, network_access, enabled)
        VALUES ('a-claude', 'Claude', 'dev', 'claude_code', 'opus', 'edit_workspace', 1, 1);
      INSERT INTO agents (id, name, role, provider, enabled)
        VALUES ('a-codex', 'Codex', 'qc', 'codex', 0);
      INSERT INTO agents (id, name, role, provider, connection_id, model)
        VALUES ('a-api', 'Api', 'writer', 'custom_api', 'conn', 'llama-3');
      INSERT INTO positions (id, department_id, title, agent_id) VALUES ('p1', 'dev', 'dev', 'a-claude');
      UPDATE local_engine_settings
         SET default_model = 'opus', block_dangerous_commands = 0, allow_network = 1
       WHERE engine = 'claude_code';
      UPDATE local_engine_settings SET default_model = 'gpt-5', allow_network = 1 WHERE engine = 'codex';
    `);
  });

  afterEach(() => {
    database.close();
  });

  function migrateToLatest(): void {
    applyPendingMigrations(database, ALL_MIGRATIONS);
  }

  it('keeps every agent and local engine setting unchanged', () => {
    const agentsBefore = database.prepare('SELECT * FROM agents ORDER BY id').all();
    const settingsBefore = database
      .prepare('SELECT * FROM local_engine_settings ORDER BY engine')
      .all();

    migrateToLatest();

    expect(database.prepare('SELECT * FROM agents ORDER BY id').all()).toEqual(agentsBefore);
    expect(
      database
        .prepare(
          "SELECT * FROM local_engine_settings WHERE engine <> 'antigravity' ORDER BY engine",
        )
        .all(),
    ).toEqual(settingsBefore);
  });

  it('adds an antigravity settings row with the safe defaults', () => {
    migrateToLatest();

    expect(
      database
        .prepare(
          'SELECT default_model, block_dangerous_commands, allow_network FROM local_engine_settings WHERE engine = ?',
        )
        .get('antigravity'),
    ).toEqual({ default_model: null, block_dangerous_commands: 1, allow_network: 0 });
  });

  it('accepts an agent on the antigravity provider', () => {
    migrateToLatest();

    database
      .prepare("INSERT INTO agents (id, name, role, provider) VALUES ('a-agy', 'Agy', 'dev', ?)")
      .run('antigravity');

    expect(database.prepare("SELECT provider FROM agents WHERE id = 'a-agy'").get()).toEqual({
      provider: 'antigravity',
    });
  });

  it('keeps foreign keys to agents resolving', () => {
    migrateToLatest();

    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(database.prepare("SELECT agent_id FROM positions WHERE id = 'p1'").get()).toEqual({
      agent_id: 'a-claude',
    });
  });
});
