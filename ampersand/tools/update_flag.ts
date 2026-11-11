import type { Chat } from '../../messenger/chat.js';
import type { Decision } from '../../messenger/routes/decide_approval.js';
import type { Telemetry } from '../../payments/telemetry.js';
import { flagLabel, type FlagId } from '../../payments/types.js';
import type { Tool } from './index.js';
import { ampersandAuthor } from './post_message.js';
import { channelField, flagField, object } from './schemas.js';

type UpdateFlag = { channel: string; flag: FlagId; enabled: boolean; reason: string; approvers: string[] };

// Asks the channel to approve a flag change. The flag changes only when someone approves, and
// then `settleFlagRequest` applies the arguments saved here.
export function updateFlag(chat: Chat): Tool<UpdateFlag> {
  return {
    name: 'update_flag',
    description: 'Ask the people in a channel to approve turning a feature flag on or off. Posts an approval request '
      + 'with Approve and Reject buttons and returns right away. Only the listed approvers can decide. The flag '
      + 'changes only if one of them approves, and the decision arrives later as a message.',
    parameters: object({
      channel: channelField,
      flag: flagField,
      enabled: { type: 'boolean' },
      reason: { type: 'string', minLength: 1, maxLength: 500, pattern: '\\S', description: 'Why the change is needed, shown on the request.' },
      approvers: {
        type: 'array', minItems: 1, maxItems: 10, uniqueItems: true,
        items: { type: 'string', minLength: 1, maxLength: 64 },
        description: 'Participant IDs of the people who can approve or reject, from the sender metadata on their '
          + 'messages or author.id in read_channel. Usually the person who asked for the change.',
      },
    }, ['channel', 'flag', 'enabled', 'reason', 'approvers']),
    execute: ({ channel, flag, enabled, reason, approvers }) => {
      const { approval } = chat.requestApproval(channel, ampersandAuthor, reason.trim(), { kind: 'update_flag', flag, enabled }, approvers);
      return { status: 'pending_approval', approvalId: approval.id };
    },
  };
}

// Runs a decision on a flag request without the model, and describes the result for Ampersand.
export function settleFlagRequest(telemetry: Telemetry, { approval, decision, author }: Decision) {
  const { flag, enabled } = approval.action;
  if (decision === 'reject') return `${flagLabel(flag)} was not changed.`;
  const already = telemetry.flagLog().current[flag] === enabled;
  telemetry.setFlag(flag, enabled, 'agent', author.name);
  return already ? `${flagLabel(flag)} was already ${enabled ? 'on' : 'off'}.` : `Turned ${flagLabel(flag)} ${enabled ? 'on' : 'off'}.`;
}
