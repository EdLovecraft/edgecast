# EdgeCast

EdgeCast is a browser-based screen sharing app designed to run on Cloudflare Workers. A presenter creates a room and shares their screen, system audio, and microphone directly from the browser. Viewers open the room link to watch without installing extra software.

中文文档: [README.md](README.md)

## Features

- Start screen sharing from the browser.
- Capture screen audio and microphone input.
- Toggle the microphone while sharing.
- Copy the room name and room link with one click.
- Use Cloudflare Workers + Durable Objects for room management and WebSocket signaling.

## Requirements

- Node.js and npm.
- A Cloudflare account.
- Wrangler is included as a development dependency. After running `npm install`, use it through `npx wrangler`.

Main npm packages:

- `lucide`: interface icons.
- `vite`: frontend build tooling.
- `typescript`: type checking and compilation.
- `wrangler`: Cloudflare Workers build and deployment tooling.
- `@cloudflare/workers-types`: Cloudflare Workers type definitions.

## Deployment

Install dependencies:

```bash
npm install
```

Log in to Cloudflare:

```bash
npx wrangler login
```

Deploy to Cloudflare Workers:

```bash
npm run deploy
```

## License

This project is released under the MIT License. See [LICENSE](LICENSE) for the full license text and [NOTICE](NOTICE) for copyright and notice information.
