import { startServer } from '../src/server.mjs';
import { createDesktopCodec, createDynamicResearchBridge, createUpdateBridge } from './storage.mjs';

const service = await startServer({ port: 0, dataDir: process.env.AIPM_DATA_DIR, storageCodec: createDesktopCodec(), dynamicPage:createDynamicResearchBridge(), updateBridge:createUpdateBridge() });
process.send?.({ type: 'ready', url: service.url, updates:service.updateSettings() });
let closing;
async function shutdown() {
  closing ??= service.close().then(() => process.exit(0));
  await closing;
}
process.on('message', message => { if (message?.type === 'shutdown') void shutdown(); });
process.once('disconnect', () => { void shutdown(); });
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void shutdown(); });
