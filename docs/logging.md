# Logging

Structured pino logging via `@/utilities/logger`. No `console.log` in committed code.

## How it flows

The tRPC context (`trpc/init.ts`) creates the request logger; procedures pass it
into use cases as `log` (`callUseCase(someUseCase({ ...input, log: ctx.log }))`),
and use cases pass `log` onward to anything they compose. You rarely call
`getLogger` yourself — the exceptions are workflows and scripts, which create
their own:

```ts
const log = getLogger({ module: LoggerModule.Jobs });
```

## Rules

- Log with a merge object first, message second: `log.info({ noteId }, "Note created")`.
  The object is for machines, the message for humans.
- Modules are the coarse filter (`general | crud | ai | jobs`) — add a module to the
  enum rather than encoding context in messages.
- The factory already logs use-case start/completion/errors — don't duplicate those.
  Log the *decisions* inside handlers (which branch, what was resolved), not the traffic.
- Never log secrets or personal details; the base logger redacts common paths
  (`email`, `*.token`, `*.apiKey`) but don't rely on it — think before you log.
- Logs are JSON. For pretty dev output: `npm run dev | npx pino-pretty`.
