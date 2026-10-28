# @shardfall/server

Empty until milestone M2. The plan from the design doc:

- **Node.js + Colyseus**, one `MapRoom` per active map and one `FightRoom` per fight.
- The server is authoritative: clients send intents (move to a cell, cast a spell on a cell), the server validates them with `@shardfall/shared` and broadcasts results.
- PostgreSQL for characters, items and marketplace listings; Redis for sessions and cross-server pub/sub.
- All randomness (damage rolls, drops, crafting) is rolled here with a seeded RNG logged per fight.
