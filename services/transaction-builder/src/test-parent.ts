import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export async function registeredTestParent(
  sql: Sql,
): Promise<{ mint: string; tokenProgram: string } | null> {
  try {
    const rows = await sql<{ mint: string; tokenProgram: string }[]>`
      select mint_address as mint, token_program as "tokenProgram"
      from parent_registrations
      where scope = 'test' and symbol = 'TREST' and eligible = true
      limit 1
    `;
    return rows[0] ?? null;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "42P01" || code === "42703") return null;
    throw error;
  }
}
