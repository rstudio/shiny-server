import Q = require("q");

declare class Endpoint {
  // From BaseEndpoint
  getSharedSecret(): string;

  connect_p: Q.IPromise<boolean>;
  getHttpProxyTarget(): {host: string, port: number};
  // createWebSocketClient(path, headers): websocket.Client
  getAppWorkerPort(): string;
  getLogFileSuffix(): string;
  toString(): string;
  ToString(): string;
  free(): void;
}
