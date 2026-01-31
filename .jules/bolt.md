## 2026-01-31 - [Client-Side Large List Filtering]
**Learning:** The app loads a massive M3U playlist (30k+ items) entirely in the browser. Filtering this list synchronously on the main thread (O(N)) causes significant UI blocking, especially on `input` events.
**Action:** Always debounce search inputs for large client-side lists. Consider moving parsing/filtering to a Web Worker for future optimizations.
