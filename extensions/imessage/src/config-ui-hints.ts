import type { ChannelConfigUiHint } from "openclaw/plugin-sdk/core";

export const iMessageChannelConfigUiHints = {
  "": {
    label: "iMessage",
    help: "iMessage channel provider configuration for CLI integration and DM access policy handling. Use explicit CLI paths when runtime environments have non-standard binary locations.",
  },
  dmPolicy: {
    label: "iMessage DM Policy",
    help: 'Direct message access control ("pairing" recommended). "open" requires channels.imessage.allowFrom=["*"].',
  },
  configWrites: {
    label: "iMessage Config Writes",
    help: "Allow iMessage to write config in response to channel events/commands (default: true).",
  },
  backend: {
    label: "iMessage Backend",
    help: 'Transport backend for this account. Use "imsg" for the Messages.app bridge or "openbubbles" for the local OpenBubbles Rust path.',
  },
  cliPath: {
    label: "iMessage CLI Path",
    help: "Filesystem path to the iMessage bridge CLI binary used for send/receive operations. Set explicitly when the binary is not on PATH in service runtime environments.",
  },
  openbubbles: {
    label: "OpenBubbles Backend",
    help: "OpenBubbles-specific bridge/state settings used when backend=openbubbles.",
  },
  "openbubbles.bridgePath": {
    label: "OpenBubbles Bridge Path",
    help: "Executable bridge that translates OpenClaw iMessage sends/actions into the local OpenBubbles Rust runtime.",
  },
  "openbubbles.stateDir": {
    label: "OpenBubbles State Directory",
    help: "Restored OpenBubbles state directory for the signed-in iMessage account on this machine.",
  },
} satisfies Record<string, ChannelConfigUiHint>;
