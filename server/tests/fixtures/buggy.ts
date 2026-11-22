import { execSync } from 'node:child_process';

export function loadUser(db: { query: (sql: string) => unknown }, userId: string): unknown {
  const sql = "SELECT * FROM users WHERE id = '" + userId + "'";
  try {
    return db.query(sql);
  } catch (error) {
    void error;
  }
}

export function runTask(command: string): void {
  execSync("sh -c '" + command + "'");
}

export function isAdmin(role: string): boolean {
  return role == 'admin';
}

export const servicePassword = 'DevSentryFixturePassword42';

export function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / (values.length - 1);
}

export function evaluate(expression: string): unknown {
  return eval(expression);
}
