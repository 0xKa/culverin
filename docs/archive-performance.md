# Archive scalability

Run `bun run bench:archive` to build the extension and exercise synthetic snapshots through its browser acquisition, offscreen host, archive worker, and WASM counter. Use `bun run bench:archive --baseline` to record failures while evaluating a more restrictive configuration. The benchmark uses a temporary extension copy and generated archives; it makes no GitHub requests and removes its profile and archives afterward.

The cases cover 8, 32, and 64 MiB source files, 256 MiB and 1 GiB of source split into 8 MiB files, 100,000 small files, and 1 GiB of excluded content. Successful cases check exact code totals, file counts, source bytes, and complete or partial coverage. Oversized individual files are expected to remain partial under the current file policy.

Each output record includes elapsed analysis time, archive transport metrics, and sampled WASM linear memory. JavaScript heap samples use the browser debugger when its worker target is discoverable; `null` means no sample was available. These samples are not total browser memory or a guaranteed peak. Attaching a debugger can affect timing and lifecycle behavior, so cancellation and service-worker termination are checked separately by `bun run test:browser`.

Fixtures use repetitive source to isolate archive traversal, file count, and cumulative counting work. Their compressed size is much smaller than their source size. The measurements do not establish download speed, behavior on slow hardware, or a universal memory bound for notebooks, encodings, embedded languages, or arbitrary source.

## Local measurements

Chromium 153.0.8010.12 completed the following synthetic workloads after increasing the archive budgets. Times cover analysis after fixture generation and are observations on one machine. The earlier configuration rejected these workloads before returning a result.

| Workload                          | Earlier failure              | Elapsed time | Sampled WASM linear memory |
| --------------------------------- | ---------------------------- | ------------ | -------------------------- |
| 256 MiB of source in 8 MiB files  | Cumulative source-byte limit | 1.3 seconds  | 9.7 MiB                    |
| 1 GiB of source in 8 MiB files    | Cumulative source-byte limit | 4.1 seconds  | 9.7 MiB                    |
| 100,000 source files of 128 bytes | File-count limit             | 3.0 seconds  | 1.6 MiB                    |
| 1 GiB of excluded content         | Decompressed-byte limit      | 0.8 seconds  | 1.6 MiB                    |

These workloads returned exact totals with complete coverage. Individual 32 and 64 MiB source files remained skipped with partial coverage under the 8 MiB file policy. Worker JavaScript heap samples were unavailable in this browser, so the measurements establish no JavaScript or total browser-memory ceiling. The browser smoke test also completed an archive arriving over approximately 30 seconds and verified prompt worker cancellation and recovery.
