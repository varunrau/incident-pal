import { Ajv } from 'ajv';
import type { FastifyInstance } from 'fastify';
import type { createChat } from '../chat.js';
import type { createTelemetry } from '../telemetry.js';
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
  execute: (args: T) => object;
  agentOnly?: boolean;
}

export function createAgentTools(
  app: FastifyInstance, chat: ReturnType<typeof createChat>, telemetry: ReturnType<typeof createTelemetry>,
) {
  const ajv = new Ajv();
  const tools = new Map<string, {
    schema: { type: 'function'; name: string; description: string; parameters: ReturnType<typeof object> };
    execute: (args: unknown) => object;
  }>();

  function register<T extends object>({ name, description, parameters, execute, agentOnly }: Tool<T>) {
    const validate = ajv.compile<T>(parameters);
    tools.set(name, {
      schema: { type: 'function', name, description, parameters },
      execute(args) {
        if (!validate(args)) throw new Error(`Invalid ${name} arguments: ${ajv.errorsText(validate.errors)}`);
        return execute(args);
      },
    });
    if (!agentOnly) app.post<{ Body: T }>(`/api/tools/${name}`, { schema: { body: parameters } }, async request => execute(request.body as T));
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

  const definitions = [...tools.values()].map(tool => tool.schema);
  app.get('/api/tools', async () => definitions);

  return {
    definitions,
    execute(name: string, args: unknown) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      return tool.execute(args);
    },
  };
}
