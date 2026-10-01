import init, { Analyzer } from "../wasm/instance/culverin_counter.js";
import { analyzeTar, ArchiveError } from "./tar";

type Chunk = { type: "chunk"; sequence: number; bytes: Uint8Array };
type Command =
  | { type: "start"; rules: string; blockMs: number }
  | Chunk
  | { type: "finish" };

let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
let pending: Chunk | undefined;
let wanted = false;
let ended = false;
let started = false;

function deliver(): void {
  if (!controller || !wanted) return;
  if (pending) {
    const chunk = pending;
    pending = undefined;
    wanted = false;
    controller.enqueue(chunk.bytes);
    self.postMessage({ type: "ack", sequence: chunk.sequence });
  } else if (ended) {
    wanted = false;
    controller.close();
  }
}

self.onmessage = (event: MessageEvent<Command>) => {
  const command = event.data;
  if (command.type === "start" && !started) {
    started = true;
    const input = new ReadableStream<Uint8Array>(
      {
        start(value) {
          controller = value;
        },
        pull() {
          wanted = true;
          deliver();
        },
      },
      { highWaterMark: 0 },
    );
    void (async () => {
      let analyzer: Analyzer | undefined;
      try {
        const wasm = await init();
        let wasmLinearMemoryBytes = wasm.memory.buffer.byteLength;
        analyzer = new Analyzer(command.rules);
        const active = analyzer;
        let lastActivity = Number.NEGATIVE_INFINITY;
        let counting = false;
        const activity = () => {
          const now = performance.now();
          if (now - lastActivity < 250) return;
          lastActivity = now;
          self.postMessage({ type: "activity" });
        };
        const metrics = await analyzeTar(
          input.pipeThrough(
            new DecompressionStream("gzip") as unknown as ReadableWritablePair<
              Uint8Array,
              Uint8Array
            >,
          ),
          {
            classify(path, prefix) {
              try {
                return (
                  JSON.parse(active.classify_path(path, prefix)) as {
                    kind: string;
                  }
                ).kind;
              } catch {
                throw new ArchiveError("counter_failed");
              }
            },
            addFile(path, bytes) {
              try {
                if (!counting) {
                  counting = true;
                  self.postMessage({ type: "counting" });
                }
                if (command.blockMs) {
                  const until = performance.now() + command.blockMs;
                  while (performance.now() < until) Math.sqrt(2);
                }
                active.add_file(path, bytes);
                activity();
                wasmLinearMemoryBytes = Math.max(
                  wasmLinearMemoryBytes,
                  wasm.memory.buffer.byteLength,
                );
              } catch {
                throw new ArchiveError("counter_failed");
              }
            },
            skipFile(path, prefix, reason, size) {
              try {
                active.skip_file(path, prefix, reason, BigInt(size));
              } catch {
                throw new ArchiveError("counter_failed");
              }
            },
            skipOther(path, prefix, size, lines, binary) {
              try {
                active.skip_other(
                  path,
                  prefix,
                  BigInt(size),
                  BigInt(lines),
                  binary,
                );
              } catch {
                throw new ArchiveError("counter_failed");
              }
            },
          },
          undefined,
          activity,
        );
        const result: unknown = JSON.parse(active.finish());
        wasmLinearMemoryBytes = Math.max(
          wasmLinearMemoryBytes,
          wasm.memory.buffer.byteLength,
        );
        self.postMessage({
          type: "result",
          ok: true,
          result,
          metrics,
          wasmLinearMemoryBytes,
        });
      } catch (error) {
        self.postMessage({
          type: "result",
          ok: false,
          code: error instanceof ArchiveError ? error.code : "archive_invalid",
          limit: error instanceof ArchiveError ? error.limit : undefined,
        });
      } finally {
        try {
          analyzer?.free();
        } catch (error) {
          void error;
        }
      }
    })();
    return;
  }
  if (command.type === "chunk" && started && !pending && !ended) {
    pending = command;
    deliver();
    return;
  }
  if (command.type === "finish" && started && !ended) {
    ended = true;
    deliver();
  }
};
