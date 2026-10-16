# StarBase Raptor engine

`engine.html` is a self-contained Raptor engine figure (11 assemblies + WebGL plume) used on StarBase pads.

- Derived from [wheresryan22/anatomy](https://github.com/wheresryan22/anatomy) (`examples/raptor-engine`, commit e948829).
- MIT License, (c) 2026 Ryan; see `LICENSE-anatomy.txt` (the notice is also embedded at the top of `engine.html`).

Iframe API (postMessage): `{cmd:"progress", value:0..1}`, `{cmd:"complete"}`, `{cmd:"reset"}`.
Events posted to the parent: `{raptor:"ready"|"ignite"|"landed"|"reset", id:<iframe name>}`.
Driven by `public/starbase-raptor.js`.
