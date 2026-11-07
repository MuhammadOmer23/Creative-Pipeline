import { randomBytes, randomUUID } from "crypto";
import type { Role } from "../domain/constants";
import { getPool } from "./db";
import { hashToken, verifyPassword } from "./passwords";
import type { Actor } from "./service";

export async function authenticate(email: string, password: string): Promise<Actor | null> {
  const result = await getPool().query(`SELECT id, name, password_hash, is_fixture FROM accounts WHERE lower(email)=lower($1)`, [email.trim()]);
  const row = result.rows[0];
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  const roles = await getPool().query(`SELECT role FROM account_roles WHERE account_id=$1`, [row.id]);
  return { id: row.id, name: row.name, roles: roles.rows.map((item) => item.role as Role), fixture: row.is_fixture };
}

export async function createSession(accountId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await getPool().query(
    `INSERT INTO sessions (id, account_id, token_hash, expires_at) VALUES ($1,$2,$3,$4)`,
    [randomUUID(), accountId, hashToken(token), expires],
  );
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await getPool().query(`DELETE FROM sessions WHERE token_hash=$1`, [hashToken(token)]);
}

export async function actorFromToken(token: string): Promise<Actor | null> {
  const result = await getPool().query(
    `SELECT a.id, a.name, a.is_fixture, array_remove(array_agg(r.role), NULL) AS roles
     FROM sessions s
     JOIN accounts a ON a.id = s.account_id
     LEFT JOIN account_roles r ON r.account_id = a.id
     WHERE s.token_hash=$1 AND s.expires_at > now()
     GROUP BY a.id`,
    [hashToken(token)],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, name: row.name, roles: (row.roles ?? []) as Role[], fixture: row.is_fixture };
}
