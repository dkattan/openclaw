---
summary: "Adds the iMessage channel surface for sending and receiving OpenClaw messages, with the default imsg backend plus an optional OpenBubbles-backed outbound edit/unsend mode."
read_when:
  - You are installing, configuring, or auditing the imessage plugin
title: "iMessage plugin"
---

# iMessage plugin

Adds the iMessage channel surface for sending and receiving OpenClaw messages.

## Backend modes

- `backend: "imsg"` (default) provides the full documented iMessage send/receive path.
- `backend: "openbubbles"` provides outbound send plus `edit` / `unsend` through a configured OpenBubbles bridge and restored local state directory. Inbound watch remains on the `imsg` backend only.

## Distribution

- Package: `@openclaw/imessage`
- Install route: included in OpenClaw

## Surface

channels: imessage

## Related docs

- [imessage](/channels/imessage)
