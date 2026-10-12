// Loads .env if there is one. Imported first by every file that reads process.env.

try {
  process.loadEnvFile();
} catch {
  // no .env file
}
