import pg from "pg";

const { DATABASE_URL, PGSSL } = process.env;

if (!DATABASE_URL) {
  console.error(
    "DATABASE_URL не задан. На Railway добавь Postgres и в переменных сервиса укажи DATABASE_URL = ${{Postgres.DATABASE_URL}}"
  );
  process.exit(1);
}

// Внутренний адрес Railway (postgres.railway.internal) работает без SSL.
// Для публичного адреса поставь PGSSL=true.
export const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: PGSSL === "true" ? { rejectUnauthorized: false } : false,
  max: 5,
});

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS progress (
      user_id    INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data       JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`DELETE FROM sessions WHERE expires_at < now()`);
}
