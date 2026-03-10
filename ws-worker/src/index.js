export default {
  async fetch(request, env) {
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response(
        JSON.stringify({ status: 'ok', service: '치지직 WebSocket 릴레이' }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }
    const url = new URL(request.url);
    const channelId = url.searchParams.get('channelId');
    if (!channelId) {
      return new Response('channelId 파라미터가 필요합니다', { status: 400 });
    }
    const id = env.CHAT_ROOM.idFromName(channelId);
    const stub = env.CHAT_ROOM.get(id);
    return stub.fetch(request);
  },
};

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = new Set();
    this.chzzkWs = null;
    this.isConnecting = false;
    this.pingTimer = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const channelId = url.searchParams.get('channelId');
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.clients.add(server);
    server.addEventListener('close', () => {
      this.clients.delete(server);
      if (this.clients.size === 0) this.disconnectChzzk();
    });
    server.addEventListener('error', () => this.clients.delete(server));
    if (!this.chzzkWs && !this.isConnecting) {
      this.connectToChzzk(channelId);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async connectToChzzk(channelId) {
    this.isConnecting = true;
    try {
      const liveRes = await fetch(
        `https://api.chzzk.naver.com/service/v1/channels/${channelId}/live-detail`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Referer': 'https://chzzk.naver.com',
          },
        }
      );
      const liveJson = await liveRes.json();

      // 디버그용 - 전체 응답 확인
      this.broadcast({ type: 'debug', raw: JSON.stringify({
        status: liveRes.status,
        json: liveJson
      })});

      const chatChannelId = liveJson?.content?.chatChannelId;

      if (!chatChannelId) {
        this.broadcast({ type: 'error', message: '현재 방송 중인 채널이 아닙니다' });
        this.isConnecting = false;
        return;
      }

      let accessToken = '';
      try {
        const tokenRes = await fetch(
          `https://comm-api.game.naver.com/nng_main/v1/chats/access-token?channelId=${chatChannelId}&chatType=STREAMING`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
              'Referer': 'https://chzzk.naver.com',
            },
          }
        );
        const tokenJson = await tokenRes.json();
        accessToken = tokenJson?.content?.accessToken || '';
      } catch (_) {}

      this.chzzkWs = new WebSocket('wss://kr-ss1.chat.naver.com/chat');

      this.chzzkWs.addEventListener('open', () => {
        this.isConnecting = false;
        this.chzzkWs.send(JSON.stringify({
          ver: '2', cmd: 100, svcid: 'game', cid: chatChannelId,
          bdy: { accTkn: accessToken, auth: 'READ', devType: 2001, uid: null },
          tid: 1,
        }));
        this.pingTimer = setInterval(() => {
          if (this.chzzkWs?.readyState === WebSocket.OPEN) {
            this.chzzkWs.send(JSON.stringify({ ver: '2', cmd: 0 }));
          }
        }, 20000);
        this.broadcast({ type: 'connected', message: '채팅 서버에 연결되었습니다' });
      });

      this.chzzkWs.addEventListener('message', (e) => {
        try { this.handleMessage(JSON.parse(e.data)); } catch (_) {}
      });

      this.chzzkWs.addEventListener('close', () => {
        this.disconnectChzzk();
        this.broadcast({ type: 'disconnected', message: '채팅 연결이 끊어졌습니다' });
      });

      this.chzzkWs.addEventListener('error', () => {
        this.broadcast({ type: 'error', message: '채팅 서버 연결 오류' });
      });

    } catch (e) {
      this.isConnecting = false;
      this.broadcast({ type: 'error', message: `연결 실패: ${e.message}` });
    }
  }

  handleMessage(data) {
    // 일반 채팅 (cmd: 93101)
    if (data.cmd === 93101) {
      const messages = data.bdy?.messageList || [];
      for (const msg of messages) {
        if (msg.msgTypeCode === 1) {
          this.broadcast({
            type: 'chat',
            user: msg.profile?.nickname || '익명',
            message: msg.msg || '',
            time: new Date().toISOString(),
          });
        }
      }
    }

    // 후원(치즈) (cmd: 93102)
    if (data.cmd === 93102) {
      const bdy = Array.isArray(data.bdy) ? data.bdy[0] : data.bdy;
      this.broadcast({
        type: 'donation',
        user: bdy?.profile?.nickname || '익명',
        amount: bdy?.payAmount || 0,
        message: bdy?.msg || '',
        time: new Date().toISOString(),
      });
      this.broadcast({ type: 'debug', raw: JSON.stringify(data.bdy) });
    }

    // 구독 (cmd: 94008)
    if (data.cmd === 94008) {
      const bdy = Array.isArray(data.bdy) ? data.bdy[0] : data.bdy;
      this.broadcast({
        type: 'subscription',
        user: bdy?.profile?.nickname || '익명',
        month: bdy?.subscriptionMonth || 1,
        message: bdy?.msg || '',
        time: new Date().toISOString(),
      });
    }
  }

  disconnectChzzk() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.chzzkWs) {
      try { this.chzzkWs.close(); } catch (_) {}
      this.chzzkWs = null;
    }
    this.isConnecting = false;
  }

  broadcast(data) {
    const msg = JSON.stringify(data);
    for (const client of this.clients) {
      try { client.send(msg); } catch (_) { this.clients.delete(client); }
    }
  }
}
