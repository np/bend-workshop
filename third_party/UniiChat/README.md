# UniiChat (adapted)

`src/memory.js` adapts the memory of UniiChat
(https://github.com/VictorTaelin/UniiChat, commit 0500bf6), Copyright Higher
Order Company, under the Apache License 2.0 (`LICENSE` here): the binary tree
of one-line summaries over a chat, the view and its merge rule (`Memory.ts`),
and the compactor's instructions (`prompt.txt`).

Changed for the workshop: storage in IndexedDB instead of files; no images,
imports or sides; a message's own line is its beginning until a merge takes it
in (a compaction runs only when a view must shrink); a merge reads the
messages it covers rather than a view of its own; the instructions are
shortened and speak of the workshop's agent and its kinds of messages.
