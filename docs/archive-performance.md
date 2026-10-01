# Archive scalability

Run `bun run bench:archive` to build the extension and exercise synthetic snapshots through its browser acquisition, offscreen host, archive worker, and WASM counter. Use `bun run bench:archive --baseline` to record failures while evaluating a more restrictive configuration. The benchmark uses a temporary extension copy and generated archives; it makes no GitHub requests and removes its profile and archives afterward.

The cases cover 8, 32, and 64 MiB source files, 256 MiB and 1 GiB of source split into 8 MiB files, 100,000 small files, and 1 GiB of excluded content. Successful cases check exact code totals, file counts, source bytes, and complete or partial coverage. Oversized individual files are expected to remain partial under the current file policy.

Each output record includes elapsed analysis time, archive transport metrics, and sampled WASM linear memory. JavaScript heap samples use the browser debugger when its worker target is discoverable; `null` means no sample was available. These samples are not total browser memory or a guaranteed peak. Attaching a debugger can affect timing and lifecycle behavior, so cancellation and service-worker termination are checked separately by `bun run test:browser`.

Fixtures use repetitive source to isolate archive traversal, file count, and cumulative counting work. Their compressed size is much smaller than their source size. The measurements do not establish download speed, behavior on slow hardware, or a universal memory bound for notebooks, encodings, embedded languages, or arbitrary source.
