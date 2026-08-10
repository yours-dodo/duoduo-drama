# @duoduo/agent-runtime

`@duoduo/agent-runtime` is the framework-neutral Agent execution and Harness
module. It owns the model/tool loop, Agent events, Task/Run lifecycle,
checkpoints, recovery, approvals, reconciliation, and the `AgentRuntimeStore`
port.

The module has no dependency on NestJS, Hono, PostgreSQL, or a particular
transport. Hosts and protocol adapters provide composition and I/O:

```text
NestJS HTTP       ─┐
CLI               ─┼─> @duoduo/agent-runtime ─> @duoduo/ai
MCP               ─┘
```

Use the package root for the stable runtime interface. The `./internal`
subpath is reserved for Agent-owned persistence adapters that implement the
runtime Store port; it is not a transport API.

The current NestJS host and PostgreSQL adapter remain in `agent/`. Future CLI
and MCP packages should depend on this package directly and translate their
own input, authentication, tenant scope, cancellation, and streaming protocol
at their adapter seam.
