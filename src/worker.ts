import { DurableObject } from "cloudflare:workers";

export interface Env {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace<Room>;
}

type ClientRole = "presenter" | "viewer";

interface ClientAttachment {
  id: string;
  role: ClientRole;
  roomId: string;
  joinedAt: number;
}

interface SignalEnvelope extends Record<string, unknown> {
  type: "signal";
  to: string;
  data: unknown;
}

const ROOM_ID_PATTERN = /^[a-z0-9-]{3,64}$/;
const PEER_ID_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/ws/")) {
      const roomId = decodeURIComponent(url.pathname.slice("/ws/".length)).toLowerCase();

      if (!ROOM_ID_PATTERN.test(roomId)) {
        return new Response("Invalid room id", { status: 400 });
      }

      const id = env.ROOMS.idFromName(roomId);
      return env.ROOMS.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};

export class Room extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const url = new URL(request.url);
    const roomId = decodeURIComponent(url.pathname.slice("/ws/".length)).toLowerCase();
    const role = url.searchParams.get("role") === "presenter" ? "presenter" : "viewer";
    const requestedPeerId = url.searchParams.get("peerId") ?? "";
    const peerId = PEER_ID_PATTERN.test(requestedPeerId) ? requestedPeerId : crypto.randomUUID();

    if (role === "presenter" && this.clients().some((client) => client.attachment.role === "presenter")) {
      return new Response("A presenter is already connected", { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const attachment: ClientAttachment = {
      id: peerId,
      role,
      roomId,
      joinedAt: Date.now()
    };

    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server);

    const clients = this.clients();
    const viewers = clients
      .filter((connectedClient) => connectedClient.attachment.role === "viewer" && connectedClient.attachment.id !== peerId)
      .map((connectedClient) => connectedClient.attachment.id);
    const presenter = clients.find(
      (connectedClient) => connectedClient.attachment.role === "presenter" && connectedClient.attachment.id !== peerId
    );
    const viewerCount = this.viewerCount();

    this.send(server, {
      type: "welcome",
      peerId,
      role,
      roomId,
      viewers,
      viewerCount,
      presenterPresent: role === "presenter" || Boolean(presenter)
    });

    if (role === "presenter") {
      this.broadcast(
        (connectedClient) => connectedClient.attachment.role === "viewer",
        { type: "presenter-available", peerId }
      );
    } else if (presenter) {
      this.send(presenter.socket, { type: "viewer-joined", peerId });
      this.send(server, { type: "presenter-available", peerId: presenter.attachment.id });
    }

    if (role === "viewer") {
      this.broadcastViewerCount();
    }

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const sender = this.attachment(socket);
    if (!sender || typeof message !== "string") {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      this.send(socket, { type: "error", message: "Invalid JSON payload" });
      return;
    }

    if (!isRecord(parsed) || typeof parsed.type !== "string") {
      this.send(socket, { type: "error", message: "Invalid message payload" });
      return;
    }

    if (parsed.type === "ping") {
      this.send(socket, { type: "pong", now: Date.now() });
      return;
    }

    if (isSignalEnvelope(parsed)) {
      const target = this.clients().find((client) => client.attachment.id === parsed.to);
      if (!target) {
        this.send(socket, { type: "peer-unavailable", peerId: parsed.to });
        return;
      }

      this.send(target.socket, {
        type: "signal",
        from: sender.id,
        data: parsed.data
      });
      return;
    }

    this.send(socket, { type: "error", message: `Unsupported message type: ${parsed.type}` });
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    const closedClient = this.attachment(socket);
    if (!closedClient) {
      return;
    }

    if (closedClient.role === "presenter") {
      const final = wasClean && code === 1000 && (reason === "presentation stopped" || reason === "leaving");
      this.broadcast(
        (client) => client.attachment.role === "viewer",
        { type: "presenter-left", peerId: closedClient.id, final }
      );
    } else {
      this.broadcast(
        (client) => client.attachment.role === "presenter",
        { type: "viewer-left", peerId: closedClient.id }
      );
      this.broadcastViewerCount(closedClient.id);
    }
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    const erroredClient = this.attachment(socket);
    if (!erroredClient) {
      return;
    }

    if (erroredClient.role === "presenter") {
      this.broadcast(
        (client) => client.attachment.role === "viewer",
        { type: "presenter-left", peerId: erroredClient.id, final: false }
      );
    } else {
      this.broadcast(
        (client) => client.attachment.role === "presenter",
        { type: "viewer-left", peerId: erroredClient.id }
      );
      this.broadcastViewerCount(erroredClient.id);
    }
  }

  private clients(): Array<{ socket: WebSocket; attachment: ClientAttachment }> {
    return this.ctx
      .getWebSockets()
      .map((socket) => {
        const attachment = this.attachment(socket);
        return attachment ? { socket, attachment } : null;
      })
      .filter((client): client is { socket: WebSocket; attachment: ClientAttachment } => client !== null);
  }

  private attachment(socket: WebSocket): ClientAttachment | null {
    const attachment = socket.deserializeAttachment();

    if (
      !attachment ||
      typeof attachment.id !== "string" ||
      (attachment.role !== "presenter" && attachment.role !== "viewer") ||
      typeof attachment.roomId !== "string" ||
      typeof attachment.joinedAt !== "number"
    ) {
      return null;
    }

    return attachment;
  }

  private broadcast(
    predicate: (client: { socket: WebSocket; attachment: ClientAttachment }) => boolean,
    payload: unknown
  ): void {
    for (const client of this.clients()) {
      if (predicate(client)) {
        this.send(client.socket, payload);
      }
    }
  }

  private broadcastViewerCount(excludingPeerId?: string): void {
    this.broadcast(
      () => true,
      {
        type: "viewer-count",
        count: this.viewerCount(excludingPeerId)
      }
    );
  }

  private viewerCount(excludingPeerId?: string): number {
    const viewerIds = new Set<string>();
    for (const client of this.clients()) {
      if (client.attachment.role === "viewer" && client.attachment.id !== excludingPeerId) {
        viewerIds.add(client.attachment.id);
      }
    }
    return viewerIds.size;
  }

  private send(socket: WebSocket, payload: unknown): void {
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      socket.close(1011, "Failed to send message");
    }
  }
}

function isSignalEnvelope(value: Record<string, unknown>): value is SignalEnvelope {
  return value.type === "signal" && typeof value.to === "string" && "data" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
