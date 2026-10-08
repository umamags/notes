<?php
declare(strict_types=1);

/** First-run sample content so the app is explorable straight away. Remove from Settings → Data. */
function seed_sample(Store $store): void
{
    $now = now_ms();
    $mk = fn(string $name, ?string $parent, string $color, int $order) => [
        'id' => new_id(8), 'name' => $name, 'parent' => $parent, 'color' => $color, 'order' => $order, 'created' => $now, 'sample' => true,
    ];
    $arch = $mk('Architecture', null, 'indigo', 1);
    $adr = $mk('Decisions', $arch['id'], 'indigo', 1);
    $res = $mk('Research', null, 'teal', 2);
    $pers = $mk('Personal', null, 'amber', 3);
    $nbs = $store->notebooks();
    foreach ([$arch, $adr, $res, $pers] as $nb) { $nbs[] = $nb; }
    $store->saveNotebooks($nbs);

    $h = 3600000;
    $d = 86400000;

    $notes = [];

    $notes[] = [
        'title' => 'Welcome to Folio', 'notebook' => 'inbox', 'pinned' => true, 'tags' => ['sample', 'guide'],
        'created' => $now - 6 * $d, 'updated' => $now - 20 * 60000,
        'body' => <<<'MD'
Folio is a quiet place for everything you need to remember — architecture notes, article research, PDFs and half-formed ideas. It runs entirely on plain files on your server. There is no AI anywhere in it.

## Getting around

- **Cmd/Ctrl + K** opens the quick switcher. Type a few letters to jump to any note, or search the full text of every note, source and PDF.
- **Alt + N** creates a note, **Alt + Shift + N** creates a research note.
- **Cmd/Ctrl + E** flips between writing and reading. **Cmd/Ctrl + \\** hides the side panels for focus.
- Press **?** anywhere for the full shortcut list.

## Linking notes

Type `[[` and start typing a title to link to another note — for example [[Markdown guide]] or [[ADR-014 Event-driven order orchestration]]. Every link shows up as a *backlink* on the other side (open the Links tab in the right panel). If you link to a note that doesn't exist yet, click the link to create it.

## Search operators

`tag:adr` · `in:Research` · `type:research` · `is:pinned` · `has:pdf` · `"exact phrase"` · `-excluded` · `before:2026-01-01`

## Where things live

Notes are JSON files in the `storage/` folder next to the app, versions are kept per note, and uploads are stored as ordinary files. Export everything as Markdown from **Settings → Data** at any time.

- [x] Open the quick switcher
- [ ] Create your first note
- [ ] Try pasting a link or screenshot into a research note
MD,
    ];

    $notes[] = [
        'title' => 'Markdown guide', 'notebook' => 'inbox', 'tags' => ['sample', 'guide'],
        'created' => $now - 5 * $d, 'updated' => $now - 3 * $d,
        'body' => <<<'MD'
Everything is written in Markdown and rendered live. A short reference:

## Text

**Bold**, *italic*, ~~strikethrough~~, `inline code` and [links](https://example.com). Back to the [[Welcome to Folio]] note.

> [!TIP]
> Blockquotes that start with `[!NOTE]`, `[!TIP]` or `[!WARNING]` become callouts.

## Lists and tasks

1. Ordered lists
2. Continue automatically when you press Enter

- [x] Task lists can be ticked in reading mode
- [ ] Without leaving the page

## Tables

| Option | Latency | Complexity |
| --- | --- | --- |
| Synchronous calls | Low | Low |
| Event-driven | Medium | Medium |
| Orchestrated saga | Medium | High |

## Code

```js
export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
```

## Images

Paste or drop an image straight into the editor and it is stored next to your notes.
MD,
    ];

    $notes[] = [
        'title' => 'Integration landscape overview', 'notebook' => $arch['id'], 'tags' => ['sample', 'architecture', 'integration'],
        'created' => $now - 4 * $d, 'updated' => $now - 2 * $d - 3 * $h,
        'body' => <<<'MD'
A working map of the services that take part in the order journey. Keep it short and link outwards.

## Domains

| Domain | Owner | Style | Notes |
| --- | --- | --- | --- |
| Catalogue | Merchandising | REST | Read-heavy, cached at the edge |
| Pricing | Pricing | REST + events | Emits `price.changed` |
| Cart & checkout | Commerce | REST | Stateful, short TTL |
| Payments | Payments | REST (3rd party) | Idempotency keys required |
| Fulfilment | Operations | Events | See [[ADR-014 Event-driven order orchestration]] |

## Cross-team dependencies

- Pricing → Cart: contract tests run nightly
- Payments → Fulfilment: only via the order topic
- Identity is shared by everything; treat outages as a platform incident

## Open questions

- Do we need a shared schema registry before the next planning increment?
- Who owns the dead-letter queue triage rota?
MD,
    ];

    $notes[] = [
        'title' => 'ADR-014 Event-driven order orchestration', 'notebook' => $adr['id'], 'pinned' => true,
        'tags' => ['sample', 'architecture', 'adr', 'integration'],
        'created' => $now - 3 * $d, 'updated' => $now - 4 * $h,
        'body' => <<<'MD'
**Status:** Proposed · **Deciders:** Architecture group · **Related:** [[Integration landscape overview]], [[Research: Composable commerce patterns]]

## Context

Order placement currently fans out synchronous calls to payments, inventory and fulfilment. A slow downstream service stalls checkout, and retries are inconsistent between teams.

## Decision

Introduce an **order orchestrator** that owns the order state machine and communicates with downstream services through events. Each step is idempotent and carries a correlation id.

```text
checkout → order.created → payment.authorised → inventory.reserved → fulfilment.requested
                                   ↘ payment.failed → order.cancelled
```

## Options considered

| Option | Pros | Cons |
| --- | --- | --- |
| Keep synchronous fan-out | Simple, familiar | Tight coupling, cascading latency |
| Choreography only | No central owner | Hard to reason about failures |
| Orchestrator + events | Clear ownership, observable | One more component to run |

## Consequences

- Checkout latency becomes independent of fulfilment.
- We need a **dead-letter strategy** and replay tooling before go-live.
- Contract tests move from request/response to message schemas.

> [!WARNING]
> Do not start migration until the schema registry question in [[Integration landscape overview]] is settled.

## Follow-ups

- [ ] Draft the event catalogue
- [ ] Agree retry and back-off defaults with Payments
- [x] Share the proposal with the architecture group
MD,
    ];

    $notes[] = [
        'title' => 'Research: Composable commerce patterns', 'type' => 'research', 'notebook' => $res['id'],
        'tags' => ['sample', 'research', 'architecture'], 'status' => 'reading',
        'source' => ['url' => 'https://example.com/composable-commerce', 'author' => 'Example Author', 'site' => 'example.com', 'published' => ''],
        'created' => $now - 2 * $d, 'updated' => $now - 8 * $h,
        'clips' => [
            ['kind' => 'link', 'url' => 'https://example.com/composable-commerce', 'title' => 'Composable commerce: a practical introduction',
             'site' => 'example.com', 'description' => 'Placeholder link — paste any URL into a research note and Folio will fetch the title and description for you.',
             'comment' => 'Good framing of bounded contexts; skim the migration section.'],
            ['kind' => 'quote', 'text' => 'Start with the seams you already have. Decompose along the boundaries where teams already hand work to each other.',
             'source' => 'Example Author', 'url' => 'https://example.com/composable-commerce', 'page' => '', 'comment' => 'Matches how our domains are already split.'],
            ['kind' => 'text', 'text' => "**Questions to answer**\n\n- Where does the orchestrator live?\n- Can we reuse the existing event backbone?"],
        ],
        'body' => <<<'MD'
## Why I'm reading this

Looking for patterns that support [[ADR-014 Event-driven order orchestration]] without a big-bang migration.

## Takeaways so far

- Decompose along existing team seams.
- Keep the orchestrator thin; push business rules into the domain services.
- Treat the event catalogue as a product with an owner.

## To do

- [ ] Find a second source that disagrees
- [ ] Summarise for the architecture group
MD,
    ];

    $notes[] = [
        'title' => 'Weekly review', 'notebook' => $pers['id'], 'tags' => ['sample', 'personal', 'routine'],
        'created' => $now - 8 * $d, 'updated' => $now - 1 * $d,
        'body' => <<<'MD'
A ten-minute Friday ritual.

1. Clear the Inbox notebook — file, link or delete everything.
2. Skim the pinned notes and un-pin what is finished.
3. Write down three things that went well.
4. Pick the one note to move forward on Monday.
MD,
    ];

    $notes[] = [
        'title' => 'Idea: reading queue for saved articles', 'notebook' => 'inbox', 'tags' => ['sample', 'idea'],
        'created' => $now - 90 * 60000, 'updated' => $now - 90 * 60000,
        'body' => "Keep a short queue of research notes with status **To read** and review it on Mondays. Search with `type:research status:to-read`.",
    ];

    foreach ($notes as $n) {
        $n['sample'] = true;
        $note = $store->newNote($n);
        $note['created'] = $n['created'];
        $note['updated'] = $n['updated'];
        if (isset($n['status'])) { $note['status'] = $n['status']; }
        $store->persist($note);
    }
}
