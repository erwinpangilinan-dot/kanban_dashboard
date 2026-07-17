# Memoria Examples

## Recall before answering

**User:** "When is Sarah's birthday?"

```
memoria_recall({ query: "Sarah birthday" })
memoria_entity({ name: "sarah" })
```

Use hits like `Facts/sarah-birthday-is-march-12.md` in the answer.

## Store a preference

**User:** "Remember that Sarah prefers tea over coffee."

```
memoria_remember({
  content: "[[Sarah]] prefers tea over coffee",
  memory_type: "semantic",
  importance: "high"
})
```

Response includes `vault_path: "Facts/sarah-prefers-tea-over-coffee.md"`.

## Episodic — where something is

**User:** "Keys are on the kitchen counter."

```
memoria_remember({
  content: "Keys on [[kitchen counter]]",
  memory_type: "episodic",
  importance: "medium",
  force: true
})
```

Short episodic notes often need `force: true` unless they include salience keywords or wikilinks.

## Gate rejection

**User:** "ok"

```
memoria_remember({ content: "ok", memory_type: "episodic", importance: "low" })
→ { stored: false, reason: "below_threshold", salience_score: 0.2 }
```

Do not retry unless the user insists.

## Project context

**User:** "What do we know about the Memory Project?"

```
memoria_recall({ query: "Memory Project second brain MCP" })
```

Cite `vault_path` from top-scoring matches.

## Status after setup

```
memoria_status()
```

Expect `version: "0.2.0"` and paths pointing at this repo's `vault/`.
