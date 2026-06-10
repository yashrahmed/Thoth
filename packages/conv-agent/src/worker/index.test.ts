import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import worker, { type WorkerEnv } from "./index";

describe("worker fetch", () => {
  afterEach(() => {
    mock.restore();
  });

  test("returns a generic 500 response when dependency construction fails", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    const ctx = {
      waitUntil: () => undefined,
    } as unknown as ExecutionContext;

    const request = new Request("http://localhost/api/v1/conversations", { method: "POST" }) as Request<unknown, IncomingRequestCfProperties<unknown>>;
    const response = await worker.fetch(request, {} as WorkerEnv, ctx);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        kind: "WorkerBootstrapError",
        message: "An unexpected worker error occurred.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("HYPERDRIVE");
    expect(errorSpy).toHaveBeenCalled();
  });
});
