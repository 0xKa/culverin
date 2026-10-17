# Archive scalability

Run `bun run bench:archive` to build the extension and exercise synthetic snapshots through its browser acquisition, offscreen host, archive worker, and WASM counter. Use `bun run bench:archive --baseline` to record failures while evaluating a more restrictive configuration. The benchmark uses a temporary extension copy and generated archives; it makes no GitHub requests and removes its profile and archives afterward.

The cases cover 8, 32, and 64 MiB source files, 256 MiB, 1 GiB, and 2 GiB of source split into 8 MiB files, 100,000 small files, 1,000,000 files whose paths add up to about 127 MiB, 1 GiB of excluded content, and 240 MiB of incompressible excluded content that measures how fast archive bytes cross from the service worker to the worker. Pass `--only <name>[,<name>]` to run selected cases, and `--throttle` to slow the offscreen document and the analysis worker four times through the browser debugger where it can reach them; each record then says which targets were slowed. Successful cases check exact code totals, file counts, source bytes, and complete or partial coverage. Oversized individual files are expected to remain partial under the current file policy.

Each output record includes elapsed analysis time, archive transport metrics, and sampled WASM linear memory. JavaScript heap samples use the browser debugger when its worker target is discoverable; `null` means no sample was available. These samples are not total browser memory or a guaranteed peak. Attaching a debugger can affect timing and lifecycle behavior, so cancellation and service-worker termination are checked separately by `bun run test:browser`.

Apart from the incompressible case, fixtures use repetitive source to isolate archive traversal, file count, and cumulative counting work. Their compressed size is much smaller than their source size. The measurements do not establish download speed, behavior on slow hardware, or a universal memory bound for notebooks, encodings, embedded languages, or arbitrary source.

## Local measurements

Chromium 153.0.8010.12 completed the following synthetic workloads after increasing the archive budgets. Times cover analysis after fixture generation and are observations on one machine. The earlier configuration rejected these workloads before returning a result.

| Workload                          | Earlier failure              | Elapsed time | Sampled WASM linear memory |
| --------------------------------- | ---------------------------- | ------------ | -------------------------- |
| 256 MiB of source in 8 MiB files  | Cumulative source-byte limit | 1.3 seconds  | 9.7 MiB                    |
| 1 GiB of source in 8 MiB files    | Cumulative source-byte limit | 4.1 seconds  | 9.7 MiB                    |
| 100,000 source files of 128 bytes | File-count limit             | 3.0 seconds  | 1.6 MiB                    |
| 1 GiB of excluded content         | Decompressed-byte limit      | 0.8 seconds  | 1.6 MiB                    |

These workloads returned exact totals with complete coverage. Individual 32 and 64 MiB source files remained skipped with partial coverage under the 8 MiB file policy. Worker JavaScript heap samples were unavailable in this browser, so the measurements establish no JavaScript or total browser-memory ceiling. The browser smoke test also completed an archive arriving over approximately 30 seconds and verified prompt worker cancellation and recovery. With the limits of this version, 2 GiB of source in 8 MiB files completed on 2026-10-17 in 9.0 seconds with 9.7 MiB of sampled WASM linear memory, and in 8.4 seconds with `--throttle`.

## Chunk transport

The incompressible case downloads 240 MiB from a packaged file, so its speed is bounded by moving bytes from the service worker to the analysis worker rather than by the network. Measured on Chromium 153.0.8010.12 on 2026-10-17:

| Transport                                                        | Elapsed time | Throughput |
| ---------------------------------------------------------------- | ------------ | ---------- |
| JSON number arrays over `chrome.runtime`, 64 KiB chunks (before) | 19.0 seconds | 12.6 MiB/s |
| Base64 strings over `chrome.runtime`, 1 MiB chunks (fallback)    | 16.2 seconds | 14.8 MiB/s |
| Transferred `ArrayBuffer`s through the Clients API, 1 MiB chunks | 1.3 seconds  | 185 MiB/s  |

The Clients API path is used whenever the service worker finds the offscreen document; the base64 path remains only as a fallback.

## Path memory

The parser keeps every path it has read so it can reject duplicate entries, which makes path memory the one allocation that grows with the number of files. The `paths-1m-127-mib` case reaches 133,000,000 path bytes in 1,000,000 files, just under the 128 MiB limit. Measured on Chromium 153.0.8010.12 on 2026-10-17, with the peak resident memory of the largest extension renderer process, which also hosts the service worker and the offscreen document:

| Workload                                                 | Path bytes | Elapsed time  | Peak renderer memory |
| -------------------------------------------------------- | ---------- | ------------- | -------------------- |
| 100,000 files of 128 bytes                               | 1.7 MB     | 2.6 seconds   | 384 MiB              |
| 1,000,000 files with 14-byte paths                       | 14 MB      | 26.1 seconds  | 777 MiB              |
| 1,000,000 files with 133-byte paths                      | 133 MB     | 27.2 seconds  | 1,188 MiB            |
| The same, with the browser held to a quarter of one core | 133 MB     | 125.7 seconds | 1,265 MiB            |
| The same, with `--throttle`                              | 133 MB     | 29.5 seconds  | Not sampled          |

Every run returned exact totals with complete coverage, and WASM linear memory stayed at 1.6 MiB. Long paths add about 400 MiB over short ones at a million files, so the parser holds roughly three bytes of memory for each path byte. `--throttle` reached only the offscreen document because the debugger cannot find the analysis worker, so the quarter-core run, which used a systemd CPU quota on the whole browser, is the slow-machine measurement. The worker's JavaScript heap was not sampled.

The 128 MiB path limit stays. At the limit a count completes, and the extension process stays well below V8's heap limit for a worker. The largest real repositories measured hold far fewer path bytes (see [Limits](limits.md#real-repositories)), so the limit is reached only by snapshots made almost entirely of very small files with long paths.
