type MessageHandler = (type: string, payload: unknown) => void

class WebSocketService {
  private ws: WebSocket | null = null
  private handlers: MessageHandler[] = []
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private url: string

  constructor(url: string) {
    this.url = url
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return

    this.ws = new WebSocket(this.url)

    this.ws.onmessage = (event) => {
      try {
        const { type, payload } = JSON.parse(event.data)
        this.handlers.forEach(h => h(type, payload))
      } catch {}
    }

    this.ws.onclose = () => {
      this.reconnectTimer = setTimeout(() => this.connect(), 3000)
    }

    this.ws.onerror = () => {
      this.ws?.close()
    }
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
  }

  onMessage(handler: MessageHandler) {
    this.handlers.push(handler)
    return () => {
      this.handlers = this.handlers.filter(h => h !== handler)
    }
  }

  ping() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send('ping')
    }
  }
}

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/dashboard`
export const wsService = new WebSocketService(WS_URL)
