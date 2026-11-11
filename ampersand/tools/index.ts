import { Ajv } from 'ajv';
import type { Chat } from '../../messenger/chat.js';
import type { Telemetry } from '../../payments/telemetry.js';
import type { AgentTools } from '../agent.js';
import { InvalidToolArgumentsError, UnknownToolError } from '../errors.js';
import { getFlagHistory } from './get_flag_history.js';
import { getFlags } from './get_flags.js';
import { listChannels } from './list_channels.js';
import { pass } from './pass.js';
import { queryLogs } from './query_logs.js';
import { readChannel } from './read_channel.js';
import type { object } from './schemas.js';
import { postMessage } from './post_message.js';
import { tailLogs } from './tail_logs.js';
import { updateFlag } from './update_flag.js';

export interface Tool<T extends object = Record<string, never>> {
  name: string;
  description: string;
  parameters: ReturnType<typeof object>;
  execute: (args: T) => object | Promise<object>;
}

export function createAgentTools(chat: Chat, telemetry: Telemetry): AgentTools {
  const ajv = new Ajv();
  const tools = new Map<string, {
    schema: { type: 'function'; name: string; description: string; parameters: ReturnType<typeof object> };
    execute: (args: unknown) => object | Promise<object>;
  }>();

  function register<T extends object>({ name, description, parameters, execute }: Tool<T>) {
    const validate = ajv.compile<T>(parameters);
    tools.set(name, {
      schema: { type: 'function', name, description, parameters },
      execute(args) {
        if (!validate(args)) throw new InvalidToolArgumentsError(name, ajv.errorsText(validate.errors));
        return execute(args);
      },
    });
  }

  register(listChannels(chat));
  register(readChannel(chat));
  register(queryLogs(telemetry));
  register(tailLogs(telemetry));
  register(getFlags(telemetry));
  register(getFlagHistory(telemetry));
  register(updateFlag(telemetry));
  register(postMessage(chat));
  register(pass);

  return {
    definitions: [...tools.values()].map(tool => tool.schema),
    execute(name: string, args: unknown) {
      const tool = tools.get(name);
      if (!tool) throw new UnknownToolError(name);
      return tool.execute(args);
    },
  };
}
