import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 3000, strictPort: true } });
await server.listen();
server.printUrls();
