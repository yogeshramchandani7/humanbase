// Load env from .env.local then .env (Node built-in; import this first).
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    /* file absent — fine */
  }
}
