export interface BridgeMessage {
  id: string;
  source: {
    adapter: string;
    id: string;
    topic?: string;
  };
  timestamp: string;
  type: string;
  payload: Record<string, unknown>;
  meta: {
    received_at: string;
    processing_ms: number;
    version: string;
  };
}
