import * as net from "net";

/**
 * Parses a host and port string (e.g. "localhost:8080", "127.0.0.1:8080", "8080", "[::1]:8080").
 */
export function parseHostPort(
  hostPort?: string,
  defaultHost = "127.0.0.1",
  defaultPort = 8080
): { host: string; port: number } {
  if (!hostPort || !hostPort.trim()) {
    return { host: defaultHost, port: defaultPort };
  }

  const trimmed = hostPort.trim();

  // Handle IPv6 format [::1]:8080
  if (trimmed.startsWith("[")) {
    const closingBracket = trimmed.indexOf("]");
    if (closingBracket !== -1) {
      const host = trimmed.slice(1, closingBracket);
      const rest = trimmed.slice(closingBracket + 1);
      const port = rest.startsWith(":") ? parseInt(rest.slice(1), 10) : defaultPort;
      return { host: host || defaultHost, port: isNaN(port) ? defaultPort : port };
    }
  }

  // Handle host:port
  if (trimmed.includes(":")) {
    const parts = trimmed.split(":");
    const rawHost = parts[0]?.trim() || defaultHost;
    const rawPort = parseInt(parts[1]?.trim() || "", 10);
    return {
      host: rawHost,
      port: isNaN(rawPort) ? defaultPort : rawPort,
    };
  }

  // If input is purely a port number (e.g. "8080")
  const maybePort = parseInt(trimmed, 10);
  if (!isNaN(maybePort) && String(maybePort) === trimmed) {
    return { host: defaultHost, port: maybePort };
  }

  return { host: trimmed, port: defaultPort };
}

/**
 * Probes whether a given host and port are actively listening via a fast TCP connection attempt.
 */
export function probePort(host: string, port: number, timeoutMs = 1200): Promise<boolean> {
  const targetHost = !host || host === "0.0.0.0" || host === "localhost" ? "127.0.0.1" : host;

  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result: boolean) => {
      if (!settled) {
        settled = true;
        socket.removeAllListeners();
        socket.destroy();
        resolve(result);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));

    try {
      socket.connect(port, targetHost);
    } catch {
      finish(false);
    }
  });
}
