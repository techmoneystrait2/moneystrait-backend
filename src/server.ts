import { createApp } from './app';
import { connectDb } from './config/db';
import { env } from './config/env';

async function main(): Promise<void> {
  await connectDb();
  createApp().listen(env.PORT, () => {
    console.log(`Backend listening on port ${env.PORT}`);
  });
}

main().catch((err: Error) => {
  console.error(`Startup failed: ${err.name}`);
  process.exit(1);
});
