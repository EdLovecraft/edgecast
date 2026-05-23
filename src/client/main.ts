import "./styles.css";
import {
  Copy,
  Link,
  LogIn,
  Mic,
  MicOff,
  MonitorStop,
  MonitorUp,
  Play,
  Radio,
  Settings,
  Square,
  Users,
  Volume2,
  createIcons
} from "lucide";

type Role = "presenter" | "viewer";
type ConnectionStatus = "idle" | "connecting" | "connected" | "closed" | "error";
type Language = "zh-CN" | "en";

interface PeerState {
  id: string;
  pc: RTCPeerConnection;
  queuedCandidates: RTCIceCandidateInit[];
}

interface AppState {
  roomId: string | null;
  role: Role | null;
  language: Language;
  peerId: string;
  status: ConnectionStatus;
  errorText: string | null;
  clipboardText: string | null;
  roomInput: string;
  displayAudio: boolean;
  microphone: boolean;
  micEnabled: boolean;
  remoteVolume: number;
  remoteMuted: boolean;
  viewerCount: number;
  presenterPresent: boolean;
}

type ServerMessage =
  | {
      type: "welcome";
      peerId: string;
      role: Role;
      roomId: string;
      viewers: string[];
      viewerCount: number;
      presenterPresent: boolean;
    }
  | { type: "viewer-joined"; peerId: string }
  | { type: "viewer-left"; peerId: string }
  | { type: "viewer-count"; count: number }
  | { type: "presenter-available"; peerId: string }
  | { type: "presenter-left"; peerId: string; final?: boolean }
  | { type: "peer-unavailable"; peerId: string }
  | { type: "signal"; from: string; data: SignalPayload }
  | { type: "error"; message: string }
  | { type: "pong"; now: number };

type SignalPayload =
  | { type: "offer"; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; sdp: RTCSessionDescriptionInit }
  | { type: "candidate"; candidate: RTCIceCandidateInit }
  | { type: "renegotiate" };

const ROOM_PATTERN = /^[a-z0-9-]{3,64}$/;
const icons = {
  Copy,
  Link,
  LogIn,
  Mic,
  MicOff,
  MonitorStop,
  MonitorUp,
  Play,
  Radio,
  Settings,
  Square,
  Users,
  Volume2
};
const rtcConfig: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" }
  ],
  iceCandidatePoolSize: 4
};
const SIGNAL_HEARTBEAT_MS = 20000;
const SIGNAL_STALE_MS = 60000;
const SIGNAL_RECONNECT_BASE_MS = 800;
const SIGNAL_RECONNECT_MAX_MS = 8000;
const PRESENTER_LEFT_MESSAGES = new Set(["分享者已离开", "Presenter has left"]);
const translations = {
  "zh-CN": {
    homeAria: "EdgeCast 首页",
    switchLanguage: "切换语言",
    heroTitle: "浏览器屏幕共享",
    hostShare: "发起共享",
    startSharing: "开始共享",
    joinRoom: "加入房间",
    roomCode: "房间码",
    roomPlaceholder: "例如 edge-123",
    waitingToShare: "等待开始共享",
    copyViewerLink: "复制观看链接",
    toggleMicrophone: "切换麦克风",
    microphoneOn: "麦克风开",
    microphoneOff: "麦克风关",
    stopSharing: "停止共享",
    stop: "停止",
    room: "房间",
    copyRoomName: "复制房间名",
    shareReady: "分享已就绪",
    waitingForPresenter: "等待分享者",
    roomLink: "房间链接",
    captureSettings: "采集设置",
    screenAudio: "屏幕音频",
    microphone: "麦克风",
    invalidRoomPrompt: "请输入有效房间码",
    unableToStartSharing: "无法开始共享",
    unableToConnectRoom: "无法连接房间",
    micUnavailable: "麦克风未启用，屏幕共享已继续",
    secureContextRequired: "屏幕共享需要 HTTPS 或 localhost",
    mediaUnsupported: "当前浏览器不支持屏幕或麦克风采集",
    missingRoomCode: "缺少房间码",
    roomConnectionTimeout: "连接房间超时",
    presenterAlreadyOnline: "房间连接失败，可能已有分享者在线",
    websocketConnectionFailed: "无法建立 WebSocket 连接",
    invalidRoomMessage: "收到无效房间消息",
    localMediaNotReady: "本地媒体未就绪",
    linkCopied: "链接已复制",
    roomNameCopied: "房间名已复制",
    copyFailed: "复制失败",
    invalidRoomFormat: "房间码格式无效",
    presenterLeft: "分享者已离开"
  },
  en: {
    homeAria: "EdgeCast home",
    switchLanguage: "Switch language",
    heroTitle: "Browser screen sharing",
    hostShare: "Start a share",
    startSharing: "Start sharing",
    joinRoom: "Join room",
    roomCode: "Room code",
    roomPlaceholder: "e.g. edge-123",
    waitingToShare: "Waiting to share",
    copyViewerLink: "Copy viewer link",
    toggleMicrophone: "Toggle microphone",
    microphoneOn: "Mic on",
    microphoneOff: "Mic off",
    stopSharing: "Stop sharing",
    stop: "Stop",
    room: "Room",
    copyRoomName: "Copy room name",
    shareReady: "Share is ready",
    waitingForPresenter: "Waiting for presenter",
    roomLink: "Room link",
    captureSettings: "Capture settings",
    screenAudio: "Screen audio",
    microphone: "Microphone",
    invalidRoomPrompt: "Enter a valid room code",
    unableToStartSharing: "Unable to start sharing",
    unableToConnectRoom: "Unable to connect to the room",
    micUnavailable: "Microphone was not enabled. Screen sharing continued.",
    secureContextRequired: "Screen sharing requires HTTPS or localhost",
    mediaUnsupported: "This browser does not support screen or microphone capture",
    missingRoomCode: "Missing room code",
    roomConnectionTimeout: "Room connection timed out",
    presenterAlreadyOnline: "Room connection failed. A presenter may already be online.",
    websocketConnectionFailed: "Unable to establish a WebSocket connection",
    invalidRoomMessage: "Received an invalid room message",
    localMediaNotReady: "Local media is not ready",
    linkCopied: "Link copied",
    roomNameCopied: "Room name copied",
    copyFailed: "Copy failed",
    invalidRoomFormat: "Invalid room code format",
    presenterLeft: "Presenter has left"
  }
} as const satisfies Record<Language, Record<string, string>>;

