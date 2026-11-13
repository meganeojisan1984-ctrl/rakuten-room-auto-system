import type { Page, Request, Response } from "playwright";

/** Observe fresh requests rather than reusing an already-completed load state. */
export function createNetworkSettler(page: Pick<Page, "on" | "off">) {
  const pending = new Set<Request>();
  let lastChange = Date.now();
  let failure: Error | null = null;
  const started = (request: Request) => {
    pending.add(request);
    lastChange = Date.now();
  };
  const finished = (request: Request) => {
    pending.delete(request);
    lastChange = Date.now();
  };
  const failed = (request: Request) => {
    finished(request);
    failure = new Error("ROOMの読み込み通信が失敗しました。いいね操作を停止します");
  };
  const response = (result: Response) => {
    if (result.status() >= 400) failure = new Error("ROOMの読み込み応答にエラーがあります。いいね操作を停止します");
  };
  page.on("request", started);
  page.on("requestfinished", finished);
  page.on("requestfailed", failed);
  page.on("response", response);
  return {
    async waitForQuiet(timeoutMs = 30000, quietMs = 1000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      while (true) {
        if (failure) throw failure;
        if (pending.size === 0 && Date.now() - lastChange >= quietMs) return;
        if (Date.now() >= deadline) throw new Error("ROOMの読み込みが完了しません。いいね操作を停止します");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
    dispose() {
      page.off("request", started);
      page.off("requestfinished", finished);
      page.off("requestfailed", failed);
      page.off("response", response);
    },
  };
}
