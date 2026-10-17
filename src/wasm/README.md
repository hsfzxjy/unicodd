# Future WASM boundary

Milestone 2 will add a TypeScript adapter here. It will own the standard `WebAssembly` API,
allocation, deallocation, typed-array views, ABI error handling, and memory-growth refreshes.

Vue components and puzzle definitions must consume typed operation values and must never handle
raw WASM pointers. No normalization or versioned Unicode behavior is emulated in Milestone 1.