type TranslationKey = keyof (typeof translations)["zh-CN"];

const app = requireElement<HTMLDivElement>("#app");

const route = readRoute();
const state: AppState = {
  roomId: route.roomId,
  role: route.presenter ? "presenter" : route.roomId ? "viewer" : null,
  language: readInitialLanguage(),
  peerId: createPeerId(),
  status: "idle",
  errorText: null,
  clipboardText: null,
  roomInput: route.roomId ?? "",
  displayAudio: true,
  microphone: true,
  micEnabled: true,
  remoteVolume: 1,
  remoteMuted: false,
  viewerCount: 0,
  presenterPresent: false
};

let ws: WebSocket | null = null;
let heartbeatTimer: number | null = null;
let reconnectTimer: number | null = null;
let lastPongAt = 0;
let reconnectAttempt = 0;
let closingSignalingIntentionally = false;
let localStream: MediaStream | null = null;
let displayStream: MediaStream | null = null;
let microphoneStream: MediaStream | null = null;
let remoteStream: MediaStream | null = null;
let autoStartedViewerRoom: string | null = null;
const peers = new Map<string, PeerState>();
const connectedViewers = new Set<string>();

document.documentElement.lang = state.language;

window.addEventListener("popstate", () => {
  const nextRoute = readRoute();
  if (nextRoute.roomId !== state.roomId || nextRoute.presenter !== (state.role === "presenter")) {
    autoStartedViewerRoom = null;
  }
  state.roomId = nextRoute.roomId;
  state.role = nextRoute.presenter ? "presenter" : nextRoute.roomId ? "viewer" : null;
  state.roomInput = nextRoute.roomId ?? "";
  state.errorText = null;
  render();
});

render();

