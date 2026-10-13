export interface FakeBotApiOptions {
  readonly port?: number;
  readonly host?: string;
  /** Se informado, so este token e aceito na URL (`/bot<token>/...`); outro = 401. */
  readonly token?: string;
  readonly log?: (line: string) => void;
}

export interface FakeBotApi {
  readonly port: number;
  close(): Promise<void>;
}

export function startFakeBotApi(options?: FakeBotApiOptions): Promise<FakeBotApi>;
