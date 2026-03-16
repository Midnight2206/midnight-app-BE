# Backend Architecture

This project now follows a modular-monolith layout.

## Main folders

- `src/app`: Express app assembly and API route mounting.
- `src/bootstrap`: runtime entrypoints for HTTP, queue worker, and backup worker.
- `src/infrastructure`: framework and external-system wiring such as config and queue connections.
- `src/modules`: business modules grouped by domain.
- `src/shared`: reusable HTTP, auth, and error building blocks.

## Domain modules

Each domain should evolve toward this shape:

```text
src/modules/<domain>/
  <domain>.route.js
  <domain>.controller.js
  <domain>.service.js
  <domain>.schema.js
```

Nested domain-specific helpers can stay beside the module or in a subfolder owned by that module.

## Compatibility layer

Legacy paths under:

- `src/routes`
- `src/controllers`
- `src/services`
- `src/zodSchemas`
- `src/middlewares`
- `src/configs`
- `src/queues`
- `utils`

are kept as re-export shims so the app can keep running while imports are migrated gradually.

## Request flow

```text
route -> middleware -> controller -> service -> infrastructure/shared utilities
```

## Refactor rule

For all new work:

- add code under `src/modules`, `src/shared`, or `src/infrastructure`
- do not add new business logic to legacy shim paths
- migrate imports to new paths when touching a file