function render(): void {
  releaseRenderedMediaElements();

  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <a class="brand" href="/" data-action="home" aria-label="${t("homeAria")}">
          <span class="brand-mark"><i data-lucide="radio" aria-hidden="true"></i></span>
          <span>EdgeCast</span>
        </a>
        <button class="language-toggle" data-action="toggle-language" aria-label="${t("switchLanguage")}" title="${t("switchLanguage")}">
          <span>${state.language === "zh-CN" ? "EN" : "中"}</span>
        </button>
      </header>

      ${state.role === "presenter" ? renderPresenter() : state.role === "viewer" ? renderViewer() : renderHome()}
    </div>
  `;

  createIcons({ icons });
  bindEvents();
  attachMediaElements();
  maybeAutoStartViewer();
}

function renderHome(): string {
  return `
    <main class="workspace home-layout">
      <section class="stage idle-stage">
        <div class="stage-grid" aria-hidden="true">
          <span></span><span></span><span></span><span></span>
        </div>
        <div class="stage-center">
          <i data-lucide="monitor-up" aria-hidden="true"></i>
          <h1>${t("heroTitle")}</h1>
        </div>
      </section>

      <aside class="side-panel">
        <div class="panel-section">
          <h2>${t("hostShare")}</h2>
          ${renderCaptureOptions()}
          <button class="primary action-row" data-action="start-home">
            <i data-lucide="monitor-up" aria-hidden="true"></i>
            <span>${t("startSharing")}</span>
          </button>
        </div>

        <div class="panel-section">
          <h2>${t("joinRoom")}</h2>
          <label class="field-label" for="room-code">${t("roomCode")}</label>
          <div class="join-row">
            <input id="room-code" class="room-input" value="${escapeHtml(state.roomInput)}" placeholder="${t("roomPlaceholder")}" autocomplete="off" />
            <button class="secondary icon-button" data-action="join-room" aria-label="${t("joinRoom")}">
              <i data-lucide="log-in" aria-hidden="true"></i>
            </button>
          </div>
        </div>

        ${renderMessageRegion()}
      </aside>
    </main>
  `;
}

function renderPresenter(): string {
  const viewerLink = state.roomId ? viewerUrl(state.roomId) : "";
  return `
    <main class="workspace">
      <section class="stage">
        <video id="local-preview" class="media-view" muted playsinline autoplay></video>
        ${localStream ? "" : renderEmptyStage("monitor-up", t("waitingToShare"))}
        <div class="stage-toolbar">
          <button class="tool-button" data-action="toggle-mic" ${microphoneStream ? "" : "disabled"} title="${t("toggleMicrophone")}">
            <i data-lucide="${state.micEnabled ? "mic" : "mic-off"}" aria-hidden="true"></i>
            <span>${state.micEnabled ? t("microphoneOn") : t("microphoneOff")}</span>
          </button>
          <button class="danger tool-button" data-action="stop-share" ${localStream ? "" : "disabled"} title="${t("stopSharing")}">
            <i data-lucide="square" aria-hidden="true"></i>
            <span>${t("stop")}</span>
          </button>
        </div>
      </section>

      <aside class="side-panel">
        <div class="panel-section">
          <div class="room-title">
            <div>
              <span class="eyebrow">${t("room")}</span>
              <div class="room-name-row">
                <h2>${escapeHtml(state.roomId ?? "")}</h2>
                <button class="inline-copy-button" data-action="copy-room" title="${t("copyRoomName")}" aria-label="${t("copyRoomName")}">
                  <i data-lucide="copy" aria-hidden="true"></i>
                </button>
              </div>
            </div>
            <span class="viewer-count"><i data-lucide="users" aria-hidden="true"></i>${state.viewerCount}</span>
          </div>

          ${
            localStream
              ? `
                ${renderRoomLinkField(viewerLink)}
              `
              : `
                ${renderCaptureOptions()}
                <button class="primary action-row" data-action="start-presenter">
                  <i data-lucide="play" aria-hidden="true"></i>
                  <span>${t("startSharing")}</span>
                </button>
              `
          }
        </div>

        ${renderMessageRegion()}
      </aside>
    </main>
  `;
}

function renderViewer(): string {
  const viewerLink = state.roomId ? viewerUrl(state.roomId) : "";
  return `
    <main class="workspace">
      <section class="stage">
        <video id="remote-view" class="media-view" playsinline autoplay controls></video>
        ${remoteStream ? "" : renderEmptyStage("volume-2", state.presenterPresent ? t("shareReady") : t("waitingForPresenter"))}
      </section>

      <aside class="side-panel">
        <div class="panel-section">
          <div class="room-title">
            <div>
              <span class="eyebrow">${t("room")}</span>
              <div class="room-name-row">
                <h2>${escapeHtml(state.roomId ?? "")}</h2>
                <button class="inline-copy-button" data-action="copy-room" title="${t("copyRoomName")}" aria-label="${t("copyRoomName")}">
                  <i data-lucide="copy" aria-hidden="true"></i>
                </button>
              </div>
            </div>
            <span class="viewer-count"><i data-lucide="users" aria-hidden="true"></i>${state.viewerCount}</span>
          </div>
          ${renderRoomLinkField(viewerLink)}
        </div>

        ${renderMessageRegion()}
      </aside>
    </main>
  `;
}

function renderRoomLinkField(viewerLink: string): string {
  return `
    <div class="link-field">
      <span class="field-label">${t("roomLink")}</span>
      <div class="link-box">
        <i data-lucide="link" aria-hidden="true"></i>
        <input value="${escapeHtml(viewerLink)}" readonly />
        <button class="inline-copy-button" data-action="copy-link" title="${t("copyViewerLink")}" aria-label="${t("copyViewerLink")}">
          <i data-lucide="copy" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  `;
}

function renderCaptureOptions(): string {
  return `
    <div class="option-list" aria-label="${t("captureSettings")}">
      <label class="check-row">
        <input type="checkbox" data-setting="displayAudio" ${state.displayAudio ? "checked" : ""} />
        <span><i data-lucide="volume-2" aria-hidden="true"></i>${t("screenAudio")}</span>
      </label>
      <label class="check-row">
        <input type="checkbox" data-setting="microphone" ${state.microphone ? "checked" : ""} />
        <span><i data-lucide="mic" aria-hidden="true"></i>${t("microphone")}</span>
      </label>
    </div>
  `;
}

function renderEmptyStage(iconName: string, label: string): string {
  return `
    <div class="empty-state">
      <i data-lucide="${iconName}" aria-hidden="true"></i>
      <span>${escapeHtml(label)}</span>
    </div>
  `;
}

function renderMessage(): string {
  if (state.errorText) {
    return `<div class="message error">${escapeHtml(state.errorText)}</div>`;
  }

  if (state.clipboardText) {
    return `<div class="message ok">${escapeHtml(state.clipboardText)}</div>`;
  }

  return "";
}

function renderMessageRegion(): string {
  return `<div id="message-region" class="message-region" aria-live="polite">${renderMessage()}</div>`;
}

function bindEvents(): void {
  document.querySelector<HTMLAnchorElement>("[data-action='home']")?.addEventListener("click", (event) => {
    event.preventDefault();
    stopAll();
    history.pushState({}, "", "/");
    state.roomId = null;
    state.role = null;
    state.roomInput = "";
    state.errorText = null;
    state.status = "idle";
    autoStartedViewerRoom = null;
    render();
  });

  document.querySelector<HTMLButtonElement>("[data-action='toggle-language']")?.addEventListener("click", toggleLanguage);

  document.querySelector<HTMLButtonElement>("[data-action='start-home']")?.addEventListener("click", async () => {
    const roomId = generateRoomId();
    enterRoom(roomId, "presenter");
    await startPresenter();
  });

  document.querySelector<HTMLButtonElement>("[data-action='start-presenter']")?.addEventListener("click", startPresenter);
  document.querySelector<HTMLButtonElement>("[data-action='stop-share']")?.addEventListener("click", stopPresentation);
  document.querySelectorAll<HTMLButtonElement>("[data-action='copy-link']").forEach((button) => {
    button.addEventListener("click", copyLink);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-action='copy-room']").forEach((button) => {
    button.addEventListener("click", copyRoomName);
  });
  document.querySelector<HTMLButtonElement>("[data-action='toggle-mic']")?.addEventListener("click", toggleMicrophone);

  document.querySelector<HTMLButtonElement>("[data-action='join-room']")?.addEventListener("click", () => {
    const value = normalizeRoomId(state.roomInput);
    if (!value) {
      setError(t("invalidRoomPrompt"));
      return;
    }
    enterRoom(value, "viewer");
  });

  document.querySelector<HTMLInputElement>("#room-code")?.addEventListener("input", (event) => {
    state.roomInput = (event.currentTarget as HTMLInputElement).value;
  });

  document.querySelector<HTMLInputElement>("#room-code")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      document.querySelector<HTMLButtonElement>("[data-action='join-room']")?.click();
    }
  });

  document.querySelectorAll<HTMLInputElement>("[data-setting]").forEach((input) => {
    input.addEventListener("change", () => {
      const setting = input.dataset.setting;
      if (setting === "displayAudio") {
        state.displayAudio = input.checked;
      }
      if (setting === "microphone") {
        state.microphone = input.checked;
      }
      render();
    });
  });
}

function attachMediaElements(): void {
  const localVideo = document.querySelector<HTMLVideoElement>("#local-preview");
  if (localVideo && localVideo.srcObject !== localStream) {
    localVideo.srcObject = localStream;
  }

  const remoteVideo = document.querySelector<HTMLVideoElement>("#remote-view");
  if (remoteVideo) {
    applyRemoteAudioSettings(remoteVideo);
    remoteVideo.addEventListener("volumechange", syncRemoteAudioSettings);

    if (remoteVideo.srcObject !== remoteStream) {
      remoteVideo.srcObject = remoteStream;
    }

    if (remoteStream) {
      void tryPlayRemote(remoteVideo);
    }
  }
}

function applyRemoteAudioSettings(video: HTMLVideoElement): void {
  video.volume = state.remoteVolume;
  video.muted = state.remoteMuted;
  applyRemoteAudioTrackState();
}

function syncRemoteAudioSettings(event: Event): void {
  const video = event.currentTarget;
  if (!(video instanceof HTMLVideoElement)) {
    return;
  }

  state.remoteVolume = video.volume;
  state.remoteMuted = video.muted;
  applyRemoteAudioTrackState();
}

function applyRemoteAudioTrackState(): void {
  remoteStream?.getAudioTracks().forEach((track) => {
    track.enabled = !state.remoteMuted;
  });
}

function releaseRenderedMediaElements(): void {
  document.querySelectorAll<HTMLVideoElement>("#local-preview, #remote-view").forEach((video) => {
    if (video.srcObject) {
      video.pause();
      video.srcObject = null;
    }
  });
}

function maybeAutoStartViewer(): void {
  if (
    state.role !== "viewer" ||
    !state.roomId ||
    state.status === "connecting" ||
    state.status === "connected" ||
    autoStartedViewerRoom === state.roomId
  ) {
    return;
  }

  autoStartedViewerRoom = state.roomId;
  void startViewer();
}

async function startPresenter(): Promise<void> {
  if (!state.roomId) {
    return;
  }

  clearTransientMessages();

  try {
    ensureMediaSupport();
    await captureLocalMedia();
    state.role = "presenter";
    state.status = "connecting";
    render();
    await connectSignaling("presenter");
  } catch (error) {
    stopPresentation();
    setError(error instanceof Error ? error.message : t("unableToStartSharing"));
  }
}

async function startViewer(): Promise<void> {
  if (!state.roomId) {
    return;
  }

  clearTransientMessages();
  state.role = "viewer";
  state.status = "connecting";
  render();

  try {
    remoteStream = new MediaStream();
    await connectSignaling("viewer");
  } catch (error) {
    setError(error instanceof Error ? error.message : t("unableToConnectRoom"));
  }
}

async function tryPlayRemote(video: HTMLVideoElement): Promise<void> {
  if (!remoteStream || remoteStream.getTracks().length === 0) {
    return;
  }

  try {
    await video.play();
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotAllowedError") {
      return;
    }

    console.warn("Remote playback failed", error);
  }
}

async function captureLocalMedia(): Promise<void> {
  const displayOptions: DisplayMediaStreamOptions = {
    video: {
      frameRate: { ideal: 30, max: 60 },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    },
    audio: state.displayAudio
      ? {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      : false
  };

  const extendedDisplayOptions = displayOptions as DisplayMediaStreamOptions & {
    systemAudio?: "include";
    surfaceSwitching?: "include";
    selfBrowserSurface?: "exclude";
  };
  extendedDisplayOptions.systemAudio = "include";
  extendedDisplayOptions.surfaceSwitching = "include";
  extendedDisplayOptions.selfBrowserSurface = "exclude";

  displayStream = await navigator.mediaDevices.getDisplayMedia(displayOptions);

  const tracks = [...displayStream.getVideoTracks(), ...displayStream.getAudioTracks()];

  if (state.microphone) {
    try {
      microphoneStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      tracks.push(...microphoneStream.getAudioTracks());
    } catch {
      microphoneStream = null;
      state.microphone = false;
      state.micEnabled = false;
      state.errorText = t("micUnavailable");
    }
  }

  localStream = new MediaStream(tracks);
  localStream.getAudioTracks().forEach((track) => {
    track.enabled = true;
  });

  const [displayTrack] = displayStream.getVideoTracks();
  displayTrack?.addEventListener("ended", stopPresentation, { once: true });

  render();
}

function ensureMediaSupport(): void {
  if (!window.isSecureContext) {
    throw new Error(t("secureContextRequired"));
  }

  if (!navigator.mediaDevices?.getDisplayMedia || !navigator.mediaDevices?.getUserMedia) {
    throw new Error(t("mediaUnsupported"));
  }
}

function connectSignaling(role: Role): Promise<void> {
  if (!state.roomId) {
    return Promise.reject(new Error(t("missingRoomCode")));
  }

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const url = websocketUrl(state.roomId!, role, state.peerId);
    closingSignalingIntentionally = false;
    ws = new WebSocket(url);

    const openTimeout = window.setTimeout(() => {
      reject(new Error(t("roomConnectionTimeout")));
      ws?.close();
    }, 10000);

    ws.addEventListener("open", () => {
      window.clearTimeout(openTimeout);
      reconnectAttempt = 0;
      lastPongAt = Date.now();
      state.status = "connected";
      startSignalHeartbeat();
      render();
      resolve();
    });

    ws.addEventListener("message", (event) => {
      void handleServerMessage(event.data);
    });

    ws.addEventListener("close", (event) => {
      window.clearTimeout(openTimeout);
      stopSignalHeartbeat();
      ws = null;
      state.status = event.wasClean ? "closed" : "error";
      if (event.code === 1006 && role === "presenter") {
        state.errorText = t("presenterAlreadyOnline");
      }
      if (shouldReconnectSignaling(role)) {
        scheduleSignalReconnect(role);
      }
      render();
    });

    ws.addEventListener("error", () => {
      window.clearTimeout(openTimeout);
      stopSignalHeartbeat();
      state.status = "error";
      reject(new Error(t("websocketConnectionFailed")));
      render();
    });
  });
}

async function handleServerMessage(rawData: unknown): Promise<void> {
  if (typeof rawData !== "string") {
    return;
  }

  let message: ServerMessage;
  try {
    message = JSON.parse(rawData) as ServerMessage;
  } catch {
    setError(t("invalidRoomMessage"));
    return;
  }

  switch (message.type) {
    case "welcome":
      state.peerId = message.peerId;
      state.viewerCount = message.viewerCount;
      state.presenterPresent = message.presenterPresent;
      if (message.presenterPresent) {
        clearPresenterLeftError();
      }
      if (state.role === "presenter" && localStream) {
        for (const viewerId of message.viewers) {
          connectedViewers.add(viewerId);
          await createPresenterOffer(viewerId);
        }
      }
      render();
      break;

    case "viewer-joined":
      connectedViewers.add(message.peerId);
      state.viewerCount = connectedViewers.size;
      render();
      if (state.role === "presenter" && localStream) {
        await createPresenterOffer(message.peerId);
      }
      break;

    case "viewer-left":
      connectedViewers.delete(message.peerId);
      state.viewerCount = connectedViewers.size;
      closePeer(message.peerId);
      render();
      break;

    case "viewer-count":
      state.viewerCount = message.count;
      render();
      break;

    case "presenter-available":
      state.presenterPresent = true;
      clearPresenterLeftError();
      render();
      break;

    case "presenter-left":
      state.presenterPresent = false;
      if (message.final) {
        resetRemote();
        setError(t("presenterLeft"));
      }
      break;

    case "peer-unavailable":
      closePeer(message.peerId);
      break;

    case "signal":
      await handleSignal(message.from, message.data);
      break;

    case "error":
      setError(message.message);
      break;

    case "pong":
      lastPongAt = Date.now();
      break;
  }
}

async function createPresenterOffer(viewerId: string, restartIce = false): Promise<void> {
  const peer = ensurePresenterPeer(viewerId);
  if (restartIce) {
    peer.pc.restartIce();
  }
  const offer = await peer.pc.createOffer();
  await peer.pc.setLocalDescription(offer);
  sendSignal(viewerId, {
    type: "offer",
    sdp: peer.pc.localDescription!
  });
}

async function handleSignal(from: string, data: SignalPayload): Promise<void> {
  if (data.type === "offer" && state.role === "viewer") {
    await handleOffer(from, data.sdp);
    return;
  }

  if (data.type === "answer" && state.role === "presenter") {
    const peer = peers.get(from);
    if (!peer) {
      return;
    }
    await peer.pc.setRemoteDescription(data.sdp);
    await flushCandidates(peer);
    return;
  }

  if (data.type === "candidate") {
    const peer = peers.get(from);
    if (!peer) {
      return;
    }
    await addCandidate(peer, data.candidate);
    return;
  }

  if (data.type === "renegotiate" && state.role === "presenter") {
    await createPresenterOffer(from, true);
  }
}

async function handleOffer(presenterId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
  const peer = ensureViewerPeer(presenterId);
  await peer.pc.setRemoteDescription(sdp);
  await flushCandidates(peer);
  const answer = await peer.pc.createAnswer();
  await peer.pc.setLocalDescription(answer);
  sendSignal(presenterId, {
    type: "answer",
    sdp: peer.pc.localDescription!
  });
  state.presenterPresent = true;
  clearPresenterLeftError();
  render();
}

function ensurePresenterPeer(viewerId: string): PeerState {
  const existing = peers.get(viewerId);
  if (existing) {
    return existing;
  }

  if (!localStream) {
    throw new Error(t("localMediaNotReady"));
  }

  const peer = createPeer(viewerId);
  for (const track of localStream.getTracks()) {
    peer.pc.addTrack(track, localStream);
  }
  peers.set(viewerId, peer);
  return peer;
}

function ensureViewerPeer(presenterId: string): PeerState {
  const existing = peers.get(presenterId);
  if (existing) {
    return existing;
  }

  if (!remoteStream) {
    remoteStream = new MediaStream();
  }

  const peer = createPeer(presenterId);
  peer.pc.addTransceiver("video", { direction: "recvonly" });
  peer.pc.addTransceiver("audio", { direction: "recvonly" });
  peer.pc.ontrack = (event) => {
    if (!remoteStream) {
      remoteStream = new MediaStream();
    }
    if (!remoteStream.getTracks().some((track) => track.id === event.track.id)) {
      remoteStream.addTrack(event.track);
    }
    applyRemoteAudioTrackState();
    render();
  };
  peers.set(presenterId, peer);
  return peer;
}

function createPeer(peerId: string): PeerState {
  const pc = new RTCPeerConnection(rtcConfig);
  const peer: PeerState = {
    id: peerId,
    pc,
    queuedCandidates: []
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal(peerId, {
        type: "candidate",
        candidate: event.candidate.toJSON()
      });
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === "failed") {
      if (state.role === "presenter") {
        void createPresenterOffer(peerId, true);
      } else {
        sendSignal(peerId, { type: "renegotiate" });
      }
    }
  };

  return peer;
}

async function addCandidate(peer: PeerState, candidate: RTCIceCandidateInit): Promise<void> {
  if (!peer.pc.remoteDescription) {
    peer.queuedCandidates.push(candidate);
    return;
  }
  await peer.pc.addIceCandidate(candidate);
}

async function flushCandidates(peer: PeerState): Promise<void> {
  while (peer.queuedCandidates.length > 0) {
    const candidate = peer.queuedCandidates.shift();
    if (candidate) {
      await peer.pc.addIceCandidate(candidate);
    }
  }
}

function sendSignal(to: string, data: SignalPayload): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  ws.send(
    JSON.stringify({
      type: "signal",
      to,
      data
    })
  );
}

function startSignalHeartbeat(): void {
  stopSignalHeartbeat();
  heartbeatTimer = window.setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      stopSignalHeartbeat();
      return;
    }

    if (Date.now() - lastPongAt > SIGNAL_STALE_MS) {
      ws.close(4000, "heartbeat timeout");
      return;
    }

    ws.send(JSON.stringify({ type: "ping", now: Date.now() }));
  }, SIGNAL_HEARTBEAT_MS);
}

function stopSignalHeartbeat(): void {
  if (heartbeatTimer !== null) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function clearSignalReconnect(): void {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function shouldReconnectSignaling(role: Role): boolean {
  if (closingSignalingIntentionally || !state.roomId || state.role !== role) {
    return false;
  }

  if (role === "presenter") {
    return Boolean(localStream);
  }

  return true;
}

function scheduleSignalReconnect(role: Role): void {
  if (reconnectTimer !== null) {
    return;
  }

  const delay = Math.min(SIGNAL_RECONNECT_MAX_MS, SIGNAL_RECONNECT_BASE_MS * 2 ** reconnectAttempt);
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    if (!shouldReconnectSignaling(role)) {
      return;
    }

    void connectSignaling(role).catch(() => {
      scheduleSignalReconnect(role);
    });
  }, delay);
}

function closeSignaling(reason: string): void {
  closingSignalingIntentionally = true;
  clearSignalReconnect();
  stopSignalHeartbeat();
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    ws.close(1000, reason);
  }
  ws = null;
}

function toggleMicrophone(): void {
  if (!microphoneStream) {
    return;
  }

  state.micEnabled = !state.micEnabled;
  for (const track of microphoneStream.getAudioTracks()) {
    track.enabled = state.micEnabled;
  }
  render();
}

function stopPresentation(): void {
  stopTracks(localStream);
  stopTracks(displayStream);
  stopTracks(microphoneStream);
  localStream = null;
  displayStream = null;
  microphoneStream = null;
  state.viewerCount = 0;
  state.status = "closed";
  closeAllPeers();
  closeSignaling("presentation stopped");
  render();
}

function stopAll(): void {
  stopPresentation();
  resetRemote();
  closeSignaling("leaving");
}

function resetRemote(): void {
  stopTracks(remoteStream);
  remoteStream = null;
  closeAllPeers();
  render();
}

function closeAllPeers(): void {
  for (const peer of peers.values()) {
    peer.pc.close();
  }
  peers.clear();
  connectedViewers.clear();
}

function closePeer(peerId: string): void {
  const peer = peers.get(peerId);
  if (peer) {
    peer.pc.close();
    peers.delete(peerId);
  }
}

function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => {
    track.stop();
  });
}

async function copyLink(): Promise<void> {
  if (!state.roomId) {
    return;
  }

  await copyText(viewerUrl(state.roomId), t("linkCopied"));
}

async function copyRoomName(): Promise<void> {
  if (!state.roomId) {
    return;
  }

  await copyText(state.roomId, t("roomNameCopied"));
}

async function copyText(value: string, successMessage: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    showClipboardMessage(successMessage);
  } catch {
    showInlineError(t("copyFailed"));
  }
}

function enterRoom(roomId: string, role: Role): void {
  const normalizedRoom = normalizeRoomId(roomId);
  if (!normalizedRoom) {
    setError(t("invalidRoomFormat"));
    return;
  }

  if (state.roomId !== normalizedRoom || state.role !== role) {
    autoStartedViewerRoom = null;
  }

  state.roomId = normalizedRoom;
  state.role = role;
  state.roomInput = normalizedRoom;
  state.errorText = null;
  const suffix = role === "presenter" ? "?presenter=1" : "";
  history.pushState({}, "", `/r/${encodeURIComponent(normalizedRoom)}${suffix}`);
  render();
}

function readRoute(): { roomId: string | null; presenter: boolean } {
  const match = window.location.pathname.match(/^\/r\/([a-zA-Z0-9-]{3,64})\/?$/);
  const params = new URLSearchParams(window.location.search);
  const roomFromQuery = params.get("room");
  const rawRoom = match?.[1] ?? roomFromQuery ?? null;

  return {
    roomId: rawRoom ? normalizeRoomId(rawRoom) : null,
    presenter: params.get("presenter") === "1"
  };
}

function websocketUrl(roomId: string, role: Role, peerId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({ role, peerId });
  return `${protocol}//${window.location.host}/ws/${encodeURIComponent(roomId)}?${params}`;
}

function viewerUrl(roomId: string): string {
  return `${window.location.origin}/r/${encodeURIComponent(roomId)}`;
}

function normalizeRoomId(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return ROOM_PATTERN.test(normalized) ? normalized : null;
}

function generateRoomId(): string {
  const words = ["cast", "edge", "live", "room", "beam", "link"];
  const word = words[Math.floor(Math.random() * words.length)];
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 5);
  return `${word}-${suffix}`;
}

function createPeerId(): string {
  return globalThis.crypto.randomUUID();
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

function t(key: TranslationKey): string {
  return translations[state.language][key];
}

function readInitialLanguage(): Language {
  const storedLanguage = localStorage.getItem("edgecast-language");
  if (storedLanguage === "zh-CN" || storedLanguage === "en") {
    return storedLanguage;
  }

  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function toggleLanguage(): void {
  state.language = state.language === "zh-CN" ? "en" : "zh-CN";
  localStorage.setItem("edgecast-language", state.language);
  document.documentElement.lang = state.language;
  render();
}

function setError(message: string): void {
  state.errorText = message;
  state.clipboardText = null;
  state.status = "error";
  render();
}

function clearTransientMessages(): void {
  state.errorText = null;
  state.clipboardText = null;
}

function showClipboardMessage(message: string): void {
  state.clipboardText = message;
  state.errorText = null;
  updateMessageRegion();
}

function showInlineError(message: string): void {
  state.errorText = message;
  state.clipboardText = null;
  updateMessageRegion();
}

function updateMessageRegion(): void {
  const region = document.querySelector<HTMLDivElement>("#message-region");
  if (!region) {
    render();
    return;
  }

  region.innerHTML = renderMessage();
}

function clearPresenterLeftError(): void {
  if (state.errorText && PRESENTER_LEFT_MESSAGES.has(state.errorText)) {
    state.errorText = null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
